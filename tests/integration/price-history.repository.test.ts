import { describe, expect, it } from "vitest";
import { createPriceHistoryRepository } from "@/server/db/repositories/price-history.repository";
import { createProductRepository } from "@/server/db/repositories/product.repository";
import { createRetailer, listingInput } from "./factories";
import { testDb } from "./setup";

const history = createPriceHistoryRepository(testDb);
const products = createProductRepository(testDb);

async function defaultVariant() {
  const retailer = await createRetailer();
  const product = await products.upsertListing(listingInput(retailer.id));
  return { product, variant: product.variants[0]! };
}

const at = (iso: string) => new Date(iso);

describe("price history repository", () => {
  it("records observations with the product ID taken from the variant", async () => {
    const { product, variant } = await defaultVariant();
    const row = await history.record({
      variantId: variant.id,
      price: 9999,
      currency: "GBP",
      availability: "IN_STOCK",
      observedAt: at("2026-01-01T00:00:00Z"),
    });
    expect(row.productId).toBe(product.id);
  });

  it("lists observations chronologically within a half-open range", async () => {
    const { variant } = await defaultVariant();
    for (const [day, price] of [
      ["03", 300],
      ["01", 100],
      ["02", 200],
      ["04", 400],
    ] as const) {
      await history.record({
        variantId: variant.id,
        price,
        currency: "GBP",
        availability: "IN_STOCK",
        observedAt: at(`2026-01-${day}T00:00:00Z`),
      });
    }

    const all = await history.listForVariant(variant.id);
    expect(all.map((r) => r.price)).toEqual([100, 200, 300, 400]);

    const ranged = await history.listForVariant(variant.id, {
      since: at("2026-01-02T00:00:00Z"),
      until: at("2026-01-04T00:00:00Z"),
    });
    expect(ranged.map((r) => r.price)).toEqual([200, 300]);

    expect((await history.latestForVariant(variant.id))?.price).toBe(400);
  });

  it("returns null when a variant has no history", async () => {
    const { variant } = await defaultVariant();
    expect(await history.latestForVariant(variant.id)).toBeNull();
  });

  it("rejects an unknown variant", async () => {
    await expect(
      history.record({
        variantId: "missing",
        price: 100,
        currency: "GBP",
        availability: "IN_STOCK",
        observedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
