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

/** A product with 30 days at £100 then £80 now, run through deal detection → one PENDING_REVIEW deal. */
export async function createPendingDeal(
  now = new Date(),
  overrides: { title?: string; externalId?: string } = {},
) {
  const { createProductRepository } = await import("@/server/db/repositories/product.repository");
  const { createPriceHistoryRepository } =
    await import("@/server/db/repositories/price-history.repository");
  const { createDealDetectionService } =
    await import("@/server/services/deals/deal-detection.service");
  const DAY = 86_400_000;
  const retailer = await createRetailer();
  const externalId = overrides.externalId ?? "SKU-1";
  const product = await createProductRepository(testDb).upsertListing(
    listingInput(retailer.id, {
      externalId,
      title: overrides.title ?? "Example Wireless Headphones",
      variants: [
        {
          externalId,
          name: "Default",
          isDefault: true,
          currentPrice: 8000,
          availability: "IN_STOCK",
        },
      ],
    }),
  );
  const variant = product.variants[0]!;
  const history = createPriceHistoryRepository(testDb);
  for (let d = 30; d >= 1; d--) {
    await history.record({
      variantId: variant.id,
      price: 10000,
      currency: "GBP",
      availability: "IN_STOCK",
      observedAt: new Date(now.getTime() - d * DAY),
    });
  }
  const at = new Date(now.getTime() - 3_600_000);
  await history.record({
    variantId: variant.id,
    price: 8000,
    currency: "GBP",
    availability: "IN_STOCK",
    observedAt: at,
  });
  await testDb.product.update({ where: { id: product.id }, data: { priceUpdatedAt: at } });
  await createDealDetectionService(testDb).detectChanged({
    now,
    since: new Date(now.getTime() - DAY),
  });
  const deal = await testDb.deal.findFirstOrThrow({ where: { productId: product.id } });
  return { retailer, product, variant, deal };
}

export function createUser(email: string, role: "USER" | "EDITOR" | "ADMIN" = "USER") {
  return testDb.user.create({ data: { email, role } });
}
