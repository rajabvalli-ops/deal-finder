import { ratioToBps } from "@/lib/money";
import type { DealEvaluationInput, ScoreBreakdown, ScoreComponentKey } from "./types";

// Scoring weights (sum to 100). Changing any value here must bump DEAL_ENGINE_VERSION.
export const SCORE_WEIGHTS: Readonly<Record<ScoreComponentKey, number>> = {
  discountDepth: 40,
  historicalLow: 20,
  belowAverage90: 15,
  savingAmount: 10,
  retailerTrust: 10,
  socialProof: 5,
};

/** Discount (bps) against the reference that earns full discount-depth points. */
export const FULL_DISCOUNT_BPS = 5000;
/** Discount (bps) against the 90-day average that earns full points. */
export const FULL_BELOW_AVERAGE_BPS = 3000;
/** Within this distance (bps) above the historical low, points scale down to zero. */
export const NEAR_LOW_BPS = 500;
/** A previous price this far (bps) above the 90-day average is treated as suspicious. */
export const INFLATED_PREVIOUS_BPS = 1000;
export const INFLATED_PREVIOUS_PENALTY = 15;

/** [minimum saving in pence, points], checked in order. */
const SAVING_TIERS: readonly (readonly [number, number])[] = [
  [10_000, 10],
  [5_000, 8],
  [2_500, 6],
  [1_000, 4],
  [500, 2],
];

/** max × clamp(value, 0, full) / full, rounded half-up, in integer arithmetic. */
export function scale(max: number, value: number, full: number): number {
  const v = Math.min(Math.max(value, 0), full);
  return Math.floor((2 * max * v + full) / (2 * full));
}

function socialProofPoints(rating: number | null, reviewCount: number | null): number {
  if (rating === null || reviewCount === null) return 0;
  if (rating >= 4 && reviewCount >= 50) return 5;
  if (rating >= 4 && reviewCount >= 10) return 3;
  if (rating >= 3.5 && reviewCount >= 10) return 1;
  return 0;
}

export function isPreviousPriceInflated(previous: number | null, avg90: number | null): boolean {
  if (previous === null || avg90 === null || avg90 === 0) return false;
  return ratioToBps(previous - avg90, avg90) > INFLATED_PREVIOUS_BPS;
}

export function computeScore(
  input: DealEvaluationInput,
  current: number,
  discountBps: number,
  saving: number,
): ScoreBreakdown {
  const { stats, retailer, product } = input;
  const w = SCORE_WEIGHTS;

  const belowAvg90 = stats.avg90 ? ratioToBps(stats.avg90 - current, stats.avg90) : 0;
  const low = stats.lowest;
  const lowPoints =
    low === null
      ? 0
      : current <= low
        ? w.historicalLow
        : low === 0
          ? 0
          : scale(w.historicalLow, NEAR_LOW_BPS - ratioToBps(current - low, low), NEAR_LOW_BPS);

  const components: ScoreBreakdown["components"] = [
    {
      key: "discountDepth",
      points: scale(w.discountDepth, discountBps, FULL_DISCOUNT_BPS),
      max: w.discountDepth,
    },
    { key: "historicalLow", points: lowPoints, max: w.historicalLow },
    {
      key: "belowAverage90",
      points: scale(w.belowAverage90, belowAvg90, FULL_BELOW_AVERAGE_BPS),
      max: w.belowAverage90,
    },
    {
      key: "savingAmount",
      points: SAVING_TIERS.find(([min]) => saving >= min)?.[1] ?? 0,
      max: w.savingAmount,
    },
    {
      key: "retailerTrust",
      points: scale(w.retailerTrust, retailer.trustScore, 100),
      max: w.retailerTrust,
    },
    {
      key: "socialProof",
      points: socialProofPoints(product.rating, product.reviewCount),
      max: w.socialProof,
    },
  ];

  const penalties: ScoreBreakdown["penalties"] = isPreviousPriceInflated(
    stats.previous,
    stats.avg90,
  )
    ? [{ key: "inflatedPreviousPrice", points: INFLATED_PREVIOUS_PENALTY }]
    : [];

  const raw =
    components.reduce((sum, c) => sum + c.points, 0) -
    penalties.reduce((sum, p) => sum + p.points, 0);
  return { components, penalties, total: Math.min(Math.max(raw, 0), 100) };
}
