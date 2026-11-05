import { describe, expect, it } from "vitest";
import { hotRank } from "@/lib/hot";
import { pageRequest } from "@/lib/pagination";
import { createMemoryRateLimiter } from "@/server/rate-limit/rate-limiter";
import { createPublicCatalogueService } from "@/server/services/public/public-catalogue.service";
import { createVotesService } from "@/server/services/votes/votes.service";
import { createLiveDeal, createUser } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 10, 5, 12));
const votes = createVotesService(testDb, {
  rateLimiter: createMemoryRateLimiter({ limit: 1000, windowMs: 60_000 }),
});
const catalogue = createPublicCatalogueService(testDb);

describe("deal votes", () => {
  it("counts one vote per person, which they can change or take back", async () => {
    const { deal } = await createLiveDeal(NOW, "Voted Kettle");
    const alice = await createUser("alice@example.test");
    const bob = await createUser("bob@example.test");
    const vote = (userId: string, value: -1 | 0 | 1) =>
      votes.vote({ userId, slug: deal.slug, value, now: NOW });

    expect(await vote(alice.id, 1)).toEqual({ ok: true, score: 1, myVote: 1 });
    expect(await vote(alice.id, 1)).toEqual({ ok: true, score: 1, myVote: 1 });
    expect(await vote(bob.id, 1)).toMatchObject({ score: 2 });
    expect(await vote(alice.id, -1)).toMatchObject({ score: 0 });
    expect(await vote(bob.id, 0)).toMatchObject({ score: -1 });

    expect(await votes.state(deal.slug, alice.id)).toEqual({ score: -1, myVote: -1 });
    expect(await votes.state(deal.slug, bob.id)).toEqual({ score: -1, myVote: 0 });
    expect(await votes.state(deal.slug, null)).toEqual({ score: -1, myVote: 0 });
    expect(await testDb.dealVote.count()).toBe(1);
  });

  it("keeps the score equal to the sum of votes when many people vote at once", async () => {
    const { deal } = await createLiveDeal(NOW, "Popular Kettle");
    const users = await Promise.all(
      Array.from({ length: 12 }, (_, i) => createUser(`voter${i}@example.test`)),
    );
    await Promise.all(
      users.map((u, i) =>
        votes.vote({ userId: u.id, slug: deal.slug, value: i < 9 ? 1 : -1, now: NOW }),
      ),
    );
    expect((await votes.state(deal.slug, null))?.score).toBe(6);
  });

  it("only takes votes on public deals, and rate-limits fast voters", async () => {
    const { deal } = await createLiveDeal(NOW, "Gone Kettle");
    const user = await createUser("fast@example.test");
    await testDb.deal.update({ where: { id: deal.id }, data: { status: "EXPIRED" } });
    expect(await votes.vote({ userId: user.id, slug: deal.slug, value: 1, now: NOW })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await votes.state(deal.slug, user.id)).toBeNull();

    const limited = createVotesService(testDb, {
      rateLimiter: createMemoryRateLimiter({ limit: 1, windowMs: 60_000 }),
    });
    const live = await createLiveDeal(NOW, "Live Kettle");
    const cast = () => limited.vote({ userId: user.id, slug: live.deal.slug, value: 1, now: NOW });
    expect((await cast()).ok).toBe(true);
    expect(await cast()).toEqual({ ok: false, error: "RATE_LIMITED" });
  });
});

describe("the Hot tab", () => {
  it("stores the same rank as hotRank() and orders deals by it", async () => {
    const older = await createLiveDeal(NOW, "Older Loved Kettle", { publishedMinutesAgo: 180 });
    const newer = await createLiveDeal(NOW, "Newer Kettle");
    const glitch = await createLiveDeal(NOW, "Glitch Kettle", { publishedMinutesAgo: 60 });
    await testDb.deal.update({ where: { id: glitch.deal.id }, data: { level: "PRICE_ERROR" } });
    for (let i = 0; i < 30; i++) {
      const user = await createUser(`fan${i}@example.test`);
      await votes.vote({ userId: user.id, slug: older.deal.slug, value: 1, now: NOW });
    }

    const rows = await testDb.deal.findMany({
      select: { slug: true, voteScore: true, level: true, publishedAt: true, hotRank: true },
    });
    for (const row of rows) {
      expect(row.hotRank).toBeCloseTo(hotRank({ ...row, publishedAt: row.publishedAt! }), 9);
    }

    const hot = await catalogue.listDeals({ sort: "hot", page: pageRequest(undefined, 10) });
    expect(hot.items.map((d) => d.slug)).toEqual([
      older.deal.slug, // 30 points, 3 hours old
      glitch.deal.slug, // 10 points for a price error, 1 hour old
      newer.deal.slug, // no points, just published
    ]);
    expect(hot.items[0]!.voteScore).toBe(30);

    const home = await catalogue.homepage();
    expect(home.hot.map((d) => d.slug)).toEqual([older.deal.slug]);
  });
});
