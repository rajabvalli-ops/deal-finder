// Creates one clearly-labelled test product with a price drop and runs real deal detection,
// so E2E tests always have a PENDING_REVIEW deal. Prints its IDs and slugs as JSON.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db/client";
import { createPriceHistoryRepository } from "@/server/db/repositories/price-history.repository";
import { createProductRepository } from "@/server/db/repositories/product.repository";
import { createDealDetectionService } from "@/server/services/deals/deal-detection.service";

const DAY = 86_400_000;

async function main() {
  const id = randomUUID().slice(0, 8);
  const now = new Date();
  const retailer = await db.retailer.create({
    data: {
      slug: `e2e-retailer-${id}`,
      name: `E2E Retailer ${id}`,
      websiteUrl: "https://e2e.invalid",
      adapterKey: "e2e-fixture",
      integrationType: "MANUAL",
    },
  });
  const category = await db.category.create({
    data: { slug: `e2e-cat-${id}`, name: `E2E Category ${id}` },
  });
  const title = `E2E Test Kettle ${id}`;
  const product = await createProductRepository(db).upsertListing({
    retailerId: retailer.id,
    externalId: `E2E-${id}`,
    title,
    productUrl: `https://e2e.invalid/p/${id}`,
    categoryId: category.id,
    currency: "GBP",
    availability: "IN_STOCK",
    seenAt: now,
    variants: [
      {
        externalId: `E2E-${id}`,
        name: "Default",
        isDefault: true,
        currentPrice: 3999,
        availability: "IN_STOCK",
      },
    ],
  });
  const variantId = product.variants[0]!.id;
  const history = createPriceHistoryRepository(db);
  for (let d = 30; d >= 1; d--) {
    await history.record({
      variantId,
      price: 5999,
      currency: "GBP",
      availability: "IN_STOCK",
      observedAt: new Date(now.getTime() - d * DAY),
    });
  }
  const dropAt = new Date(now.getTime() - 3_600_000);
  await history.record({
    variantId,
    price: 3999,
    currency: "GBP",
    availability: "IN_STOCK",
    observedAt: dropAt,
  });
  await db.product.update({ where: { id: product.id }, data: { priceUpdatedAt: dropAt } });
  await createDealDetectionService(db).detectChanged({ now, since: dropAt });
  const deal = await db.deal.findFirstOrThrow({ where: { productId: product.id } });
  console.log(
    JSON.stringify({
      dealId: deal.id,
      productId: product.id,
      title,
      slug: deal.slug,
      retailerSlug: retailer.slug,
      categorySlug: category.slug,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
