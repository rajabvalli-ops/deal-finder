import { describe, expect, it } from "vitest";
import { normalisedPriceUpdateSchema, normalisedProductSchema } from "./schemas";

const valid = {
  externalId: "SKU-1",
  title: "  Example Headphones  ",
  brand: "Example",
  productUrl: "https://shop.example/p/1",
  currency: "GBP",
  availability: "IN_STOCK",
  variants: [
    {
      externalId: "SKU-1",
      name: "Default",
      isDefault: true,
      price: 9999,
      availability: "IN_STOCK",
    },
  ],
};

describe("normalisedProductSchema", () => {
  it("accepts a valid product and trims text", () => {
    const parsed = normalisedProductSchema.parse(valid);
    expect(parsed.title).toBe("Example Headphones");
  });

  it("accepts nullable optional fields", () => {
    expect(
      normalisedProductSchema.safeParse({
        ...valid,
        brand: null,
        gtin: null,
        rating: null,
        imageUrl: null,
      }).success,
    ).toBe(true);
  });

  const variant = valid.variants[0]!;
  it.each([
    ["no default variant", { variants: [{ ...variant, isDefault: false }] }],
    ["two default variants", { variants: [variant, { ...variant, externalId: "SKU-2" }] }],
    ["duplicate variant IDs", { variants: [variant, { ...variant, isDefault: false }] }],
    ["no variants", { variants: [] }],
    ["an http product URL", { productUrl: "http://shop.example/p/1" }],
    ["a javascript: URL", { productUrl: "javascript:alert(1)" }],
    ["an http image URL", { imageUrl: "http://shop.example/i.jpg" }],
    ["a fractional price", { variants: [{ ...variant, price: 99.99 }] }],
    ["a negative price", { variants: [{ ...variant, price: -1 }] }],
    ["an implausibly large price", { variants: [{ ...variant, price: 100_000_001 }] }],
    ["a lower-case currency", { currency: "gbp" }],
    ["an unknown availability", { availability: "MAYBE" }],
    ["a rating above 5", { rating: 5.1 }],
    ["a negative review count", { reviewCount: -1 }],
    ["a malformed GTIN", { gtin: "12AB" }],
    ["an empty title", { title: "   " }],
    ["an empty external ID", { externalId: "" }],
  ])("rejects %s", (_label, override) => {
    expect(normalisedProductSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});

describe("normalisedPriceUpdateSchema", () => {
  it("accepts a price update and allows an unknown price", () => {
    expect(
      normalisedPriceUpdateSchema.safeParse({
        productExternalId: "SKU-1",
        currency: "GBP",
        variants: [{ externalId: "SKU-1", price: null, availability: "UNKNOWN" }],
      }).success,
    ).toBe(true);
  });

  it("rejects an update without variants", () => {
    expect(
      normalisedPriceUpdateSchema.safeParse({
        productExternalId: "SKU-1",
        currency: "GBP",
        variants: [],
      }).success,
    ).toBe(false);
  });
});
