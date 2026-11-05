import type { PrismaClient } from "../../src/generated/prisma/client";
import { amazonRetailer, categories, mockRetailer, type CategorySeed } from "./reference-data";

export type SeedOptions = { includeDevelopmentData: boolean };

async function upsertCategories(
  prisma: PrismaClient,
  items: CategorySeed[],
  parentId: string | null,
): Promise<number> {
  let count = 0;
  for (const [sortOrder, item] of items.entries()) {
    const fields = { name: item.name, parentId, sortOrder };
    const category = await prisma.category.upsert({
      where: { slug: item.slug },
      create: { slug: item.slug, ...fields },
      update: fields,
    });
    count += 1 + (await upsertCategories(prisma, item.children ?? [], category.id));
  }
  return count;
}

/** Idempotent: safe to run repeatedly. */
export async function runSeed(prisma: PrismaClient, options: SeedOptions) {
  const categoryCount = await upsertCategories(prisma, categories, null);

  const { slug: amazonSlug, ...amazonFields } = amazonRetailer;
  await prisma.retailer.upsert({
    where: { slug: amazonSlug },
    create: {
      slug: amazonSlug,
      ...amazonFields,
      status: "PAUSED",
      trustScore: 80,
      adapterConfig: { marketplace: "www.amazon.co.uk", asins: [], searches: [] },
    },
    update: amazonFields,
  });
  let retailerCount = 1;
  if (options.includeDevelopmentData) {
    const { slug, ...fields } = mockRetailer;
    await prisma.retailer.upsert({ where: { slug }, create: { slug, ...fields }, update: fields });
    retailerCount += 1;
  }

  return { categoryCount, retailerCount };
}
