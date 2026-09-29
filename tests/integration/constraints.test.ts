import { describe, expect, it } from "vitest";
import { createProductRepository } from "@/server/db/repositories/product.repository";
import { createRetailer, listingInput } from "./factories";
import { testDb } from "./setup";

// Integrity rules added as raw SQL in the initial migration.

async function productWithVariant() {
  const retailer = await createRetailer();
  const product = await createProductRepository(testDb).upsertListing(listingInput(retailer.id));
  return { retailer, product, variant: product.variants[0]! };
}

function dealData(ids: { productId: string; variantId: string; retailerId: string }, slug: string) {
  return {
    ...ids,
    slug,
    title: "Deal",
    status: "PENDING_REVIEW" as const,
    dealPrice: 7500,
    referencePrice: 10000,
    referenceType: "AVG_30" as const,
    savingAmount: 2500,
    discountBps: 2500,
    score: 70,
    scoreBreakdown: {},
    engineVersion: "test",
  };
}

describe("database constraints", () => {
  it("rejects negative prices in price history", async () => {
    const { variant, product } = await productWithVariant();
    await expect(
      testDb.priceHistory.create({
        data: {
          productId: product.id,
          variantId: variant.id,
          price: -1,
          currency: "GBP",
          availability: "IN_STOCK",
          observedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/PriceHistory_price_nonnegative/);
  });

  it("rejects malformed currency codes", async () => {
    const retailer = await createRetailer();
    await expect(
      createProductRepository(testDb).upsertListing(listingInput(retailer.id, { currency: "gbp" })),
    ).rejects.toThrow(/Product_currency_format/);
  });

  it("rejects a rating above 5", async () => {
    const retailer = await createRetailer();
    await expect(
      createProductRepository(testDb).upsertListing(listingInput(retailer.id, { rating: 5.5 })),
    ).rejects.toThrow(/Product_rating_range/);
  });

  it("allows only one default variant per product", async () => {
    const { product } = await productWithVariant();
    await expect(
      testDb.productVariant.create({
        data: {
          productId: product.id,
          externalId: "OTHER",
          name: "Other",
          isDefault: true,
          availability: "IN_STOCK",
        },
      }),
    ).rejects.toThrow();
  });

  it("requires saving = reference − deal price", async () => {
    const { retailer, product, variant } = await productWithVariant();
    const ids = { productId: product.id, variantId: variant.id, retailerId: retailer.id };
    await expect(
      testDb.deal.create({ data: { ...dealData(ids, "d1"), savingAmount: 1 } }),
    ).rejects.toThrow(/Deal_prices_valid/);
  });

  it("allows only one active deal per variant, but any number of finished ones", async () => {
    const { retailer, product, variant } = await productWithVariant();
    const ids = { productId: product.id, variantId: variant.id, retailerId: retailer.id };

    await testDb.deal.create({ data: dealData(ids, "active-1") });
    await expect(testDb.deal.create({ data: dealData(ids, "active-2") })).rejects.toThrow();

    await testDb.deal.create({ data: { ...dealData(ids, "old-1"), status: "EXPIRED" } });
    await testDb.deal.create({ data: { ...dealData(ids, "old-2"), status: "REJECTED" } });
    expect(await testDb.deal.count()).toBe(3);
  });

  it("requires an alert to have at least one criterion", async () => {
    const user = await testDb.user.create({ data: { email: "alerts@example.test" } });
    await expect(
      testDb.alert.create({ data: { userId: user.id, maxPrice: 10000 } }),
    ).rejects.toThrow(/Alert_has_criterion/);
    await expect(
      testDb.alert.create({ data: { userId: user.id, keyword: "headphones", maxPrice: 10000 } }),
    ).resolves.toBeDefined();
  });

  it("stops a category being its own parent", async () => {
    const category = await testDb.category.create({ data: { slug: "c", name: "C" } });
    await expect(
      testDb.category.update({ where: { id: category.id }, data: { parentId: category.id } }),
    ).rejects.toThrow(/Category_not_own_parent/);
  });

  it("refuses to delete a retailer that still has products", async () => {
    const { retailer } = await productWithVariant();
    await expect(testDb.retailer.delete({ where: { id: retailer.id } })).rejects.toThrow();
  });
});
