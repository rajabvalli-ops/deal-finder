import { describe, expect, it } from "vitest";
import {
  compareToReference,
  computePriceStats,
  DEFAULT_PRICING_CONFIG,
  PRICING_ENGINE_VERSION,
} from "./price-stats";
import type { Availability, PriceObservation } from "./types";

const T0 = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (days: number, hours = 0) => new Date(T0 + days * DAY + hours * HOUR);

function obs(
  days: number,
  price: number,
  availability: Availability = "IN_STOCK",
  hours = 0,
): PriceObservation {
  return { price, currency: "GBP", availability, observedAt: at(days, hours) };
}

/** One observation per day for days [from, to). */
function daily(from: number, to: number, price: number, availability?: Availability) {
  return Array.from({ length: to - from }, (_, i) => obs(from + i, price, availability));
}

describe("computePriceStats", () => {
  it("returns empty stats when there is no history", () => {
    expect(computePriceStats([], at(0))).toEqual({
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
    });
  });

  it("handles a single observation without inventing averages or a previous price", () => {
    const stats = computePriceStats([obs(0, 1000)], at(0, 1));
    expect(stats).toMatchObject({
      currency: "GBP",
      observationCount: 1,
      current: 1000,
      currentSince: at(0),
      isAvailable: true,
      previous: null,
      lowest: 1000,
      highest: 1000,
      avg7: null,
      avg30: null,
      avg90: null,
      changeBps: null,
      vsPrevious: null,
    });
  });

  it("reports a steady price with equal averages and no previous price", () => {
    const stats = computePriceStats(daily(0, 100, 1000), at(100));
    expect(stats).toMatchObject({
      current: 1000,
      currentSince: at(0),
      previous: null,
      lowest: 1000,
      highest: 1000,
      avg7: 1000,
      avg30: 1000,
      avg90: 1000,
    });
  });

  describe("a price drop after 100 days at £100", () => {
    // Days 0–99 at 10000, day 100 at 8000, measured 12 hours later.
    const history = [...daily(0, 100, 10000), obs(100, 8000)];
    const now = at(100, 12);
    const stats = computePriceStats(history, now);

    it("identifies current and previous prices", () => {
      expect(stats).toMatchObject({
        observationCount: 101,
        firstObservedAt: at(0),
        lastObservedAt: at(100),
        current: 8000,
        currentSince: at(100),
        previous: 10000,
        previousUntil: at(100),
        lowest: 8000,
        highest: 10000,
      });
    });

    it("computes time-weighted averages", () => {
      // avg7:  (6.5 × 10000 + 0.5 × 8000) / 7  = 9857.14 → 9857
      // avg30: (29.5 × 10000 + 0.5 × 8000) / 30 = 9966.67 → 9967
      // avg90: (89.5 × 10000 + 0.5 × 8000) / 90 = 9988.89 → 9989
      expect([stats.avg7, stats.avg30, stats.avg90]).toEqual([9857, 9967, 9989]);
    });

    it("computes change, saving and discount", () => {
      expect(stats.changeBps).toBe(-2000);
      expect(stats.vsPrevious).toEqual({ saving: 2000, discountBps: 2000 });
    });

    it("gives the same result for unsorted input and ignores future observations", () => {
      const shuffled = [obs(101, 1), ...history.toReversed()];
      expect(computePriceStats(shuffled, now)).toEqual(stats);
    });

    it("does not mutate its input", () => {
      const frozen = Object.freeze([...history]);
      computePriceStats(frozen, now);
      expect(frozen).toEqual(history);
    });
  });

  it("ignores a short price spike when choosing the previous price", () => {
    // 30 days at 10000, 6 hours at 15000, then 9000.
    const history = [...daily(0, 30, 10000), obs(30, 15000), obs(30, 9000, "IN_STOCK", 6)];
    const stats = computePriceStats(history, at(30, 12));
    expect(stats.previous).toBe(10000);
    expect(stats.changeBps).toBe(-1000);
    expect(stats.highest).toBe(15000);
    // avg7: (6.5 × 10000 + 0.25 × 15000 + 0.25 × 9000) / 7 = 10142.86 → 10143
    expect(stats.avg7).toBe(10143);
  });

  it("uses a higher price as previous once it was held for a day", () => {
    const history = [...daily(0, 30, 10000), obs(30, 15000), obs(31, 15000), obs(32, 9000)];
    const stats = computePriceStats(history, at(32, 1));
    expect(stats.previous).toBe(15000);
    expect(stats.previousUntil).toEqual(at(32));
    expect(stats.changeBps).toBe(-4000);
  });

  it("looks past a return to an earlier price, exposing when the previous price ended", () => {
    // 12000 for 10 days, 9000 for 20 days, a 2-hour blip at 10000, back to 9000.
    const history = [
      ...daily(0, 10, 12000),
      ...daily(10, 30, 9000),
      obs(30, 10000),
      obs(30, 9000, "IN_STOCK", 2),
    ];
    const stats = computePriceStats(history, at(30, 3));
    expect(stats.previous).toBe(12000);
    expect(stats.previousUntil).toEqual(at(10));
    // (166h × 9000 + 2h × 10000) / 168h = 9011.9 → 9012
    expect(stats.avg7).toBe(9012);
  });

  it("reports a price rise as a negative saving", () => {
    const stats = computePriceStats([...daily(0, 30, 8000), obs(30, 10000)], at(30, 1));
    expect(stats.changeBps).toBe(2500);
    expect(stats.vsPrevious).toEqual({ saving: -2000, discountBps: -2500 });
  });

  it("excludes out-of-stock prices from lows, highs, averages and the previous price", () => {
    const history = [...daily(0, 10, 10000), ...daily(10, 20, 5000, "OUT_OF_STOCK"), obs(20, 9000)];
    const stats = computePriceStats(history, at(20, 1));
    expect(stats).toMatchObject({
      current: 9000,
      isAvailable: true,
      previous: 10000,
      lowest: 9000,
      highest: 10000,
      avg7: null, // only 1 hour of purchasable price in the last 7 days
      avg30: null, // 10 days + 1 hour of 30 → below 50% coverage
    });
  });

  it("reports the latest price of an out-of-stock item as unavailable", () => {
    const history = [...daily(0, 10, 10000), obs(10, 10000, "OUT_OF_STOCK")];
    const stats = computePriceStats(history, at(10, 1));
    expect(stats).toMatchObject({
      current: 10000,
      currentSince: at(10),
      isAvailable: false,
      previous: null, // the in-stock price was the same
      lowest: 10000,
    });
  });

  it("caps how long an observation holds when updates stop", () => {
    const stats = computePriceStats([obs(0, 10000), obs(10, 8000)], at(10, 1));
    expect(stats.previous).toBe(10000);
    expect(stats.previousUntil).toEqual(at(3)); // 72-hour cap
    expect(stats.avg7).toBeNull();
    expect(stats.avg30).toBeNull();
  });

  it.each([
    [3, 1000], // days 3–6 → 4 of 7 days covered (57%)
    [4, null], // days 4–6 → 3 of 7 days covered (43%)
  ])("requires 50%% window coverage for an average (history from day %i)", (from, expected) => {
    expect(computePriceStats(daily(from, 7, 1000), at(7)).avg7).toBe(expected);
  });

  it("rounds averages half-up to whole pence", () => {
    const config = { ...DEFAULT_PRICING_CONFIG, maxObservationGapMs: 10 * DAY };
    const stats = computePriceStats([obs(0, 1000), obs(3, 1001, "IN_STOCK", 12)], at(7), config);
    expect(stats.avg7).toBe(1001); // 3.5 days each → 1000.5
  });

  it("treats the later of two same-time observations as current", () => {
    const stats = computePriceStats([obs(0, 1000), obs(0, 1100)], at(0, 1));
    expect(stats.current).toBe(1100);
  });

  it("does not compute a percentage change from a previous price of zero", () => {
    const stats = computePriceStats([...daily(0, 5, 0), obs(5, 500)], at(5, 1));
    expect(stats.previous).toBe(0);
    expect(stats.changeBps).toBeNull();
    expect(stats.vsPrevious).toBeNull();
  });

  it("handles long histories", () => {
    const hourly = Array.from({ length: 30_000 }, (_, i) => obs(0, 1000 + (i % 7), "IN_STOCK", i));
    const stats = computePriceStats(hourly, at(0, 30_000));
    expect(stats.observationCount).toBe(30_000);
    expect(stats.lowest).toBe(1000);
    expect(stats.highest).toBe(1006);
  });

  it("respects a custom purchasable set", () => {
    const config = { ...DEFAULT_PRICING_CONFIG, purchasable: new Set<Availability>(["IN_STOCK"]) };
    const stats = computePriceStats([obs(0, 1000, "UNKNOWN")], at(0, 1), config);
    expect(stats.isAvailable).toBe(false);
    expect(stats.lowest).toBeNull();
  });

  describe("validation", () => {
    it.each([
      ["a negative price", { ...obs(0, 1000), price: -1 }],
      ["a fractional price", { ...obs(0, 1000), price: 10.5 }],
      ["an invalid date", { ...obs(0, 1000), observedAt: new Date("nope") }],
    ])("rejects %s", (_label, bad) => {
      expect(() => computePriceStats([bad], at(1))).toThrow(RangeError);
    });

    it("rejects mixed currencies", () => {
      expect(() =>
        computePriceStats([obs(0, 1000), { ...obs(1, 1000), currency: "EUR" }], at(2)),
      ).toThrow("mix currencies");
    });
  });
});

describe("compareToReference", () => {
  it.each([
    [7500, 10000, { saving: 2500, discountBps: 2500 }],
    [9999, 14999, { saving: 5000, discountBps: 3334 }], // 33.335…% → 3334
    [10000, 10000, { saving: 0, discountBps: 0 }],
    [12000, 10000, { saving: -2000, discountBps: -2000 }],
    [0, 500, { saving: 500, discountBps: 10000 }],
  ])("%s against %s", (price, reference, expected) => {
    expect(compareToReference(price, reference)).toEqual(expected);
  });

  it("rejects a zero reference and invalid amounts", () => {
    expect(() => compareToReference(100, 0)).toThrow(RangeError);
    expect(() => compareToReference(-1, 100)).toThrow(RangeError);
    expect(() => compareToReference(100, 1.5)).toThrow(RangeError);
  });
});
