import { z } from "zod";
import { idSchema, optionalDateTime } from "./admin";
import { parsePounds } from "./search";

// Voucher codes (admin form) and "report a problem" (public form).

/** Codes are stored upper-case without spaces, e.g. "SAVE10". */
export const VOUCHER_CODE = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .prefault("");

/** "£5", "5.50" (pounds off) or "10%", "12.5%" (percent off); "" = not stated. */
const discount = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return { discountPence: null, discountBps: null };
    const percent = /^(\d{1,3})(?:\.(\d{1,2}))?\s*%$/.exec(v);
    if (percent) {
      const bps = Number(percent[1]) * 100 + Number((percent[2] ?? "").padEnd(2, "0"));
      if (bps >= 1 && bps <= 10_000) return { discountPence: null, discountBps: bps };
    } else {
      const pence = parsePounds(v);
      if (pence !== null && pence > 0) return { discountPence: pence, discountBps: null };
    }
    ctx.addIssue({ code: "custom", message: "Enter an amount like £5 or a percentage like 10%" });
    return z.NEVER;
  })
  .prefault("");

/** Pounds, e.g. "20" or "£20"; "" = no minimum. */
const minSpend = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const pence = parsePounds(v);
    if (pence !== null && pence > 0) return pence;
    ctx.addIssue({ code: "custom", message: "Enter an amount like 20" });
    return z.NEVER;
  })
  .prefault("");

const voucherFields = z.object({
  retailerId: idSchema,
  /** Optional: some offers need no code ("10% off automatically at checkout"). */
  code: z
    .string()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => v === "" || VOUCHER_CODE.test(v), "Letters, numbers, - and _ only")
    .transform((v) => (v === "" ? null : v))
    .prefault(""),
  title: z.string().trim().min(3).max(120),
  description: optionalText(500),
  terms: optionalText(2000),
  validUntil: optionalDateTime.prefault(""),
  /** A deal slug, for codes that apply to one product (e.g. an Amazon voucher). */
  deal: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v))
    .transform((v) => (v === "" ? null : v))
    .prefault(""),
  discount,
  minSpend,
});

export const voucherFormSchema = voucherFields.transform(({ discount, minSpend, ...rest }) => ({
  ...rest,
  ...discount,
  minSpendPence: minSpend,
}));

export type VoucherInput = z.output<typeof voucherFormSchema>;

export const voucherActionSchema = z.object({
  couponId: idSchema,
  /** "checked": an editor confirmed the code still works. */
  action: z.enum(["deactivate", "activate", "checked", "delete"]),
});

export const REPORT_REASONS = {
  deal: {
    EXPIRED: "The deal has ended",
    WRONG_PRICE: "The price is different",
    OUT_OF_STOCK: "It's out of stock",
    OTHER: "Something else",
  },
  coupon: {
    CODE_NOT_WORKING: "The code doesn't work",
    EXPIRED: "The offer has ended",
    OTHER: "Something else",
  },
} as const;

export type ReportTargetKind = keyof typeof REPORT_REASONS;
export type ReportReasonCode =
  "EXPIRED" | "WRONG_PRICE" | "OUT_OF_STOCK" | "CODE_NOT_WORKING" | "OTHER";

export const reportFormSchema = z
  .object({
    target: z.enum(["deal", "coupon"]),
    id: idSchema,
    reason: z.enum(["EXPIRED", "WRONG_PRICE", "OUT_OF_STOCK", "CODE_NOT_WORKING", "OTHER"]),
    note: optionalText(300),
  })
  .refine((r) => r.reason in REPORT_REASONS[r.target], {
    message: "That reason doesn't apply here",
    path: ["reason"],
  });

export type ReportInput = z.output<typeof reportFormSchema>;

export const reportCloseSchema = z.object({
  targetId: idSchema,
  outcome: z.enum(["resolve", "dismiss"]),
});
