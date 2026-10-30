import type { PriceStats } from "@/server/pricing";

export type ReferenceType = "PREVIOUS" | "AVG_30" | "AVG_90";

export type DealThresholds = {
  /** Minimum discount against the reference price, in basis points. */
  minDiscountBps: number;
  /** Minimum saving against the reference price, in pence. */
  minSaving: number;
  /** Minimum score (0–100). */
  minScore: number;
};

export type DealEngineConfig = {
  currency: string;
  /** The current price must have been observed within this long. */
  maxPriceAgeMs: number;
  /** The first observation must be at least this old. */
  minHistoryMs: number;
  /** A previous price that ended longer ago than this is not used as a reference. */
  maxPreviousPriceAgeMs: number;
  thresholds: DealThresholds;
  /** Per-category overrides, keyed by category slug. */
  categoryThresholds: Readonly<Record<string, Partial<DealThresholds>>>;
};

export type DealEvaluationInput = {
  stats: PriceStats;
  now: Date;
  retailer: { isActive: boolean; trustScore: number };
  product: { rating: number | null; reviewCount: number | null; categorySlug: string | null };
};

export type ScoreComponentKey =
  | "discountDepth"
  | "belowAverage90"
  | "historicalLow"
  | "savingAmount"
  | "retailerTrust"
  | "socialProof";

export type ScoreBreakdown = {
  components: { key: ScoreComponentKey; points: number; max: number }[];
  penalties: { key: "inflatedPreviousPrice"; points: number }[];
  total: number;
};

/** Everything needed to create a Deal row; mirrors the Deal snapshot columns. */
export type DealCandidate = {
  dealPrice: number;
  referencePrice: number;
  referenceType: ReferenceType;
  savingAmount: number;
  discountBps: number;
  historicalLow: number | null;
  avg30Price: number | null;
  avg90Price: number | null;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  /** Human-readable explanation for reviewers. */
  reasons: string[];
  engineVersion: string;
};

export type RejectionCode =
  | "NO_CURRENT_PRICE"
  | "NOT_AVAILABLE"
  | "STALE_PRICE"
  | "CURRENCY_MISMATCH"
  | "INSUFFICIENT_HISTORY"
  | "RETAILER_INACTIVE"
  | "NO_REFERENCE_PRICE"
  | "NO_DISCOUNT"
  | "DISCOUNT_TOO_SMALL"
  | "SAVING_TOO_SMALL"
  | "SCORE_TOO_LOW";

export type Rejection = { code: RejectionCode; message: string };

export type DealEvaluation =
  | { isDeal: true; candidate: DealCandidate; rejections: [] }
  /** `candidate` is present when a discount exists but misses a threshold, to help tuning. */
  | { isDeal: false; candidate: DealCandidate | null; rejections: Rejection[] };
