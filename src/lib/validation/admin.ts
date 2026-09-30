import { z } from "zod";

// Admin form input. Server Actions parse FormData with these; services trust the parsed types.

/** Empty form fields become null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

export const idSchema = z.string().trim().min(1).max(64);

export const dealActionSchema = z.object({
  dealId: idSchema,
  action: z.enum(["approve", "reject", "publish", "expire", "remove"]),
  reason: optionalText(500).optional(),
});

export const dealContentSchema = z.object({
  dealId: idSchema,
  title: z.string().trim().min(3).max(200),
  summary: optionalText(300),
  description: optionalText(5000),
  isFeatured: z
    .union([z.literal("on"), z.literal("")])
    .optional()
    .transform((v) => v === "on"),
  /** From <input type="datetime-local">; interpreted as UK local time is out of scope — treated as UTC. */
  expiresAt: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`);
      if (Number.isNaN(date.getTime())) {
        ctx.addIssue({ code: "custom", message: "Invalid date" });
        return z.NEVER;
      }
      return date;
    }),
});

export const retailerUpdateSchema = z.object({
  retailerId: idSchema,
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]),
  trustScore: z.coerce.number().int().min(0).max(100),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  parentId: z
    .string()
    .trim()
    .max(64)
    .transform((v) => (v === "" ? null : v)),
  sortOrder: z.coerce.number().int().min(0).max(1000),
});

export const categoryUpdateSchema = categorySchema.extend({ categoryId: idSchema });

export const userRoleSchema = z.object({
  userId: idSchema,
  role: z.enum(["USER", "EDITOR", "ADMIN"]),
});
