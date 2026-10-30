import { describe, expect, it } from "vitest";
import { computePriceStats } from "@/server/pricing";
import { toPriceSnapshot } from "./price-snapshot";

describe("toPriceSnapshot", () => {
  it("copies the pricing engine's figures onto the product columns", () => {
    const now = new Date(Date.UTC(2026, 0, 31));
    const history = Array.from({ length: 30 }, (_, d) => ({
      price: d < 29 ? 10000 : 8000,
      currency: "GBP",
      availability: "IN_STOCK" as const,
      observedAt: new Date(Date.UTC(2026, 0, 1 + d)),
    }));
    const stats = computePriceStats(history, now);
    expect(toPriceSnapshot(stats, now)).toEqual({
      currentPrice: 8000,
      previousPrice: 10000,
      lowestPrice: 8000,
      highestPrice: 10000,
      avg7Price: stats.avg7,
      avg30Price: stats.avg30,
      avg90Price: null,
      priceUpdatedAt: now,
    });
  });

  it("stores nulls for a product with no history", () => {
    const now = new Date(0);
    expect(toPriceSnapshot(computePriceStats([], now), now)).toEqual({
      currentPrice: null,
      previousPrice: null,
      lowestPrice: null,
      highestPrice: null,
      avg7Price: null,
      avg30Price: null,
      avg90Price: null,
      priceUpdatedAt: now,
    });
  });
});
