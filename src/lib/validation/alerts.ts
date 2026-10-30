import { z } from "zod";
import { DISCOUNT_OPTIONS, MAX_QUERY_LENGTH, parsePounds } from "./search";

// Price alert form input. Server Actions parse FormData with these; services trust the types.

/** Alerts one account may keep (active or paused). */
export const MAX_ALERTS_PER_USER = 25;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** An optional slug from a <select> or hidden field; "" → null. */
const optionalSlug = z
  .string()
  .trim()
  .max(100)
  .refine((v) => v === "" || SLUG.test(v))
  .transform((v) => (v === "" ? null : v))
  .prefault("");

export const alertFormSchema = z
  .object({
    keyword: z
      .string()
      .transform((v) => v.trim().replace(/\s+/g, " "))
      .refine((v) => v === "" || (v.length >= 2 && v.length <= MAX_QUERY_LENGTH))
      .transform((v) => (v === "" ? null : v))
      .prefault(""),
    category: optionalSlug,
    retailer: optionalSlug,
    /** A deal slug: the alert watches that deal's product. */
    deal: optionalSlug,
    /** Pounds, as typed. */
    max: z
      .string()
      .trim()
      .transform((v, ctx) => {
        if (v === "") return null;
        const pence = parsePounds(v);
        if (pence === null) {
          ctx.addIssue({ code: "custom", message: "Enter a price like 49.99" });
          return z.NEVER;
        }
        return pence;
      })
      .prefault(""),
    /** Percent, one of DISCOUNT_OPTIONS. */
    discount: z
      .string()
      .trim()
      .refine((v) => v === "" || (DISCOUNT_OPTIONS as readonly number[]).includes(Number(v)))
      .transform((v) => (v === "" ? null : Number(v) * 100))
      .prefault(""),
  })
  .refine((a) => a.keyword !== null || a.category !== null || a.deal !== null, {
    message: "Choose a keyword, a category or a product to watch",
  })
  .transform((a) => ({
    keyword: a.keyword,
    categorySlug: a.category,
    retailerSlug: a.retailer,
    dealSlug: a.deal,
    maxPrice: a.max,
    minDiscountBps: a.discount,
  }));

export type AlertInput = z.output<typeof alertFormSchema>;

const idSchema = z.string().trim().min(1).max(64);

export const alertActionSchema = z.object({
  alertId: idSchema,
  action: z.enum(["pause", "resume", "delete"]),
});

export const notificationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), notificationId: idSchema }),
  z.object({ action: z.literal("read-all") }),
]);
