import { formatBps, formatPrice } from "./money";

// What a voucher takes off, and the price a deal comes to with it ("£12.99 with code SAVE10").

export type VoucherDiscount = {
  /** Fixed amount off, in pence. */
  discountPence: number | null;
  /** Percentage off, in basis points. */
  discountBps: number | null;
  /** The basket must be at least this much (pence) for the code to work. */
  minSpendPence: number | null;
};

export type CodedVoucher = VoucherDiscount & { code: string | null };

/** The price after the voucher, or null when it doesn't apply (no discount, below min spend). */
export function priceWithVoucher(price: number, voucher: VoucherDiscount): number | null {
  if (voucher.minSpendPence !== null && price < voucher.minSpendPence) return null;
  if (voucher.discountPence !== null) return Math.max(0, price - voucher.discountPence);
  if (voucher.discountBps !== null) {
    return Math.max(0, price - Math.round((price * voucher.discountBps) / 10_000));
  }
  return null;
}

/** The lowest price any of the vouchers with a code gives, with that code; null if none helps. */
export function bestPriceWithCode(
  price: number,
  vouchers: CodedVoucher[],
): { price: number; code: string } | null {
  let best: { price: number; code: string } | null = null;
  for (const voucher of vouchers) {
    if (!voucher.code) continue;
    const reduced = priceWithVoucher(price, voucher);
    if (reduced !== null && reduced < price && (best === null || reduced < best.price)) {
      best = { price: reduced, code: voucher.code };
    }
  }
  return best;
}

/** "£5 off", "10% off", "£5 off £30+", or null when no discount was entered. */
export function formatVoucherDiscount(voucher: VoucherDiscount): string | null {
  const off =
    voucher.discountPence !== null
      ? `${formatPrice(voucher.discountPence)} off`
      : voucher.discountBps !== null
        ? `${formatBps(voucher.discountBps)} off`
        : null;
  if (!off) return null;
  return voucher.minSpendPence ? `${off} ${formatPrice(voucher.minSpendPence)}+` : off;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function timeAgo(then: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - then.getTime());
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), "minute");
  if (ms < DAY) return plural(Math.floor(ms / HOUR), "hour");
  return plural(Math.floor(ms / DAY), "day");
}
