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
      <p className={`text-ink-muted ${size === "lg" ? "text-base" : "text-sm"}`}>
        <span className="font-semibold text-saving-600">{formatBps(deal.discountBps)} below</span>{" "}
        {REFERENCE_DESCRIPTIONS[deal.referenceType]} of {formatPrice(deal.referencePrice)}
        {size === "lg" ? <> — a saving of {formatPrice(deal.savingAmount)}</> : null}
      </p>
    </div>
  );
}
