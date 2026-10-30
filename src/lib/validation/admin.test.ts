import { describe, expect, it } from "vitest";
import {
  categorySchema,
  dealActionSchema,
  dealContentSchema,
  retailerUpdateSchema,
  userRoleSchema,
} from "./admin";

describe("dealContentSchema", () => {
  const base = {
    dealId: "d1",
    title: "  A good deal  ",
    summary: "",
    description: "",
    expiresAt: "",
  };

  it("trims text and turns empty fields into null", () => {
    expect(dealContentSchema.parse(base)).toEqual({
      dealId: "d1",
      title: "A good deal",
      summary: null,
      description: null,
      isFeatured: false,
      expiresAt: null,
    });
  });

  it("keeps non-empty optional text", () => {
    expect(dealContentSchema.parse({ ...base, summary: " Lowest yet " }).summary).toBe(
      "Lowest yet",
    );
  });

  it("reads the featured checkbox and the expiry date", () => {
    const parsed = dealContentSchema.parse({
      ...base,
      isFeatured: "on",
      expiresAt: "2026-07-01T09:30",
    });
    expect(parsed.isFeatured).toBe(true);
    expect(parsed.expiresAt).toEqual(new Date("2026-07-01T09:30:00Z"));
    expect(
      dealContentSchema.parse({ ...base, expiresAt: "2026-07-01T09:30:00+01:00" }).expiresAt,
    ).toEqual(new Date("2026-07-01T08:30:00Z"));
  });

  it.each([
    ["a too-short title", { title: "ab" }],
    ["a too-long summary", { summary: "x".repeat(301) }],
    ["a bad date", { expiresAt: "tomorrow" }],
    ["an odd checkbox value", { isFeatured: "yes" }],
  ])("rejects %s", (_label, override) => {
    expect(dealContentSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });
});

describe("dealActionSchema", () => {
  it("accepts editor actions only", () => {
    expect(dealActionSchema.safeParse({ dealId: "d", action: "approve" }).success).toBe(true);
    expect(dealActionSchema.safeParse({ dealId: "d", action: "submit" }).success).toBe(false);
  });

  it("normalises an empty reason", () => {
    expect(
      dealActionSchema.parse({ dealId: "d", action: "reject", reason: " " }).reason,
    ).toBeNull();
  });
});

describe("other admin forms", () => {
  it("coerces and bounds the trust score", () => {
    expect(
      retailerUpdateSchema.parse({ retailerId: "r", status: "PAUSED", trustScore: "70" })
        .trustScore,
    ).toBe(70);
    expect(
      retailerUpdateSchema.safeParse({ retailerId: "r", status: "PAUSED", trustScore: "101" })
        .success,
    ).toBe(false);
    expect(
      retailerUpdateSchema.safeParse({ retailerId: "r", status: "GONE", trustScore: "1" }).success,
    ).toBe(false);
  });

  it("keeps a chosen parent", () => {
    expect(
      categorySchema.parse({ name: "Lawnmowers", parentId: " cat_1 ", sortOrder: "0" }).parentId,
    ).toBe("cat_1");
  });

  it("treats an empty parent as top level", () => {
    expect(categorySchema.parse({ name: "Garden", parentId: "", sortOrder: "3" })).toEqual({
      name: "Garden",
      parentId: null,
      sortOrder: 3,
    });
  });

  it("only accepts known roles", () => {
    expect(userRoleSchema.safeParse({ userId: "u", role: "OWNER" }).success).toBe(false);
  });
});
