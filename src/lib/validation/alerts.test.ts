import { describe, expect, it } from "vitest";
import { alertActionSchema, alertFormSchema, notificationActionSchema } from "./alerts";

const parse = (input: Record<string, string>) => alertFormSchema.safeParse(input);

describe("alertFormSchema", () => {
  it("reads every field and converts prices and discounts", () => {
    expect(
      parse({
        keyword: "  air   fryer ",
        category: "kitchen",
        retailer: "mock-retailer",
        max: "£49.99",
        discount: "20",
      }).data,
    ).toEqual({
      keyword: "air fryer",
      categorySlug: "kitchen",
      retailerSlug: "mock-retailer",
      dealSlug: null,
      maxPrice: 4999,
      minDiscountBps: 2000,
    });
  });

  it("treats empty and missing fields as not set", () => {
    expect(parse({ deal: "some-deal-1", keyword: "", max: "", discount: "" }).data).toEqual({
      keyword: null,
      categorySlug: null,
      retailerSlug: null,
      dealSlug: "some-deal-1",
      maxPrice: null,
      minDiscountBps: null,
    });
  });

  it("needs a keyword, a category or a product", () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ retailer: "shop", max: "50" }).success).toBe(false);
    expect(parse({ category: "audio" }).success).toBe(true);
  });

  it.each<[string, Record<string, string>]>([
    ["a one-letter keyword", { keyword: "a" }],
    ["a long keyword", { keyword: "x".repeat(101) }],
    ["a bad slug", { keyword: "kettle", category: "../admin" }],
    ["a bad price", { keyword: "kettle", max: "cheap" }],
    ["a negative price", { keyword: "kettle", max: "-5" }],
    ["an unlisted discount", { keyword: "kettle", discount: "15" }],
  ])("rejects %s", (_, input) => {
    expect(parse(input).success).toBe(false);
  });
});

describe("action schemas", () => {
  it("accepts known alert actions only", () => {
    expect(alertActionSchema.safeParse({ alertId: "a1", action: "pause" }).success).toBe(true);
    expect(alertActionSchema.safeParse({ alertId: "a1", action: "share" }).success).toBe(false);
    expect(alertActionSchema.safeParse({ alertId: "", action: "delete" }).success).toBe(false);
  });

  it("needs an id to mark one notification read", () => {
    expect(notificationActionSchema.safeParse({ action: "read-all" }).success).toBe(true);
    expect(
      notificationActionSchema.safeParse({ action: "read", notificationId: "n1" }).success,
    ).toBe(true);
    expect(notificationActionSchema.safeParse({ action: "read" }).success).toBe(false);
  });
});
