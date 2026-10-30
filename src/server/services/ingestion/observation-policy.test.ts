import { describe, expect, it } from "vitest";
import { shouldRecordObservation } from "./observation-policy";

const T = new Date(Date.UTC(2026, 0, 1, 12));
const later = (hours: number) => new Date(T.getTime() + hours * 3_600_000);
const latest = { price: 1000, currency: "GBP", availability: "IN_STOCK" as const, observedAt: T };
const same = { price: 1000, currency: "GBP", availability: "IN_STOCK" as const };

describe("shouldRecordObservation", () => {
  it("records the first observation", () => {
    expect(shouldRecordObservation(null, same, T)).toBe(true);
  });

  it.each([
    ["a price change", { ...same, price: 900 }, 1, true],
    ["a stock change", { ...same, availability: "OUT_OF_STOCK" as const }, 1, true],
    ["a currency change", { ...same, currency: "EUR" }, 1, true],
    ["nothing new within a day", same, 23, false],
    ["the daily heartbeat", same, 24, true],
  ])("%s", (_label, next, hours, expected) => {
    expect(shouldRecordObservation(latest, next, later(hours))).toBe(expected);
  });

  it("never writes an observation older than the latest", () => {
    expect(shouldRecordObservation(latest, { ...same, price: 1 }, later(-1))).toBe(false);
  });

  it("supports a custom heartbeat", () => {
    expect(shouldRecordObservation(latest, same, later(2), 3_600_000)).toBe(true);
  });
});
