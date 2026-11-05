import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "@/server/rate-limit/rate-limiter";
import { createCommentsService } from "@/server/services/comments/comments.service";
import { createPointsService } from "@/server/services/points/points.service";
import { createVotesService } from "@/server/services/votes/votes.service";
import { createLiveDeal, createUser } from "./factories";
import { testDb } from "./setup";

// 12:00 UK time on Thursday 5 November 2026.
const NOW = new Date(Date.UTC(2026, 10, 5, 12));
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const points = createPointsService(testDb);
const rateLimiter = () => createMemoryRateLimiter({ limit: 1000, windowMs: 60_000 });

describe("daily check-in", () => {
  it("awards once per UK day and builds a streak, with a bonus on the 7th day", async () => {
    const user = await createUser("daily@example.test");
    expect(await points.checkIn(user.id, NOW)).toEqual({ ok: true, points: 10, streak: 1 });
    expect(await points.checkIn(user.id, new Date(NOW.getTime() + 3_600_000))).toEqual({
      ok: false,
      error: "ALREADY_CHECKED_IN",
    });
    for (let d = 1; d < 6; d++) await points.checkIn(user.id, at(d));
    expect(await points.checkIn(user.id, at(6))).toEqual({ ok: true, points: 40, streak: 7 });

    const summary = await points.summary(user.id, at(6));
    expect(summary).toMatchObject({ balance: 6 * 10 + 40, streak: 7, checkedInToday: true });
    expect(summary.recent[0]).toMatchObject({ label: "Daily check-in", points: 40 });

    // Missing a day resets the streak.
    expect(await points.checkIn(user.id, at(8))).toEqual({ ok: true, points: 10, streak: 1 });
    expect(await points.summary(user.id, at(9))).toMatchObject({
      streak: 1,
      checkedInToday: false,
    });
  });

  it("counts only one of two simultaneous check-ins", async () => {
    const user = await createUser("double@example.test");
    const results = await Promise.all([points.checkIn(user.id, NOW), points.checkIn(user.id, NOW)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await points.summary(user.id, NOW)).balance).toBe(10);
  });
});

describe("points for taking part", () => {
  it("gives a point for the first vote on each deal only", async () => {
    const votes = createVotesService(testDb, { rateLimiter: rateLimiter(), points });
    const user = await createUser("voter@example.test");
    const a = await createLiveDeal(NOW, "Kettle A");
    const b = await createLiveDeal(NOW, "Kettle B");
    const vote = (slug: string, value: -1 | 0 | 1) =>
      votes.vote({ userId: user.id, slug, value, now: NOW });
    await vote(a.deal.slug, 1);
    await vote(a.deal.slug, 0);
    await vote(a.deal.slug, -1);
    await vote(b.deal.slug, 0); // taking back nothing earns nothing
    await vote(b.deal.slug, 1);
    expect((await points.summary(user.id, NOW)).balance).toBe(2);
  });

  it("gives points for comments, up to five a day", async () => {
    const comments = createCommentsService(testDb, { rateLimiter: rateLimiter(), points });
    const user = await createUser("commenter@example.test");
    const { deal } = await createLiveDeal(NOW, "Chatty Kettle");
    for (let i = 0; i < 7; i++) {
      await comments.post({ userId: user.id, slug: deal.slug, body: `comment ${i}`, now: NOW });
    }
    expect((await points.summary(user.id, NOW)).balance).toBe(10);
    await comments.post({ userId: user.id, slug: deal.slug, body: "next day", now: at(1) });
    expect((await points.summary(user.id, at(1))).balance).toBe(12);
  });

  it("keeps entries positive and days well formed in the database", async () => {
    const user = await createUser("strict@example.test");
    const base = { userId: user.id, reason: "CHECK_IN" as const, refKey: "x" };
    await expect(
      testDb.pointsEntry.create({ data: { ...base, points: 0, day: "2026-11-05" } }),
    ).rejects.toThrow();
    await expect(
      testDb.pointsEntry.create({ data: { ...base, points: 5, day: "5 Nov" } }),
    ).rejects.toThrow();
  });
});
