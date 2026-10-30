import { z } from "zod";

// The validation boundary for everything a retailer adapter returns. Adapter output is
// untrusted: ingestion parses every item with these schemas before touching the database.

export const AVAILABILITIES = [
  "IN_STOCK",
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "PREORDER",
  "DISCONTINUED",
  "UNKNOWN",
] as const;

const availability = z.enum(AVAILABILITIES);
/** Pence, capped at £1m to catch unit mistakes (pounds sent as pence ×100). */
const pence = z.int().min(0).max(100_000_000);
const id = z.string().trim().min(1).max(200);
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullish();

export const normalisedVariantSchema = z.object({
  externalId: id,
  name: z.string().trim().min(1).max(200),
  attributes: z.record(z.string().max(50), z.string().max(200)).optional(),
  isDefault: z.boolean(),
  price: pence.nullable(),
  availability,
});

function exactlyOneDefault(
  variants: { externalId: string; isDefault: boolean }[],
  ctx: z.core.$RefinementCtx,
) {
  if (variants.filter((v) => v.isDefault).length !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["variants"],
      message: "exactly one default variant required",
    });
  }
  if (new Set(variants.map((v) => v.externalId)).size !== variants.length) {
    ctx.addIssue({
      code: "custom",
      path: ["variants"],
      message: "variant externalIds must be unique",
    });
  }
}

export const normalisedProductSchema = z
  .object({
    externalId: id,
    title: z.string().trim().min(1).max(300),
    brand: optionalText(100),
    model: optionalText(100),
    gtin: z
      .string()
      .regex(/^\d{8,14}$/)
      .nullish(),
    description: optionalText(10_000),
    imageUrl: httpsUrl.nullish(),
    productUrl: httpsUrl,
    /** Free-text category from the source; mapped to a Category during ingestion. */
    categoryHint: optionalText(200),
    currency: z.string().regex(/^[A-Z]{3}$/),
    availability,
    rating: z.number().min(0).max(5).nullish(),
    reviewCount: z.int().min(0).nullish(),
    variants: z.array(normalisedVariantSchema).min(1).max(100),
  })
  .superRefine((p, ctx) => exactlyOneDefault(p.variants, ctx));

export const normalisedPriceUpdateSchema = z.object({
  productExternalId: id,
  currency: z.string().regex(/^[A-Z]{3}$/),
  variants: z
    .array(normalisedVariantSchema.pick({ externalId: true, price: true, availability: true }))
    .min(1)
    .max(100),
});

export type NormalisedAvailability = z.infer<typeof availability>;
export type NormalisedVariant = z.infer<typeof normalisedVariantSchema>;
export type NormalisedProduct = z.infer<typeof normalisedProductSchema>;
export type NormalisedPriceUpdate = z.infer<typeof normalisedPriceUpdateSchema>;
