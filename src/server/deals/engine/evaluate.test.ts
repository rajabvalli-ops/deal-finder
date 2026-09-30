import { describe, expect, it } from "vitest";
import { computePriceStats, type PriceObservation, type PriceStats } from "@/server/pricing";
import { DEFAULT_DEAL_ENGINE_CONFIG, thresholdsFor } from "./config";
import { DEAL_ENGINE_VERSION, evaluateDeal } from "./evaluate";
import type { DealEvaluation, DealEvaluationInput } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(Date.UTC(2026, 3, 10, 12));
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/** 100 days at £100, then £80 for the last 12 hours (the Stage 4 drop scenario). */
function baseStats(overrides: Partial<PriceStats> = {}): PriceStats {
  return {
    engineVersion: "pricing@1",
    currency: "GBP",
    observationCount: 101,
    firstObservedAt: ago(100 * DAY + 12 * HOUR),
    lastObservedAt: ago(12 * HOUR),
    current: 8000,
    currentSince: ago(12 * HOUR),
    isAvailable: true,
    previous: 10000,
    previousUntil: ago(12 * HOUR),
    lowest: 8000,
    highest: 10000,
    avg7: 9857,
    avg30: 9967,
    avg90: 9989,
    changeBps: -2000,
    vsPrevious: { saving: 2000, discountBps: 2000 },
    ...overrides,
  };
}

function input(
  stats: Partial<PriceStats> = {},
  extra: Partial<Omit<DealEvaluationInput, "stats">> = {},
): DealEvaluationInput {
  return {
    stats: baseStats(stats),
    now: NOW,
    retailer: { isActive: true, trustScore: 50 },
    product: { rating: null, reviewCount: null, categorySlug: null },
    ...extra,
  };
}

const codes = (result: DealEvaluation) => result.rejections.map((r) => r.code);

describe("evaluateDeal — a genuine drop", () => {
  const result = evaluateDeal(input());

  it("is a deal measured against the most conservative reference", () => {
    expect(result.isDeal).toBe(true);
    expect(result.candidate).toMatchObject({
      dealPrice: 8000,
      referencePrice: 9967, // min(previous 10000, avg30 9967, avg90 9989)
      referenceType: "AVG_30",
      savingAmount: 1967,
      discountBps: 1974,
      historicalLow: 8000,
      avg30Price: 9967,
      avg90Price: 9989,
      engineVersion: DEAL_ENGINE_VERSION,
    });
  });

  it("scores it from explainable components", () => {
    expect(result.candidate?.scoreBreakdown).toEqual({
      components: [
        { key: "discountDepth", points: 16, max: 40 }, // 40 × 1974 / 5000
        { key: "historicalLow", points: 20, max: 20 }, // at the low
        { key: "belowAverage90", points: 10, max: 15 }, // 15 × 1991 / 3000
        { key: "savingAmount", points: 4, max: 10 }, // £19.67 → £10+ tier
        { key: "retailerTrust", points: 5, max: 10 }, // trust 50
        { key: "socialProof", points: 0, max: 5 },
      ],
      penalties: [],
      total: 55,
    });
    expect(result.candidate?.score).toBe(55);
  });

  it("explains itself", () => {
    expect(result.candidate?.reasons).toEqual([
      "19.7% below the 30-day average (£99.67)",
      "Lowest price recorded",
      "19.9% below the 90-day average (£99.89)",
      "Saving £19.67",
    ]);
  });

  it("is deterministic and leaves its input untouched", () => {
    const i = input();
    const snapshot = structuredClone(i);
    expect(evaluateDeal(i)).toEqual(evaluateDeal(i));
    expect(i).toEqual(snapshot);
  });
});

describe("evaluateDeal — eligibility", () => {
  it("rejects a variant with no price", () => {
    expect(codes(evaluateDeal(input({ current: null })))).toEqual(["NO_CURRENT_PRICE"]);
  });

  it.each([
    ["NOT_AVAILABLE", input({ isAvailable: false })],
    ["STALE_PRICE", input({ lastObservedAt: ago(25 * HOUR) })],
    ["CURRENCY_MISMATCH", input({ currency: "EUR" })],
    ["INSUFFICIENT_HISTORY", input({ firstObservedAt: ago(13 * DAY) })],
    ["RETAILER_INACTIVE", input({}, { retailer: { isActive: false, trustScore: 50 } })],
  ])("rejects with %s", (code, i) => {
    const result = evaluateDeal(i);
    expect(result).toMatchObject({ isDeal: false, candidate: null });
    expect(codes(result)).toEqual([code]);
    expect(result.rejections[0]?.message).toBeTruthy();
  });

  it("accepts a price checked exactly at the age limit and history exactly at the minimum", () => {
    const result = evaluateDeal(
      input({ lastObservedAt: ago(24 * HOUR), firstObservedAt: ago(14 * DAY) }),
    );
    expect(result.isDeal).toBe(true);
  });

  it("reports every eligibility problem at once", () => {
    const result = evaluateDeal(
      input(
        { isAvailable: false, currency: "USD" },
        { retailer: { isActive: false, trustScore: 50 } },
      ),
    );
    expect(codes(result)).toEqual(["NOT_AVAILABLE", "CURRENCY_MISMATCH", "RETAILER_INACTIVE"]);
  });
});

describe("evaluateDeal — reference price", () => {
  it.each([
    ["PREVIOUS", { previous: 9000, avg30: 9500, avg90: 9600 }, 9000],
    ["AVG_90", { previous: 10000, avg30: 9967, avg90: 9500 }, 9500],
    ["PREVIOUS", { previous: 9500, avg30: 9500, avg90: 9600 }, 9500], // ties prefer the previous price
  ] as const)("picks %s when it is lowest", (type, stats, price) => {
    const result = evaluateDeal(input(stats));
    expect(result.candidate).toMatchObject({ referenceType: type, referencePrice: price });
  });

  it("ignores a previous price that ended too long ago", () => {
    const stats = { avg30: null, avg90: null, previous: 10000 };
    expect(codes(evaluateDeal(input({ ...stats, previousUntil: ago(61 * DAY) })))).toEqual([
      "NO_REFERENCE_PRICE",
    ]);
    expect(
      evaluateDeal(input({ ...stats, previousUntil: ago(59 * DAY) })).candidate?.referenceType,
    ).toBe("PREVIOUS");
  });

  it.each([
    [
      "no previous price or averages",
      { previous: null, previousUntil: null, avg30: null, avg90: null },
    ],
    ["a zero previous price", { previous: 0, avg30: null, avg90: null }],
  ])("has no reference with %s", (_label, stats) => {
    expect(codes(evaluateDeal(input(stats)))).toEqual(["NO_REFERENCE_PRICE"]);
  });

  it("is not a deal when the price is not below the reference", () => {
    const result = evaluateDeal(input({ current: 9967, lowest: 8000 }));
    expect(result).toMatchObject({ isDeal: false, candidate: null });
    expect(codes(result)).toEqual(["NO_DISCOUNT"]);
  });

  it("sees through an inflated 'was' price", () => {
    // 90 days at £100, raised to £150 for 3 days, then "reduced" to £120.
    const history: PriceObservation[] = [
      ...Array.from({ length: 90 }, (_, d) => obs(d, 10000)),
      obs(90, 15000),
      obs(91, 15000),
      obs(92, 15000),
      obs(93, 12000),
    ];
    const now = at(93, 1);
    const stats = computePriceStats(history, now);
    expect(stats.previous).toBe(15000); // a naive "was £150, now £120 (20% off)"
    const result = evaluateDeal({ ...input(), stats, now });
    expect(codes(result)).toEqual(["NO_DISCOUNT"]); // £120 is above the 30-day average
  });
});

describe("evaluateDeal — thresholds", () => {
  const flat = { previous: 10000, avg30: 10000, avg90: 10000 };

  it("rejects a small discount but still returns the candidate for tuning", () => {
    const result = evaluateDeal(input({ ...flat, current: 9500, lowest: 9500 }));
    expect(result.isDeal).toBe(false);
    expect(result.candidate).toMatchObject({ discountBps: 500, savingAmount: 500, score: 34 });
    expect(codes(result)).toEqual(["DISCOUNT_TOO_SMALL", "SCORE_TOO_LOW"]);
    expect(result.rejections.map((r) => r.message)).toEqual([
      "Discount is below 10%",
      "Score 34 is below 35",
    ]);
  });

  it("rejects a small saving on a cheap item", () => {
    const cheap = { previous: 1000, avg30: 1000, avg90: 1000, current: 700, lowest: 700 };
    const result = evaluateDeal(input(cheap));
    expect(result.candidate).toMatchObject({ discountBps: 3000, savingAmount: 300, score: 64 });
    expect(codes(result)).toEqual(["SAVING_TOO_SMALL"]);
    expect(result.rejections[0]?.message).toBe("Saving is below £5.00");
  });

  it("applies per-category overrides", () => {
    const cheap = { previous: 1000, avg30: 1000, avg90: 1000, current: 700, lowest: 700 };
    const config = {
      ...DEFAULT_DEAL_ENGINE_CONFIG,
      categoryThresholds: { "food-drink": { minSaving: 200 } },
    };
    const product = { rating: null, reviewCount: null, categorySlug: "food-drink" };
    expect(evaluateDeal(input(cheap, { product }), config).isDeal).toBe(true);
    expect(evaluateDeal(input(cheap), config).isDeal).toBe(false);
  });
});

describe("evaluateDeal — scoring details", () => {
  it("penalises a previous price well above the 90-day average and flags it", () => {
    const result = evaluateDeal(input({ previous: 13000, avg30: 10000, avg90: 10000 }));
    const candidate = result.candidate!;
    expect(candidate.referenceType).toBe("AVG_30");
    expect(candidate.scoreBreakdown.penalties).toEqual([
      { key: "inflatedPreviousPrice", points: 15 },
    ]);
    expect(candidate.score).toBe(40); // 16 + 20 + 10 + 4 + 5 − 15
    expect(candidate.reasons).toContain(
      "Check the previous price (£130.00): it was well above the 90-day average",
    );
  });

  it.each([
    [11000, false], // exactly 10% above: not penalised
    [11001, true],
  ])("previous %s against a £100 average → penalty %s", (previous, penalised) => {
    const result = evaluateDeal(input({ previous, avg30: 10000, avg90: 10000 }));
    expect(result.candidate!.scoreBreakdown.penalties.length > 0).toBe(penalised);
  });

  it("gives partial points near the historical low", () => {
    const result = evaluateDeal(input({ lowest: 7800 }));
    const low = result.candidate!.scoreBreakdown.components.find((c) => c.key === "historicalLow");
    expect(low?.points).toBe(10); // 2.56% above the low → 20 × (500 − 256) / 500
    expect(result.candidate!.reasons).toContain(
      "Within 2.6% of the lowest recorded price (£78.00)",
    );
  });

  it.each([
    ["far above the low", { lowest: 5000 }],
    ["a zero low", { lowest: 0 }],
    ["no recorded low", { lowest: null }],
  ])("gives no low points when %s", (_label, stats) => {
    const result = evaluateDeal(input(stats));
    const low = result.candidate!.scoreBreakdown.components.find((c) => c.key === "historicalLow");
    expect(low?.points).toBe(0);
    expect(result.candidate!.reasons.some((r) => r.includes("lowest"))).toBe(false);
  });

  it("scores without a 90-day average", () => {
    const result = evaluateDeal(input({ avg90: null }));
    const below90 = result.candidate!.scoreBreakdown.components.find(
      (c) => c.key === "belowAverage90",
    );
    expect(below90?.points).toBe(0);
    expect(result.candidate!.reasons.some((r) => r.includes("90-day"))).toBe(false);
  });

  it("does not repeat the 90-day average when it is the reference", () => {
    const result = evaluateDeal(input({ avg90: 9500 }));
    expect(result.candidate!.reasons.filter((r) => r.includes("90-day"))).toEqual([
      "15.8% below the 90-day average (£95.00)",
    ]);
  });

  it("never scores below zero", () => {
    // Tiny discount, far from the low, untrusted retailer, suspicious previous price.
    const result = evaluateDeal(
      input(
        { previous: 20000, avg30: 10000, avg90: 10000, current: 9500, lowest: 5000 },
        { retailer: { isActive: true, trustScore: 0 } },
      ),
    );
    expect(result.candidate!.score).toBe(0);
  });

  it("can reach the maximum score of 100", () => {
    const result = evaluateDeal(
      input(
        {
          previous: 30000,
          avg30: 30000,
          avg90: 30000,
          current: 10000,
          lowest: 10000,
          highest: 30000,
        },
        {
          retailer: { isActive: true, trustScore: 100 },
          product: { rating: 4.8, reviewCount: 500, categorySlug: null },
        },
      ),
    );
    expect(result.candidate!.score).toBe(100);
    expect(result.candidate!.scoreBreakdown.components.every((c) => c.points === c.max)).toBe(true);
  });
});

describe("thresholdsFor", () => {
  const config = {
    ...DEFAULT_DEAL_ENGINE_CONFIG,
    categoryThresholds: { tvs: { minDiscountBps: 1500 } },
  };

  it.each([null, "unknown"])("uses defaults for %s", (slug) => {
    expect(thresholdsFor(config, slug)).toEqual(DEFAULT_DEAL_ENGINE_CONFIG.thresholds);
  });

  it("merges a category override", () => {
    expect(thresholdsFor(config, "tvs")).toEqual({
      minDiscountBps: 1500,
      minSaving: 500,
      minScore: 35,
    });
  });
});

describe("with the pricing engine", () => {
  it("finds the Stage 4 drop scenario to be a deal", () => {
    const history = [...Array.from({ length: 100 }, (_, d) => obs(d, 10000)), obs(100, 8000)];
    const now = at(100, 12);
    const stats = computePriceStats(history, now);
    const result = evaluateDeal({ ...input(), stats, now });
    expect(result.isDeal).toBe(true);
    expect(result.candidate).toMatchObject({ referencePrice: 9967, discountBps: 1974, score: 55 });
  });
});

const T0 = Date.UTC(2026, 0, 1);
function at(days: number, hours = 0) {
  return new Date(T0 + days * DAY + hours * HOUR);
}
function obs(days: number, price: number): PriceObservation {
  return { price, currency: "GBP", availability: "IN_STOCK", observedAt: at(days) };
}
