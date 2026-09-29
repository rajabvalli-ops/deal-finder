import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AffiliateDisclosure } from "@/components/public/affiliate-disclosure";
import { Breadcrumbs, type Crumb } from "@/components/public/breadcrumbs";
import { DealGrid } from "@/components/public/deal-card";
import { PriceBlock } from "@/components/public/price-block";
import { ProductImage } from "@/components/public/product-image";
import { PriceChart } from "@/components/ui/price-chart";
import { formatDate, formatDateTime, humanise } from "@/lib/format";
import { formatBps, formatPrice } from "@/lib/money";
import { isAtHistoricalLow } from "@/lib/public-types";
import { publicCatalogue } from "@/server/services/public";

export const revalidate = 300;

// No pages are built ahead of time; each deal page is rendered on first visit, then cached.
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const deal = await publicCatalogue.dealBySlug((await params).slug, new Date());
  if (!deal) return { title: "Deal not found" };
  return {
    title: `${deal.title} — ${formatPrice(deal.dealPrice)} at ${deal.retailer.name}`,
    description: `${formatBps(deal.discountBps)} below its ${deal.referenceType === "PREVIOUS" ? "previous price" : "recent average price"}. Price history and averages for ${deal.product.title}.`,
  };
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">
        {value === null ? "—" : formatPrice(value)}
      </dd>
    </div>
  );
}

export default async function DealPage({ params }: Props) {
  const { slug } = await params;
  const now = new Date();
  const [deal, related] = await Promise.all([
    publicCatalogue.dealBySlug(slug, now),
    publicCatalogue.relatedDeals(slug),
  ]);
  if (!deal) notFound();

  const crumbs: Crumb[] = [
    { href: "/", label: "Home" },
    { href: "/deals", label: "Deals" },
    ...(deal.category
      ? [{ href: `/categories/${deal.category.slug}`, label: deal.category.name }]
      : []),
    { label: deal.title },
  ];

  return (
    <div className="space-y-10">
      <Breadcrumbs items={crumbs} />

      <div className="grid gap-8 lg:grid-cols-2">
        <ProductImage src={deal.imageUrl} label={deal.brand ?? deal.retailer.name} large />
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium tracking-wide text-ink-muted uppercase">
              <Link href={`/retailers/${deal.retailer.slug}`} className="hover:text-brand-600">
                {deal.retailer.name}
              </Link>
            </p>
            <h1 className="text-2xl font-bold sm:text-3xl">{deal.title}</h1>
          </div>

          <PriceBlock deal={deal} size="lg" />

          <ul className="flex flex-wrap gap-2 text-sm">
            {isAtHistoricalLow(deal) ? (
              <li className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-900">
                Lowest price we&apos;ve recorded
              </li>
            ) : null}
            <li className="rounded-full bg-surface-muted px-3 py-1">
              {humanise(deal.product.availability)}
            </li>
            {deal.expiresAt ? (
              <li className="rounded-full bg-surface-muted px-3 py-1">
                Ends {formatDate(deal.expiresAt)}
              </li>
            ) : null}
          </ul>

          <p className="text-sm text-ink-muted">
            Price checked {formatDateTime(deal.priceCheckedAt)}. Prices and stock can change quickly
            — check the final price at {deal.retailer.name} before you buy.
          </p>

          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-ink-muted">
            The link to {deal.retailer.name} is being set up and will appear here shortly.
          </p>

          <AffiliateDisclosure />
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">Price history</h2>
        <PriceChart
          observations={deal.history}
          until={now}
          label={`Price history for ${deal.product.title} over the last 180 days`}
        />
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Now" value={deal.dealPrice} />
          <Stat label="Lowest recorded" value={deal.stats.lowest} />
          <Stat label="Highest recorded" value={deal.stats.highest} />
          <Stat label="7-day average" value={deal.stats.avg7} />
          <Stat label="30-day average" value={deal.stats.avg30} />
          <Stat label="90-day average" value={deal.stats.avg90} />
        </dl>
        <p className="text-xs text-ink-muted">
          Averages are weighted by how long each price applied, over the last 180 days of in-stock
          prices. An average is only shown when we have enough price history to be reliable.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">About this product</h2>
        <dl className="grid max-w-xl grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-ink-muted">Product</dt>
          <dd>{deal.product.title}</dd>
          {deal.brand ? (
            <>
              <dt className="text-ink-muted">Brand</dt>
              <dd>{deal.brand}</dd>
            </>
          ) : null}
          {deal.product.model ? (
            <>
              <dt className="text-ink-muted">Model</dt>
              <dd>{deal.product.model}</dd>
            </>
          ) : null}
          {deal.product.rating !== null ? (
            <>
              <dt className="text-ink-muted">Rating</dt>
              <dd>
                {deal.product.rating.toFixed(1)} out of 5
                {deal.product.reviewCount
                  ? ` from ${deal.product.reviewCount.toLocaleString("en-GB")} reviews`
                  : ""}{" "}
                at {deal.retailer.name}
              </dd>
            </>
          ) : null}
        </dl>
        {deal.description ? <p className="max-w-prose">{deal.description}</p> : null}
        {deal.product.description ? (
          <p className="max-w-prose text-ink-muted">{deal.product.description}</p>
        ) : null}
      </section>

      {related.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Related deals</h2>
          <DealGrid deals={related} />
        </section>
      ) : null}
    </div>
  );
}
