import { describe, expect, it } from "vitest";
import { reportFormSchema, voucherActionSchema, voucherFormSchema } from "./vouchers";

describe("voucherFormSchema", () => {
  it("normalises the code and reads every field", () => {
    expect(
      voucherFormSchema.parse({
        retailerId: "r1",
        code: " save 10 ",
        title: "  10% off everything ",
        description: "Sitewide",
        terms: "Min spend £20",
        validUntil: "2026-12-01T23:59",
        deal: "glass-kettle-abc123",
      }),
    ).toEqual({
      retailerId: "r1",
      code: "SAVE10",
      title: "10% off everything",
      description: "Sitewide",
      terms: "Min spend £20",
      validUntil: new Date("2026-12-01T23:59Z"),
      deal: "glass-kettle-abc123",
    });
  });

  it("allows offers without a code, end date or deal", () => {
    expect(voucherFormSchema.parse({ retailerId: "r1", title: "Free delivery" })).toEqual({
      retailerId: "r1",
      code: null,
      title: "Free delivery",
      description: null,
      terms: null,
      validUntil: null,
      deal: null,
    });
  });

  it.each([
    { title: "ab" },
    { code: "NO!" },
    { code: "X" },
    { code: "A".repeat(41) },
    { validUntil: "someday" },
    { deal: "../admin" },
    { description: "x".repeat(501) },
  ])("rejects %j", (change) => {
    expect(
      voucherFormSchema.safeParse({ retailerId: "r1", title: "Offer", ...change }).success,
    ).toBe(false);
  });

  it("reads voucher actions", () => {
    expect(voucherActionSchema.parse({ couponId: "c1", action: "deactivate" }).action).toBe(
      "deactivate",
    );
    expect(voucherActionSchema.safeParse({ couponId: "c1", action: "publish" }).success).toBe(
      false,
    );
  });
});

describe("reportFormSchema", () => {
  it("accepts reasons that fit the target", () => {
    expect(reportFormSchema.parse({ target: "deal", id: "d1", reason: "WRONG_PRICE" })).toEqual({
      target: "deal",
      id: "d1",
      reason: "WRONG_PRICE",
      note: null,
    });
    expect(
      reportFormSchema.parse({
        target: "coupon",
        id: "c1",
        reason: "CODE_NOT_WORKING",
        note: " x ",
      }).note,
    ).toBe("x");
  });

  it.each([
    { target: "deal", id: "d1", reason: "CODE_NOT_WORKING" },
    { target: "coupon", id: "c1", reason: "OUT_OF_STOCK" },
    { target: "product", id: "p1", reason: "EXPIRED" },
    { target: "deal", id: "d1", reason: "EXPIRED", note: "x".repeat(301) },
  ])("rejects %j", (input) => {
    expect(reportFormSchema.safeParse(input).success).toBe(false);
  });
});
