import "server-only";
import { POINTS, POINTS_REASON_LABELS, checkInPoints, checkInStreak, ukDay } from "@/lib/points";
import { createPointsRepository } from "@/server/db/repositories/points.repository";
import type { DbClient } from "@/server/db/types";

export type PointsSummary = {
  balance: number;
  streak: number;
  checkedInToday: boolean;
  recent: { id: string; label: string; points: number; createdAt: Date }[];
};

export type CheckInResult =
  { ok: true; points: number; streak: number } | { ok: false; error: "ALREADY_CHECKED_IN" };

/** Points for checking in, voting and commenting. No cash value; nothing to redeem. */
export function createPointsService(client: DbClient) {
  const points = createPointsRepository(client);

  return {
    async checkIn(userId: string, now: Date): Promise<CheckInResult> {
      const today = ukDay(now);
      const days = await points.checkInDays(userId);
      if (days.includes(today)) return { ok: false, error: "ALREADY_CHECKED_IN" };
      const streak = checkInStreak([...days, today], today);
      const earned = checkInPoints(streak);
      const awarded = await points.award({
        userId,
        reason: "CHECK_IN",
        refKey: today,
        points: earned,
        day: today,
        createdAt: now,
      });
      // A check-in from another tab can win the race; the unique key keeps it to one.
      return awarded
        ? { ok: true, points: earned, streak }
        : { ok: false, error: "ALREADY_CHECKED_IN" };
    },

    /** The first vote on each deal earns a point; changing or re-casting it earns nothing. */
    async forVote(userId: string, dealId: string, now: Date): Promise<void> {
      await points.award({
        userId,
        reason: "VOTE",
        refKey: dealId,
        points: POINTS.vote,
        day: ukDay(now),
        createdAt: now,
      });
    },

    /** Each comment earns points, up to a few a day so posting can't be farmed. */
    async forComment(userId: string, commentId: string, now: Date): Promise<void> {
      const day = ukDay(now);
      if ((await points.countForDay(userId, "COMMENT", day)) >= POINTS.commentsPerDay) return;
      await points.award({
        userId,
        reason: "COMMENT",
        refKey: commentId,
        points: POINTS.comment,
        day,
        createdAt: now,
      });
    },

    async summary(userId: string, now: Date): Promise<PointsSummary> {
      const today = ukDay(now);
      const [balance, days, recent] = await Promise.all([
        points.balance(userId),
        points.checkInDays(userId),
        points.recent(userId, 20),
      ]);
      return {
        balance,
        streak: checkInStreak(days, today),
        checkedInToday: days.includes(today),
        recent: recent.map((e) => ({
          id: e.id,
          label: POINTS_REASON_LABELS[e.reason],
          points: e.points,
          createdAt: e.createdAt,
        })),
      };
    },
  };
}

export type PointsService = ReturnType<typeof createPointsService>;

/** What voting and commenting need, so they can award points without depending on this module. */
export type PointsAwards = Pick<PointsService, "forVote" | "forComment">;
