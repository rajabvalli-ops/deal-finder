import type { DealEngineConfig, DealLevel, DealThresholds } from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_DEAL_ENGINE_CONFIG: DealEngineConfig = {
  currency: "GBP",
  maxPriceAgeMs: 24 * HOUR_MS,
  minHistoryMs: 14 * DAY_MS,
  maxPreviousPriceAgeMs: 60 * DAY_MS,
  thresholds: { minDiscountBps: 1000, minSaving: 500, minScore: 35 },
  categoryThresholds: {},
  levels: { bigDropBps: 3500, priceErrorBps: 7000 },
};

export function thresholdsFor(
  config: DealEngineConfig,
  categorySlug: string | null,
): DealThresholds {
  const override = categorySlug ? config.categoryThresholds[categorySlug] : undefined;
  return { ...config.thresholds, ...override };
}

const LEVEL_RANK: Readonly<Record<DealLevel, number>> = { NORMAL: 0, BIG_DROP: 1, PRICE_ERROR: 2 };

/** The level of a deal with this discount. */
export function dealLevel(discountBps: number, config: DealEngineConfig): DealLevel {
  if (discountBps >= config.levels.priceErrorBps) return "PRICE_ERROR";
  if (discountBps >= config.levels.bigDropBps) return "BIG_DROP";
  return "NORMAL";
}

/** True when `level` is more striking than `than`. */
export function isHigherLevel(level: DealLevel, than: DealLevel): boolean {
  return LEVEL_RANK[level] > LEVEL_RANK[than];
}
