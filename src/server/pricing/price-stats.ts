import { assertPence, ratioToBps } from "@/lib/money";
import type {
  Availability,
  PriceObservation,
  PriceStats,
  PricingConfig,
  ReferenceComparison,
} from "./types";

// Deterministic price statistics. Pure: no database, clock or randomness — `now` is an input.
// Changing any calculation here must bump PRICING_ENGINE_VERSION.

export const PRICING_ENGINE_VERSION = "pricing@1";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  minPreviousPriceHoldMs: 24 * HOUR_MS,
  // Imports record a heartbeat at least daily; allow for a couple of missed runs.
  maxObservationGapMs: 72 * HOUR_MS,
  minAverageCoverage: 0.5,
  purchasable: new Set<Availability>(["IN_STOCK", "LOW_STOCK", "PREORDER", "UNKNOWN"]),
};

/** The period one observation is assumed to hold for. */
type Segment = { price: number; purchasable: boolean; start: number; end: number };

/** Consecutive observations with the same price and purchasability. */
type Run = { price: number; purchasable: boolean; start: number; end: number; durationMs: number };

export function compareToReference(price: number, reference: number): ReferenceComparison {
  assertPence(price, "price");
  assertPence(reference, "reference");
  if (reference === 0) throw new RangeError("reference must be greater than zero");
  const saving = reference - price;
  return { saving, discountBps: ratioToBps(saving, reference) };
}

function validate(observations: readonly PriceObservation[]): void {
  const currencies = new Set<string>();
  for (const o of observations) {
    assertPence(o.price, "price");
    if (!(o.observedAt instanceof Date) || Number.isNaN(o.observedAt.getTime())) {
      throw new RangeError("observedAt must be a valid Date");
    }
    currencies.add(o.currency);
  }
  if (currencies.size > 1) {
    throw new RangeError(`Observations mix currencies: ${[...currencies].join(", ")}`);
  }
}

function toSegments(sorted: readonly PriceObservation[], now: number, config: PricingConfig) {
  return sorted.map((o, i): Segment => {
    const start = o.observedAt.getTime();
    const next = sorted[i + 1]?.observedAt.getTime() ?? now;
    return {
      price: o.price,
      purchasable: config.purchasable.has(o.availability),
      start,
      end: Math.min(next, start + config.maxObservationGapMs, now),
    };
  });
}

function toRuns(segments: readonly Segment[]): Run[] {
  const runs: Run[] = [];
  for (const s of segments) {
    const last = runs.at(-1);
    const durationMs = Math.max(0, s.end - s.start);
    if (last && last.price === s.price && last.purchasable === s.purchasable) {
      last.end = s.end;
      last.durationMs += durationMs;
    } else {
      runs.push({
        price: s.price,
        purchasable: s.purchasable,
        start: s.start,
        end: s.end,
        durationMs,
      });
    }
  }
  return runs;
}

function findPrevious(runs: readonly Run[], current: number, config: PricingConfig): Run | null {
  for (let i = runs.length - 2; i >= 0; i--) {
    const run = runs[i]!;
    if (
      run.purchasable &&
      run.price !== current &&
      run.durationMs >= config.minPreviousPriceHoldMs
    ) {
      return run;
    }
  }
  return null;
}

/** Time-weighted average of purchasable prices over [now − windowMs, now), rounded half-up. */
function timeWeightedAverage(
  segments: readonly Segment[],
  now: number,
  windowMs: number,
  config: PricingConfig,
): number | null {
  const windowStart = now - windowMs;
  let weighted = 0n;
  let covered = 0;
  for (const s of segments) {
    if (!s.purchasable) continue;
    const overlap = Math.min(s.end, now) - Math.max(s.start, windowStart);
    if (overlap <= 0) continue;
    weighted += BigInt(s.price) * BigInt(overlap);
    covered += overlap;
  }
  if (covered === 0 || covered < windowMs * config.minAverageCoverage) return null;
  const total = BigInt(covered);
  return Number((2n * weighted + total) / (2n * total));
}

/**
 * Computes price statistics for one variant from its price observations.
 *
 * - Observations may be in any order; ones after `now` are ignored.
 * - Each observation holds until the next one, capped at `maxObservationGapMs`.
 * - Averages, lows, highs and the previous price only use purchasable observations.
 */
export function computePriceStats(
  observations: readonly PriceObservation[],
  now: Date,
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): PriceStats {
  validate(observations);
  const nowMs = now.getTime();
  const sorted = observations
    .filter((o) => o.observedAt.getTime() <= nowMs)
    .toSorted((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

  const latest = sorted.at(-1);
  if (!latest) {
    return {
      engineVersion: PRICING_ENGINE_VERSION,
      currency: null,
      observationCount: 0,
      firstObservedAt: null,
      lastObservedAt: null,
      current: null,
      currentSince: null,
      isAvailable: false,
      previous: null,
      previousUntil: null,
      lowest: null,
      highest: null,
      avg7: null,
      avg30: null,
      avg90: null,
      changeBps: null,
      vsPrevious: null,
    };
  }

  const segments = toSegments(sorted, nowMs, config);
  const runs = toRuns(segments);
  const currentRun = runs.at(-1)!;
  const current = latest.price;
  const previousRun = findPrevious(runs, current, config);
  const previous = previousRun?.price ?? null;

  const purchasablePrices = sorted
    .filter((o) => config.purchasable.has(o.availability))
    .map((o) => o.price);

  return {
    engineVersion: PRICING_ENGINE_VERSION,
    currency: latest.currency,
    observationCount: sorted.length,
    firstObservedAt: sorted[0]!.observedAt,
    lastObservedAt: latest.observedAt,
    current,
    currentSince: new Date(currentRun.start),
    isAvailable: config.purchasable.has(latest.availability),
    previous,
    previousUntil: previousRun ? new Date(previousRun.end) : null,
    lowest: purchasablePrices.length ? purchasablePrices.reduce((a, b) => Math.min(a, b)) : null,
    highest: purchasablePrices.length ? purchasablePrices.reduce((a, b) => Math.max(a, b)) : null,
    avg7: timeWeightedAverage(segments, nowMs, 7 * DAY_MS, config),
    avg30: timeWeightedAverage(segments, nowMs, 30 * DAY_MS, config),
    avg90: timeWeightedAverage(segments, nowMs, 90 * DAY_MS, config),
    // A previous price of zero has no meaningful percentage change.
    changeBps: previous ? ratioToBps(current - previous, previous) : null,
    vsPrevious: previous ? compareToReference(current, previous) : null,
  };
}
