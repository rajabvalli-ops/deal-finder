import { describe, expect, it } from "vitest";
import type { PriceStats } from "@/server/pricing";
import { computeScore, isPreviousPriceInflated, scale, SCORE_WEIGHTS } from "./score";
import type { DealEvaluationInput } from "./types";

const stats = {
  previous: 10000,
  avg90: 10000,
  lowest: 5000,
} as PriceStats;

function points(
  key: string,
  opts: { saving?: number; trust?: number; rating?: number | null; reviews?: number | null },
) {
  const input: DealEvaluationInput = {
    stats,
    now: new Date(0),
    retailer: { isActive: true, trustScore: opts.trust ?? 0 },
    product: { rating: opts.rating ?? null, reviewCount: opts.reviews ?? null, categorySlug: null },
  };
  const breakdown = computeScore(input, 9000, 1000, opts.saving ?? 0);
  return breakdown.components.find((c) => c.key === key)?.points;
}

describe("scoring weights", () => {
  it("sum to 100", () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("scale", () => {
  it.each([
    [40, 0, 5000, 0],
    [40, -100, 5000, 0],
    [40, 5000, 5000, 40],
    [40, 9000, 5000, 40],
    [10, 55, 100, 6], // 5.5 rounds half-up
    [10, 54, 100, 5],
    [15, 1991, 3000, 10],
  ])("scale(%s, %s, %s) = %s", (max, value, full, expected) => {
    expect(scale(max, value, full)).toBe(expected);
  });
});

describe("saving tiers", () => {
  it.each([
    [10_000, 10],
    [9_999, 8],
    [5_000, 8],
    [2_500, 6],
    [1_000, 4],
    [500, 2],
    [499, 0],
  ])("saving %s pence → %s points", (saving, expected) => {
    expect(points("savingAmount", { saving })).toBe(expected);
  });
});

describe("retailer trust", () => {
  it.each([
    [0, 0],
    [50, 5],
    [55, 6],
    [100, 10],
  ])("trust %s → %s points", (trust, expected) => {
    expect(points("retailerTrust", { trust })).toBe(expected);
  });
});

describe("social proof", () => {
  it.each([
    [4.5, 100, 5],
    [4.0, 50, 5],
    [4.0, 49, 3],
    [4.0, 10, 3],
    [3.5, 10, 1],
    [3.9, 1000, 1],
    [3.4, 1000, 0],
    [5.0, 9, 0],
    [null, 100, 0],
    [4.5, null, 0],
  ])("rating %s with %s reviews → %s points", (rating, reviews, expected) => {
    expect(points("socialProof", { rating, reviews })).toBe(expected);
  });
});

describe("isPreviousPriceInflated", () => {
  it.each([
    [11001, 10000, true],
    [11000, 10000, false],
    [9000, 10000, false],
    [null, 10000, false],
    [11001, null, false],
    [11001, 0, false],
  ])("previous %s vs average %s → %s", (previous, avg90, expected) => {
    expect(isPreviousPriceInflated(previous, avg90)).toBe(expected);
  });
});
