import { formatBps, formatPrice, ratioToBps } from "@/lib/money";
import { compareToReference } from "@/server/pricing";
import { DEFAULT_DEAL_ENGINE_CONFIG, thresholdsFor } from "./config";
import { computeScore, isPreviousPriceInflated, NEAR_LOW_BPS } from "./score";
import type {
  DealCandidate,
  DealEngineConfig,
  DealEvaluation,
  DealEvaluationInput,
  ReferenceType,
  Rejection,
} from "./types";

// Deterministic deal detection. Pure: no database, clock, randomness or AI — `now` is an input.
// Changing any rule, threshold default or weight must bump DEAL_ENGINE_VERSION.

export const DEAL_ENGINE_VERSION = "deal-engine@1";

const REFERENCE_LABELS: Record<ReferenceType, string> = {
  PREVIOUS: "previous price",
  AVG_30: "30-day average",
  AVG_90: "90-day average",
};

function eligibilityRejections(input: DealEvaluationInput, config: DealEngineConfig): Rejection[] {
  const { stats, now, retailer } = input;
  const nowMs = now.getTime();
  const rejections: Rejection[] = [];
  if (!stats.isAvailable) {
    rejections.push({ code: "NOT_AVAILABLE", message: "Not currently available to buy" });
  }
  if (stats.lastObservedAt && nowMs - stats.lastObservedAt.getTime() > config.maxPriceAgeMs) {
    rejections.push({
      code: "STALE_PRICE",
      message: "The current price has not been re-checked recently",
    });
  }
  if (stats.currency !== null && stats.currency !== config.currency) {
    rejections.push({
      code: "CURRENCY_MISMATCH",
      message: `Prices are in ${stats.currency}, not ${config.currency}`,
    });
  }
  if (stats.firstObservedAt && nowMs - stats.firstObservedAt.getTime() < config.minHistoryMs) {
    rejections.push({
      code: "INSUFFICIENT_HISTORY",
      message: "Not enough price history to judge a discount",
    });
  }
  if (!retailer.isActive) {
    rejections.push({ code: "RETAILER_INACTIVE", message: "The retailer is not active" });
  }
  return rejections;
}

/** The most conservative credible comparison price: the lowest of the recent previous price and averages. */
function chooseReference(
  input: DealEvaluationInput,
  config: DealEngineConfig,
): { type: ReferenceType; price: number } | null {
  const { stats, now } = input;
  const options: { type: ReferenceType; price: number | null }[] = [
    {
      type: "PREVIOUS",
      price:
        stats.previousUntil &&
        now.getTime() - stats.previousUntil.getTime() <= config.maxPreviousPriceAgeMs
          ? stats.previous
          : null,
    },
    { type: "AVG_30", price: stats.avg30 },
    { type: "AVG_90", price: stats.avg90 },
  ];
  let best: { type: ReferenceType; price: number } | null = null;
  for (const { type, price } of options) {
    if (price !== null && price > 0 && (best === null || price < best.price))
      best = { type, price };
  }
  return best;
}

function buildReasons(
  input: DealEvaluationInput,
  current: number,
  reference: { type: ReferenceType; price: number },
  discountBps: number,
  saving: number,
): string[] {
  const { lowest, avg90, previous } = input.stats;
  const reasons = [
    `${formatBps(discountBps)} below the ${REFERENCE_LABELS[reference.type]} (${formatPrice(reference.price)})`,
  ];
  if (lowest !== null && current <= lowest) {
    reasons.push("Lowest price recorded");
  } else if (lowest !== null && lowest > 0) {
    const gap = ratioToBps(current - lowest, lowest);
    if (gap <= NEAR_LOW_BPS) {
      reasons.push(
        `Within ${formatBps(gap)} of the lowest recorded price (${formatPrice(lowest)})`,
      );
    }
  }
  // The reference is never above the 90-day average, so a discount implies a positive gap here.
  if (avg90 && reference.type !== "AVG_90") {
    const below = ratioToBps(avg90 - current, avg90);
    reasons.push(`${formatBps(below)} below the 90-day average (${formatPrice(avg90)})`);
  }
  reasons.push(`Saving ${formatPrice(saving)}`);
  if (isPreviousPriceInflated(previous, avg90)) {
    reasons.push(
      `Check the previous price (${formatPrice(previous!)}): it was well above the 90-day average`,
    );
  }
  return reasons;
}

/** Decides whether a variant's current price is a deal, and explains why or why not. */
export function evaluateDeal(
  input: DealEvaluationInput,
  config: DealEngineConfig = DEFAULT_DEAL_ENGINE_CONFIG,
): DealEvaluation {
  const current = input.stats.current;
  if (current === null) {
    return {
      isDeal: false,
      candidate: null,
      rejections: [{ code: "NO_CURRENT_PRICE", message: "No price has been observed" }],
    };
  }
  const eligibility = eligibilityRejections(input, config);
  if (eligibility.length > 0) {
    return { isDeal: false, candidate: null, rejections: eligibility };
  }

  const reference = chooseReference(input, config);
  if (!reference) {
    return {
      isDeal: false,
      candidate: null,
      rejections: [{ code: "NO_REFERENCE_PRICE", message: "No reliable price to compare against" }],
    };
  }

  const { saving, discountBps } = compareToReference(current, reference.price);
  if (saving <= 0) {
    return {
      isDeal: false,
      candidate: null,
      rejections: [
        { code: "NO_DISCOUNT", message: `Not below the ${REFERENCE_LABELS[reference.type]}` },
      ],
    };
  }

  const scoreBreakdown = computeScore(input, current, discountBps, saving);
  const candidate: DealCandidate = {
    dealPrice: current,
    referencePrice: reference.price,
    referenceType: reference.type,
    savingAmount: saving,
    discountBps,
    historicalLow: input.stats.lowest,
    avg30Price: input.stats.avg30,
    avg90Price: input.stats.avg90,
    score: scoreBreakdown.total,
    scoreBreakdown,
    reasons: buildReasons(input, current, reference, discountBps, saving),
    engineVersion: DEAL_ENGINE_VERSION,
  };

  const t = thresholdsFor(config, input.product.categorySlug);
  const rejections: Rejection[] = [];
  if (discountBps < t.minDiscountBps) {
    rejections.push({
      code: "DISCOUNT_TOO_SMALL",
      message: `Discount is below ${formatBps(t.minDiscountBps)}`,
    });
  }
  if (saving < t.minSaving) {
    rejections.push({
      code: "SAVING_TOO_SMALL",
      message: `Saving is below ${formatPrice(t.minSaving)}`,
    });
  }
  if (candidate.score < t.minScore) {
    rejections.push({
      code: "SCORE_TOO_LOW",
      message: `Score ${candidate.score} is below ${t.minScore}`,
    });
  }

  return rejections.length > 0
    ? { isDeal: false, candidate, rejections }
    : { isDeal: true, candidate, rejections: [] };
}
