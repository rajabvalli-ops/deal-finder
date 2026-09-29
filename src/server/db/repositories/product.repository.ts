import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";
import { inTransaction } from "../transaction";
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

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof withRelations }>;

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
