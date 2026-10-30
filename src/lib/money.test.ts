import { describe, expect, it } from "vitest";
import { assertPence, formatBps, formatPrice, isPence, parsePounds, ratioToBps } from "./money";

describe("isPence / assertPence", () => {
  it.each([0, 1, 999_999_999])("accepts %s", (v) => expect(isPence(v)).toBe(true));
  it.each([-1, 1.5, Number.NaN, Infinity, "100", null, 2 ** 53])("rejects %s", (v) => {
    expect(isPence(v)).toBe(false);
    expect(() => assertPence(v, "price")).toThrow("price must be a non-negative integer of pence");
  });
});

describe("ratioToBps", () => {
  it.each([
    [1, 4, 2500],
    [1, 8, 1250],
    [1, 3, 3333],
    [2, 3, 6667],
    [0, 7, 0],
    [7, 7, 10_000],
    [3, 2, 15_000],
    // exactly half a basis point rounds away from zero
    [1, 20_000, 1],
    [-1, 20_000, -1],
    [-1, 3, -3333],
    [-2, 3, -6667],
    [-2000, 10_000, -2000],
    // large values stay exact
    [123_456_789, 987_654_321, 1250],
  ])("%s / %s → %s bps", (n, d, expected) => {
    expect(ratioToBps(n, d)).toBe(expected);
  });

  it("rejects a zero or negative denominator", () => {
    expect(() => ratioToBps(1, 0)).toThrow(RangeError);
    expect(() => ratioToBps(1, -5)).toThrow(RangeError);
  });

  it("rejects non-integers", () => {
    expect(() => ratioToBps(1.5, 3)).toThrow(RangeError);
  });
});

describe("parsePounds", () => {
  it.each([
    ["0", 0],
    ["12", 1200],
    ["12.3", 1230],
    ["12.34", 1234],
    [" 1234.56 ", 123456],
    ["0.07", 7],
  ])("%j → %s", (text, pence) => expect(parsePounds(text)).toBe(pence));

  it.each(["", "abc", "-1", "1.234", "1,000", "£5", "1e3", ".5"])("rejects %j", (text) => {
    expect(() => parsePounds(text)).toThrow(RangeError);
  });
});

describe("formatPrice", () => {
  it.each([
    [0, "£0.00"],
    [5, "£0.05"],
    [123456, "£1,234.56"],
    [9999, "£99.99"],
  ])("%s → %s", (pence, text) => expect(formatPrice(pence)).toBe(text));

  it("rejects invalid amounts", () => expect(() => formatPrice(-1)).toThrow(RangeError));
});

describe("formatBps", () => {
  it.each([
    [2500, "25%"],
    [1250, "12.5%"],
    [3333, "33.3%"],
    [-2000, "-20%"],
    [0, "0%"],
  ])("%s → %s", (bps, text) => expect(formatBps(bps)).toBe(text));

  it("supports more precision", () => expect(formatBps(3333, 2)).toBe("33.33%"));

  it("rejects non-integers", () => expect(() => formatBps(12.5)).toThrow(RangeError));
});
