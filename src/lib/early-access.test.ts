import { describe, expect, it } from "vitest";
import { earlyAccessUntil, isEarlyAccess } from "./early-access";

const published = new Date("2026-11-06T12:00:00Z");
const settings = { delayMinutes: 30, minLevel: "BIG_DROP" as const };
const deal = { level: "PRICE_ERROR" as const, publishedAt: published, levelRaisedAt: null };

describe("early access", () => {
  it("lasts the delay from when the deal became news", () => {
    expect(earlyAccessUntil(deal, settings)).toEqual(new Date("2026-11-06T12:30:00Z"));
    expect(isEarlyAccess(deal, settings, new Date("2026-11-06T12:29:59Z"))).toBe(true);
    expect(isEarlyAccess(deal, settings, new Date("2026-11-06T12:30:00Z"))).toBe(false);
  });

  it("restarts when the level goes up", () => {
    const raised = { ...deal, levelRaisedAt: new Date("2026-11-06T13:00:00Z") };
    expect(earlyAccessUntil(raised, settings)).toEqual(new Date("2026-11-06T13:30:00Z"));
  });

  it("doesn't apply to deals that won't be posted, unpublished deals, or without a delay", () => {
    expect(earlyAccessUntil({ ...deal, level: "NORMAL" }, settings)).toBeNull();
    expect(earlyAccessUntil({ ...deal, publishedAt: null }, settings)).toBeNull();
    expect(earlyAccessUntil(deal, { ...settings, delayMinutes: 0 })).toBeNull();
    expect(isEarlyAccess(deal, { ...settings, delayMinutes: 0 }, published)).toBe(false);
  });
});
