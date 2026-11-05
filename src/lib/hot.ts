import type { DealLevel } from "./public-types";

// The "Hot" ranking. Postgres keeps it in Deal.hotRank (a generated column, see the
// 20261105180000_deal_votes migration); this mirrors it for tests and explanations.

/** Points a deal starts with for its level, before any votes. */
export const LEVEL_POINTS: Record<DealLevel, number> = { NORMAL: 0, BIG_DROP: 3, PRICE_ERROR: 10 };

/** 2026-01-01T00:00:00Z: the ranking's zero time. */
const EPOCH_SECONDS = 1_767_225_600;
/** Seconds of age worth a factor of ten in points (12.5 hours). */
const SECONDS_PER_DECADE = 45_000;

export function hotPoints(voteScore: number, level: DealLevel): number {
  return voteScore + LEVEL_POINTS[level];
}

export function hotRank(deal: { voteScore: number; level: DealLevel; publishedAt: Date }): number {
  const points = hotPoints(deal.voteScore, deal.level);
  const age = deal.publishedAt.getTime() / 1000 - EPOCH_SECONDS;
  return Math.sign(points) * Math.log10(Math.max(Math.abs(points), 1)) + age / SECONDS_PER_DECADE;
}

/** "12°"-style temperature shown on deals: the vote score, with its sign. */
export function formatVotes(voteScore: number): string {
  return voteScore > 0 ? `+${voteScore}` : String(voteScore);
}
