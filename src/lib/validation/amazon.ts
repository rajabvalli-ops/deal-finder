import { z } from "zod";

// Admin input for what to track on Amazon: product IDs (ASINs, or pasted product links) and
// keyword searches. The adapter re-validates the stored config with its own schema.

export const MAX_TRACKED_ASINS = 5000;
export const MAX_AMAZON_SEARCHES = 50;

const ASIN = /^[A-Z0-9]{10}$/;
/** /dp/ASIN, /gp/product/ASIN and the mobile /gp/aw/d/ASIN forms of an Amazon product link. */
const ASIN_IN_PATH = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Za-z0-9]{10})(?:[/?#]|$)/;
const AMAZON_HOST = /(^|\.)amazon\.co\.uk$/;

/** Amazon UK departments (search indexes) offered in the admin; "" means all departments. */
export const AMAZON_SEARCH_INDEXES: Readonly<Record<string, string>> = {
  Automotive: "Car & Motorbike",
  Baby: "Baby",
  Beauty: "Beauty",
  Books: "Books",
  Computers: "Computers & Accessories",
  DIY: "DIY & Tools",
  Electronics: "Electronics & Photo",
  Fashion: "Fashion",
  GardenAndOutdoor: "Garden",
  Grocery: "Grocery",
  HealthPersonalCare: "Health & Personal Care",
  HomeAndKitchen: "Home & Kitchen",
  Lighting: "Lighting",
  OfficeProducts: "Stationery & Office Supplies",
  PetSupplies: "Pet Supplies",
  SportsAndOutdoors: "Sports & Outdoors",
  ToysAndGames: "Toys & Games",
  VideoGames: "PC & Video Games",
};

/** One ASIN from an ASIN or an amazon.co.uk product link; null if it isn't either. */
export function asinFrom(entry: string): string | null {
  const value = entry.trim();
  if (ASIN.test(value.toUpperCase()) && !value.includes("/")) return value.toUpperCase();
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!AMAZON_HOST.test(url.hostname)) return null;
    return ASIN_IN_PATH.exec(url.pathname)?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

/** ASINs (in order, de-duplicated) from a pasted list: one per line, or separated by commas. */
export function parseAsinList(text: string): { asins: string[]; invalid: string[] } {
  const asins: string[] = [];
  const invalid: string[] = [];
  for (const entry of text.split(/[\s,]+/).filter(Boolean)) {
    const asin = asinFrom(entry);
    if (asin === null) invalid.push(entry.slice(0, 100));
    else if (!asins.includes(asin)) asins.push(asin);
  }
  return { asins, invalid };
}

const idSchema = z.string().trim().min(1).max(64);

export const amazonAsinsFormSchema = z.object({
  retailerId: idSchema,
  asins: z.string().max(200_000),
});

export const amazonSearchFormSchema = z.object({
  retailerId: idSchema,
  keywords: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(2).max(200)),
  searchIndex: z
    .string()
    .refine((v) => v === "" || Object.hasOwn(AMAZON_SEARCH_INDEXES, v))
    .transform((v) => (v === "" ? undefined : v)),
  minSavingPercent: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 99) {
        ctx.addIssue({ code: "custom", message: "1–99" });
        return z.NEVER;
      }
      return n;
    }),
  pages: z.coerce.number().int().min(1).max(10),
});

export const amazonSearchRemoveSchema = z.object({
  retailerId: idSchema,
  index: z.coerce.number().int().min(0).max(MAX_AMAZON_SEARCHES),
});
