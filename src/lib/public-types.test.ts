import { describe, expect, it } from "vitest";
import { isAtHistoricalLow, isNearHistoricalLow, parseDealSort } from "./public-types";

describe("parseDealSort", () => {
  it.each([
    ["discount", "discount"],
    ["top", "top"],
    [undefined, "newest"],
    ["DROP TABLE", "newest"],
  ])("%s → %s", (input, expected) => {
    expect(parseDealSort(input)).toBe(expected);
  });
});

describe("historical low helpers", () => {
  it.each([
    [1000, 1000, true, true],
    [900, 1000, true, true],
    [1030, 1000, false, true],
    [1031, 1000, false, false],
    [1000, null, false, false],
  ] as const)("price %s vs low %s → at %s, near %s", (dealPrice, historicalLow, at, near) => {
    expect(isAtHistoricalLow({ dealPrice, historicalLow })).toBe(at);
    expect(isNearHistoricalLow({ dealPrice, historicalLow })).toBe(near);
  });
});
