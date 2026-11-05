import { describe, expect, it } from "vitest";
import {
  bestPriceWithCode,
  formatVoucherDiscount,
  priceWithVoucher,
  timeAgo,
} from "./voucher-price";

const none = { discountPence: null, discountBps: null, minSpendPence: null };

describe("priceWithVoucher", () => {
  it("takes off a fixed amount, never below zero", () => {
    expect(priceWithVoucher(2999, { ...none, discountPence: 500 })).toBe(2499);
    expect(priceWithVoucher(300, { ...none, discountPence: 500 })).toBe(0);
  });

  it("takes off a percentage, rounded to the penny", () => {
    expect(priceWithVoucher(2999, { ...none, discountBps: 1000 })).toBe(2699);
    expect(priceWithVoucher(1005, { ...none, discountBps: 2500 })).toBe(754);
    expect(priceWithVoucher(1000, { ...none, discountBps: 10_000 })).toBe(0);
  });

  it("doesn't apply below the minimum spend or without a discount", () => {
    expect(priceWithVoucher(1999, { ...none, discountPence: 500, minSpendPence: 2000 })).toBeNull();
    expect(priceWithVoucher(2000, { ...none, discountPence: 500, minSpendPence: 2000 })).toBe(1500);
    expect(priceWithVoucher(2000, none)).toBeNull();
  });
});

describe("bestPriceWithCode", () => {
  it("picks the voucher giving the lowest price, ignoring ones without a code", () => {
    expect(
      bestPriceWithCode(4000, [
        { ...none, code: "FIVER", discountPence: 500 },
        { ...none, code: "TENPC", discountBps: 1000 },
        { ...none, code: null, discountPence: 3000 },
        { ...none, code: "BIGSPEND", discountPence: 2000, minSpendPence: 5000 },
      ]),
    ).toEqual({ price: 3500, code: "FIVER" });
  });

  it("is null when nothing lowers the price", () => {
    expect(bestPriceWithCode(4000, [])).toBeNull();
    expect(bestPriceWithCode(4000, [{ ...none, code: "INFO" }])).toBeNull();
    expect(bestPriceWithCode(0, [{ ...none, code: "FREE", discountPence: 100 }])).toBeNull();
  });
});

describe("formatVoucherDiscount", () => {
  it("describes the discount", () => {
    expect(formatVoucherDiscount({ ...none, discountPence: 500 })).toBe("£5.00 off");
    expect(formatVoucherDiscount({ ...none, discountBps: 1250 })).toBe("12.5% off");
    expect(formatVoucherDiscount({ ...none, discountPence: 500, minSpendPence: 3000 })).toBe(
      "£5.00 off £30.00+",
    );
    expect(formatVoucherDiscount(none)).toBeNull();
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const before = (ms: number) => new Date(now.getTime() - ms);
  it("rounds down to the largest unit", () => {
    expect(timeAgo(before(30_000), now)).toBe("just now");
    expect(timeAgo(before(-5_000), now)).toBe("just now");
    expect(timeAgo(before(60_000), now)).toBe("1 minute ago");
    expect(timeAgo(before(59 * 60_000), now)).toBe("59 minutes ago");
    expect(timeAgo(before(3 * 3_600_000 + 1), now)).toBe("3 hours ago");
    expect(timeAgo(before(86_400_000), now)).toBe("1 day ago");
    expect(timeAgo(before(9 * 86_400_000), now)).toBe("9 days ago");
  });
});
