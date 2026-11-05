import Link from "next/link";
import { DEAL_LEVEL_LABELS } from "@/lib/alerts";
import { formatBps, formatPrice } from "@/lib/money";
import { isAtHistoricalLow, type PublicDealSummary } from "@/lib/public-types";
import { ProductImage } from "./product-image";

export function DealCard({ deal }: { deal: PublicDealSummary }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface transition hover:border-brand-600">
      <div className="relative">
        <ProductImage
          src={deal.imageUrl}
          label={deal.brand ?? deal.category?.name ?? deal.retailer.name}
        />
        <span className="absolute top-2 left-2 flex flex-col items-start gap-1">
          <span className="rounded-md bg-saving-600 px-2 py-0.5 text-sm font-bold text-white">
            −{formatBps(deal.discountBps)}
          </span>
          <LevelBadge level={deal.level} />
        </span>
        {isAtHistoricalLow(deal) ? (
          <span className="absolute top-2 right-2 rounded-md bg-surface px-2 py-0.5 text-xs font-semibold text-ink shadow">
            Lowest price
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:gap-2 sm:p-4">
        <p className="truncate text-xs font-medium tracking-wide text-ink-muted uppercase">
          {deal.retailer.name}
        </p>
        <h3 className="text-sm leading-snug font-semibold sm:text-base">
          <Link
            href={`/deals/${deal.slug}`}
            className="after:absolute after:inset-0 hover:text-brand-600 focus-visible:outline-none"
          >
            {deal.title}
          </Link>
        </h3>
        <div className="mt-auto">
          <p className="text-lg font-bold tabular-nums sm:text-xl">{formatPrice(deal.dealPrice)}</p>
          <p className="text-sm text-ink-muted">Save {formatPrice(deal.savingAmount)}</p>
        </div>
      </div>
    </article>
  );
}

/** "Big drop" / "Possible price error" label; nothing for ordinary deals. */
export function LevelBadge({ level }: { level: PublicDealSummary["level"] }) {
  const label = DEAL_LEVEL_LABELS[level];
  if (!label) return null;
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-bold text-white ${level === "PRICE_ERROR" ? "bg-red-700" : "bg-amber-700"}`}
    >
      {label}
    </span>
  );
}

export function DealGrid({ deals }: { deals: PublicDealSummary[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {deals.map((deal) => (
        <li key={deal.slug} className="relative">
          <DealCard deal={deal} />
        </li>
      ))}
    </ul>
  );
}
