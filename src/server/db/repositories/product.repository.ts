import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";
import { inTransaction } from "../transaction";
import type { DealStatus } from "@/generated/prisma/enums";
import type { Availability, DbClient } from "../types";

export type VariantInput = {
  externalId: string;
  name: string;
  attributes?: Prisma.InputJsonValue;
  isDefault: boolean;
  /** Pence. */
  currentPrice: number | null;
  availability: Availability;
};

/** A retailer listing as persisted. Validation/normalisation happens before this (ingestion). */
export type ListingInput = {
  retailerId: string;
  externalId: string;
  title: string;
  brand?: string | null;
  model?: string | null;
  gtin?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  productUrl: string;
  categoryId?: string | null;
  currency: string;
  availability: Availability;
  rating?: number | null;
  reviewCount?: number | null;
  seenAt: Date;
  variants: VariantInput[];
};

const withRelations = {
  retailer: true,
  category: true,
  variants: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] },
} satisfies Prisma.ProductInclude;

/** Cached pricing figures stored on Product (see PriceStats). */
export type PriceSnapshot = {
  currentPrice: number | null;
  previousPrice: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  avg7Price: number | null;
  avg30Price: number | null;
  avg90Price: number | null;
  priceUpdatedAt: Date;
};

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof withRelations }>;

const detectionInclude = {
  retailer: true,
  category: true,
  variants: { where: { isDefault: true } },
} satisfies Prisma.ProductInclude;

export type ProductForDetection = Prisma.ProductGetPayload<{ include: typeof detectionInclude }>;

/** Stable, unique slug: readable title plus a short hash of the retailer listing identity. */
export function productSlug(title: string, retailerId: string, externalId: string): string {
  const suffix = createHash("sha256")
    .update(`${retailerId}:${externalId}`)
    .digest("hex")
    .slice(0, 8);
  return `${slugify(title, 70) || "product"}-${suffix}`;
}

function assertValidVariants(variants: VariantInput[]): void {
  if (variants.filter((v) => v.isDefault).length !== 1) {
    throw new Error("A listing must have exactly one default variant");
  }
  if (new Set(variants.map((v) => v.externalId)).size !== variants.length) {
    throw new Error("Variant external IDs must be unique within a listing");
  }
}

export function createProductRepository(client: DbClient) {
  return {
    findBySlug(slug: string): Promise<ProductWithRelations | null> {
      return client.product.findUnique({ where: { slug }, include: withRelations });
    },

    findByExternalId(retailerId: string, externalId: string): Promise<ProductWithRelations | null> {
      return client.product.findUnique({
        where: { retailerId_externalId: { retailerId, externalId } },
        include: withRelations,
      });
    },

    findManyByExternalIds(retailerId: string, externalIds: readonly string[]) {
      return client.product.findMany({
        where: { retailerId, externalId: { in: [...externalIds] } },
        include: { variants: true },
      });
    },

    updatePriceSnapshot(productId: string, snapshot: PriceSnapshot) {
      return client.product.update({ where: { id: productId }, data: snapshot });
    },

    updateVariantPrice(
      variantId: string,
      data: { currentPrice: number | null; availability: Availability },
    ) {
      return client.productVariant.update({ where: { id: variantId }, data });
    },

    updateAvailability(productId: string, availability: Availability, seenAt: Date) {
      return client.product.update({
        where: { id: productId },
        data: { availability, lastSeenAt: seenAt },
      });
    },

    /** Marks a retailer's listings inactive when an import has not seen them since `before`. */
    async deactivateNotSeenSince(retailerId: string, before: Date): Promise<number> {
      const { count } = await client.product.updateMany({
        where: { retailerId, isActive: true, lastSeenAt: { lt: before } },
        data: { isActive: false },
      });
      return count;
    },

    /**
     * Active listings to re-price, most important first: those with an active deal, then
     * the ones priced longest ago.
     */
    async listForPriceRefresh(
      retailerId: string,
      activeDealStatuses: readonly DealStatus[],
      limit: number,
    ): Promise<{ id: string; externalId: string }[]> {
      const select = { id: true, externalId: true } as const;
      const withDeals = await client.product.findMany({
        where: {
          retailerId,
          isActive: true,
          deals: { some: { status: { in: [...activeDealStatuses] } } },
        },
        select,
        take: limit,
      });
      const rest = await client.product.findMany({
        where: { retailerId, isActive: true, id: { notIn: withDeals.map((p) => p.id) } },
        select,
        orderBy: [{ priceUpdatedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
        take: Math.max(0, limit - withDeals.length),
      });
      return [...withDeals, ...rest];
    },

    /** Active listings of active retailers whose prices were updated at or after `since`. */
    listPricedSince(since: Date) {
      return client.product.findMany({
        where: { isActive: true, priceUpdatedAt: { gte: since }, retailer: { status: "ACTIVE" } },
        include: detectionInclude,
        orderBy: { id: "asc" },
      });
    },

    findForDetection(productId: string) {
      return client.product.findUnique({ where: { id: productId }, include: detectionInclude });
    },

    /**
     * Idempotently creates or updates a listing and its variants, keyed by
     * (retailerId, externalId). The slug is fixed at creation so URLs stay stable.
     * Variants missing from the input are left untouched (their price history is kept).
     */
    async upsertListing(input: ListingInput): Promise<ProductWithRelations> {
      assertValidVariants(input.variants);
      const { variants, seenAt, ...fields } = input;
      const data = { ...fields, lastSeenAt: seenAt, isActive: true };

      return inTransaction(client, async (tx) => {
        const product = await tx.product.upsert({
          where: {
            retailerId_externalId: { retailerId: input.retailerId, externalId: input.externalId },
          },
          create: { ...data, slug: productSlug(input.title, input.retailerId, input.externalId) },
          update: data,
        });

        // Clear the old default first: a partial unique index allows only one per product.
        const defaultExternalId = variants.find((v) => v.isDefault)!.externalId;
        await tx.productVariant.updateMany({
          where: { productId: product.id, isDefault: true, externalId: { not: defaultExternalId } },
          data: { isDefault: false },
        });

        for (const variant of variants) {
          await tx.productVariant.upsert({
            where: {
              productId_externalId: { productId: product.id, externalId: variant.externalId },
            },
            create: { ...variant, productId: product.id },
            update: variant,
          });
        }

        return tx.product.findUniqueOrThrow({ where: { id: product.id }, include: withRelations });
      });
    },
  };
}

export type ProductRepository = ReturnType<typeof createProductRepository>;
