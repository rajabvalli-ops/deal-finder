import { formatBps, formatPrice } from "@/lib/money";
import { REFERENCE_DESCRIPTIONS, type PublicDealSummary } from "@/lib/public-types";

/**
 * The deal price with an honest comparison: the basis of every saving is named
 * (previous price or an average), never a bare "was" price.
 */
export function PriceBlock({ deal, size = "md" }: { deal: PublicDealSummary; size?: "md" | "lg" }) {
  return (
    <div className="space-y-1">
      <p className={`font-bold tabular-nums ${size === "lg" ? "text-4xl" : "text-2xl"}`}>
        {formatPrice(deal.dealPrice)}
      </p>
      <WithCode deal={deal} />
      <p className={`text-ink-muted ${size === "lg" ? "text-base" : "text-sm"}`}>
        <span className="font-semibold text-saving-600">{formatBps(deal.discountBps)} below</span>{" "}
        {REFERENCE_DESCRIPTIONS[deal.referenceType]} of {formatPrice(deal.referencePrice)}
        {size === "lg" ? <> — a saving of {formatPrice(deal.savingAmount)}</> : null}
      </p>
    </div>
  );
}

/** "£12.99 with code SAVE10" when one of the deal's vouchers lowers the price. */
export function WithCode({ deal }: { deal: Pick<PublicDealSummary, "withCode"> }) {
  if (!deal.withCode) return null;
  return (
    <p className="w-fit rounded-md bg-lime-400 px-2 py-0.5 text-sm font-bold text-black">
      {formatPrice(deal.withCode.price)} with code{" "}
      <span className="font-mono">{deal.withCode.code}</span>
    </p>
  );
}

/** Free outright, or free with a code. */
export function isFreebie(deal: Pick<PublicDealSummary, "dealPrice" | "withCode">): boolean {
  return deal.dealPrice === 0 || deal.withCode?.price === 0;
}
