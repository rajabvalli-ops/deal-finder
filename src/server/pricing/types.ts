// Plain types for the pricing engine. Structurally compatible with the database enums,
// but defined here so the engine has no dependency on Prisma.

export type Availability =
  "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "DISCONTINUED" | "UNKNOWN";

export type PriceObservation = {
  /** Pence. */
  price: number;
  /** ISO 4217 code. All observations passed together must share one currency. */
  currency: string;
  availability: Availability;
  observedAt: Date;
};

export type PricingConfig = {
  /** A different price must have been held at least this long to count as the "previous" price. */
  minPreviousPriceHoldMs: number;
  /** An observation is assumed to hold at most this long without a newer one. */
  maxObservationGapMs: number;
  /** Minimum fraction (0–1) of an averaging window that must be covered by purchasable prices. */
  minAverageCoverage: number;
  /** Availabilities whose prices count towards averages, lows, highs and the previous price. */
  purchasable: ReadonlySet<Availability>;
};

/** Saving and discount of a price against a reference. Negative values mean it costs more. */
export type ReferenceComparison = {
  /** reference − price, in pence. */
  saving: number;
  /** saving / reference, in basis points. */
  discountBps: number;
};

export type PriceStats = {
  engineVersion: string;
  currency: string | null;
  observationCount: number;
  firstObservedAt: Date | null;
  lastObservedAt: Date | null;

  /** Latest observed price, whatever its availability. */
  current: number | null;
  /** When the current price run began (same price, same purchasability). */
  currentSince: Date | null;
  /** Whether the latest observation is purchasable. */
  isAvailable: boolean;

  /** Most recent different price held for at least `minPreviousPriceHoldMs`. */
  previous: number | null;
  /** When the previous price stopped applying. */
  previousUntil: Date | null;

  /** Lowest / highest purchasable price in the supplied history. */
  lowest: number | null;
  highest: number | null;

  /** Time-weighted averages over the trailing window; null when coverage is insufficient. */
  avg7: number | null;
  avg30: number | null;
  avg90: number | null;

  /** (current − previous) / previous, in basis points. */
  changeBps: number | null;
  /** Current price against the previous price. */
  vsPrevious: ReferenceComparison | null;
};
