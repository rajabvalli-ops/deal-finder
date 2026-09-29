import type { ListingInput } from "@/server/db/repositories/product.repository";
import { testDb } from "./setup";

let sequence = 0;

export async function createRetailer(overrides: { slug?: string } = {}) {
  sequence += 1;
  return testDb.retailer.create({
    data: {
      slug: overrides.slug ?? `test-retailer-${sequence}`,
      name: `Test Retailer ${sequence}`,
      websiteUrl: "https://retailer.invalid",
      adapterKey: "mock",
      integrationType: "MOCK",
    },
  });
}

export function listingInput(
  retailerId: string,
  overrides: Partial<ListingInput> = {},
): ListingInput {
  return {
    retailerId,
    externalId: "SKU-1",
    title: "Example Wireless Headphones",
    brand: "ExampleBrand",
    model: "EX-100",
    productUrl: "https://retailer.invalid/p/sku-1",
    currency: "GBP",
    availability: "IN_STOCK",
    seenAt: new Date("2026-01-01T10:00:00Z"),
    variants: [
      {
        externalId: "SKU-1",
        name: "Default",
        isDefault: true,
        currentPrice: 9999,
        availability: "IN_STOCK",
      },
    ],
    ...overrides,
  };
}
