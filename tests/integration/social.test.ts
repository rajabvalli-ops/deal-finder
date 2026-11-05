import { afterEach, describe, expect, it, vi } from "vitest";
import { runJob } from "@/server/jobs/jobs";
import { postDealToSocial } from "@/server/services/admin";
import type { SocialConfig } from "@/server/social/config";
import { createSocialPostingService, type Poster } from "@/server/social/social-posting.service";
import { XApiError } from "@/server/social/x-client";
import { createPendingDeal } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 10, 5, 12));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const since = new Date(NOW.getTime() - DAY);

const KEYS = {
  X_API_KEY: "k",
  X_API_SECRET: "s",
  X_ACCESS_TOKEN: "t",
  X_ACCESS_TOKEN_SECRET: "ts",
  NEXT_PUBLIC_SITE_URL: "https://dealbroker.example",
};

const config = (overrides: Partial<SocialConfig> = {}): SocialConfig => ({
  credentials: { apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts" },
  dailyLimit: 10,
  minLevel: "BIG_DROP",
  links: "deal-page",
  siteUrl: "https://dealbroker.example",
  ...overrides,
});

/** A poster that records texts; `fail` can throw for a given call number (1-based). */
function fakePoster(fail: (call: number) => Error | null = () => null) {
  const texts: string[] = [];
  let calls = 0;
  const poster: Poster = {
    post: vi.fn(async (text: string) => {
      calls += 1;
      const error = fail(calls);
      if (error) throw error;
      texts.push(text);
      return { id: `post-${calls}` };
    }),
  };
  return { poster, texts };
}

const liveDeal = (title: string, dropTo: number) =>
  createPendingDeal(NOW, { title, externalId: title, dropTo, autoPublish: true });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("auto-posting to X", () => {
  it("posts new big drops and price errors (price errors first), never ordinary deals", async () => {
    await liveDeal("Normal Kettle", 8000);
    await liveDeal("Big Kettle", 6000);
    const glitch = await liveDeal("Glitch Kettle", 900);
    const { poster, texts } = fakePoster();

    expect(
      await createSocialPostingService(testDb, config(), poster).run({ now: NOW, since }),
    ).toEqual({
      queued: 2,
      posted: 2,
      skipped: 0,
      failed: 0,
      remainingToday: 8,
    });
    expect(texts[0]).toMatch(/^🚨 PRICE ERROR\?\n\n£9\.00 for Glitch Kettle\n/);
    expect(texts[0]).toContain(`https://dealbroker.example/deals/${glitch.deal.slug}`);
    expect(texts[0]?.endsWith("#ad")).toBe(true);
    expect(texts[1]).toMatch(/^📉 BIG PRICE DROP\n\n£60\.00 for Big Kettle/);
    expect(await testDb.socialPost.findFirst({ where: { dealId: glitch.deal.id } })).toMatchObject({
      network: "x",
      status: "POSTED",
      externalId: "post-1",
      postedAt: NOW,
      level: "PRICE_ERROR",
    });

    // Nothing is posted twice.
    expect(
      (await createSocialPostingService(testDb, config(), poster).run({ now: NOW, since })).posted,
    ).toBe(0);
  });

  it("keeps to the daily limit and carries the rest over", async () => {
    await liveDeal("Glitch A", 900);
    await liveDeal("Glitch B", 900);
    await liveDeal("Glitch C", 900);
    const { poster } = fakePoster();
    const service = createSocialPostingService(testDb, config({ dailyLimit: 2 }), poster);

    expect(await service.run({ now: NOW, since })).toMatchObject({
      queued: 3,
      posted: 2,
      remainingToday: 0,
    });
    expect(await service.run({ now: new Date(NOW.getTime() + HOUR), since })).toMatchObject({
      posted: 0,
      remainingToday: 0,
    });
    expect(await service.run({ now: new Date(NOW.getTime() + DAY + HOUR), since })).toMatchObject({
      posted: 1,
    });
  });

  it("can post without links, and only price errors when asked", async () => {
    await liveDeal("Big Kettle", 6000);
    await liveDeal("Glitch Kettle", 900);
    const { poster, texts } = fakePoster();
    await createSocialPostingService(
      testDb,
      config({ links: "none", minLevel: "PRICE_ERROR" }),
      poster,
    ).run({ now: NOW, since });
    expect(texts).toHaveLength(1);
    expect(texts[0]).not.toContain("https://");
  });

  it("skips deals that are no longer live when their turn comes", async () => {
    const gone = await liveDeal("Gone Kettle", 900);
    const { poster } = fakePoster();
    const service = createSocialPostingService(testDb, config({ dailyLimit: 0 }), poster);
    await service.run({ now: NOW, since });
    await testDb.deal.update({ where: { id: gone.deal.id }, data: { status: "EXPIRED" } });
    expect(
      await createSocialPostingService(testDb, config(), poster).run({ now: NOW, since }),
    ).toMatchObject({ skipped: 1, posted: 0 });
    expect(poster.post).not.toHaveBeenCalled();
  });

  it("stops on rate limits, gives up on rejections, and fails after three tries", async () => {
    await liveDeal("Glitch A", 900);
    await liveDeal("Glitch B", 900);
    // Rate limited on the first post: nothing else is tried this run.
    const limited = fakePoster(() => new XApiError("slow down", 429, 1));
    expect(
      await createSocialPostingService(testDb, config(), limited.poster).run({ now: NOW, since }),
    ).toMatchObject({ posted: 0, failed: 0 });
    expect(limited.poster.post).toHaveBeenCalledTimes(1);

    // A 403 (e.g. duplicate content) won't succeed later: given up straight away.
    const rejected = fakePoster((n) => (n === 1 ? new XApiError("duplicate", 403) : null));
    expect(
      await createSocialPostingService(testDb, config(), rejected.poster).run({ now: NOW, since }),
    ).toMatchObject({ posted: 1, failed: 1 });

    // Network errors are retried until the third attempt.
    await liveDeal("Glitch C", 900);
    const flaky = fakePoster(() => new Error("socket hang up"));
    for (let i = 0; i < 3; i++) {
      await createSocialPostingService(testDb, config(), flaky.poster).run({ now: NOW, since });
    }
    expect(
      await testDb.socialPost.findMany({
        where: { status: "FAILED" },
        select: { attempts: true, lastError: true },
      }),
    ).toEqual(expect.arrayContaining([{ attempts: 3, lastError: "socket hang up" }]));
  });

  it("posts a deal again when it drops into a higher level", async () => {
    const { deal } = await liveDeal("Kettle", 6000);
    const { poster, texts } = fakePoster();
    const service = createSocialPostingService(testDb, config(), poster);
    await service.run({ now: NOW, since });
    await testDb.deal.update({
      where: { id: deal.id },
      data: { level: "PRICE_ERROR", levelRaisedAt: NOW },
    });
    await service.run({ now: NOW, since });
    expect(texts.map((t) => t.split("\n")[0])).toEqual(["📉 BIG PRICE DROP", "🚨 PRICE ERROR?"]);
  });
});

describe("posting from jobs and the admin", () => {
  it("posts as part of deal detection when X is connected, and not at all otherwise", async () => {
    await liveDeal("Glitch Kettle", 900);
    const off = await runJob("detect-deals", { client: testDb, now: NOW, env: {} });
    expect(off).not.toHaveProperty("social");

    const fetchX = vi.fn(async () => Response.json({ data: { id: "999" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetchX);
    const on = await runJob("post-social", { client: testDb, now: NOW, env: KEYS });
    expect(on).toMatchObject({ status: "completed", social: { queued: 1, posted: 1 } });
    expect(fetchX).toHaveBeenCalledWith("https://api.x.com/2/tweets", expect.anything());
  });

  it("lets an editor post any live deal now", async () => {
    const normal = await liveDeal("Normal Kettle", 8000);
    const pending = await createPendingDeal(NOW, { title: "Pending", externalId: "p" });

    expect(await postDealToSocial(normal.deal.id, NOW)).toEqual({ ok: false, error: "SOCIAL_OFF" });
    for (const [key, value] of Object.entries(KEYS)) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", async () => Response.json({ data: { id: "1" } }, { status: 201 }));

    expect(await postDealToSocial("missing", NOW)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await postDealToSocial(pending.deal.id, NOW)).toEqual({ ok: false, error: "NOT_LIVE" });
    expect(await postDealToSocial(normal.deal.id, NOW)).toEqual({ ok: true, value: undefined });
    // Already posted at this level.
    expect(await postDealToSocial(normal.deal.id, NOW)).toEqual({
      ok: false,
      error: "SOCIAL_FAILED",
    });
  });
});
