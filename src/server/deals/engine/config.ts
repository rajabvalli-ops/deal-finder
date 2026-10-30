import type { DealEngineConfig, DealThresholds } from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_DEAL_ENGINE_CONFIG: DealEngineConfig = {
  currency: "GBP",
  maxPriceAgeMs: 24 * HOUR_MS,
  minHistoryMs: 14 * DAY_MS,
  maxPreviousPriceAgeMs: 60 * DAY_MS,
  thresholds: { minDiscountBps: 1000, minSaving: 500, minScore: 35 },
  categoryThresholds: {},
};

export function thresholdsFor(
  config: DealEngineConfig,
  categorySlug: string | null,
): DealThresholds {
  const override = categorySlug ? config.categoryThresholds[categorySlug] : undefined;
  return { ...config.thresholds, ...override };
}
