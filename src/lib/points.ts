import { UK_TIME_ZONE } from "./quiet-hours";

// Points: a thank-you for taking part. They have no cash value and can't be exchanged for
// anything; there is no prize draw.

export const POINTS = {
  /** Every day you check in. */
  checkIn: 10,
  /** Extra on every 7th day in a row. */
  weeklyStreakBonus: 30,
  /** The first time you vote on a deal. */
  vote: 1,
  /** Each comment, up to `commentsPerDay` a day. */
  comment: 2,
  commentsPerDay: 5,
} as const;

export type PointsReason = "CHECK_IN" | "VOTE" | "COMMENT";

export const POINTS_REASON_LABELS: Record<PointsReason, string> = {
  CHECK_IN: "Daily check-in",
  VOTE: "Voted on a deal",
  COMMENT: "Commented on a deal",
};

const ukDayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: UK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The UK calendar day of a moment, as "YYYY-MM-DD". */
export function ukDay(at: Date): string {
  return ukDayFormat.format(at);
}

/** The day before a "YYYY-MM-DD" day. */
export function previousDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Days in a row checked in, counting back from `today` (or from yesterday if today's check-in
 * hasn't happened yet). `days` are "YYYY-MM-DD", in any order.
 */
export function checkInStreak(days: Iterable<string>, today: string): number {
  const set = new Set(days);
  let day = set.has(today) ? today : previousDay(today);
  let streak = 0;
  while (set.has(day)) {
    streak += 1;
    day = previousDay(day);
  }
  return streak;
}

/** Points for a check-in that makes the streak `streak` days long. */
export function checkInPoints(streak: number): number {
  return POINTS.checkIn + (streak > 0 && streak % 7 === 0 ? POINTS.weeklyStreakBonus : 0);
}
