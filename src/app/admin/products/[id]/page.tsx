import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceChart } from "@/components/ui/price-chart";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, humanise } from "@/lib/format";
import { formatBps, formatPrice } from "@/lib/money";
import { getProductDetail } from "@/server/services/admin";

export const metadata = { title: "Product" };

export default async function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const now = new Date();
  const detail = await getProductDetail(id, now);
  if (!detail) notFound();
  const { product, defaultVariant, history } = detail;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm">
          <Link href="/admin/products" className="text-brand-600 hover:underline">
            ← Products
          </Link>
        </p>
        <h1 className="text-2xl font-bold">{product.title}</h1>
        <p className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          <StatusBadge status={product.availability} />
          {!product.isActive ? <StatusBadge status="DELISTED" /> : null}
          <span>{product.retailer.name}</span>
          <span>{product.category?.name ?? "Uncategorised"}</span>
          <span>Retailer ID {product.externalId}</span>
          <span>Last seen {formatDateTime(product.lastSeenAt)}</span>
        </p>
        <p className="text-sm break-all text-ink-muted">Retailer page: {product.productUrl}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Variants</h2>
        <table className="text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-1 pr-6 font-medium">Variant</th>
              <th className="py-1 pr-6 font-medium">Retailer ID</th>
              <th className="py-1 pr-6 text-right font-medium">Price</th>
              <th className="py-1 pr-6 font-medium">Stock</th>
            </tr>
          </thead>
          <tbody>
            {product.variants.map((v) => (
              <tr key={v.id} className="border-t border-line">
                <td className="py-1 pr-6">
                  {v.name}
                  {v.isDefault ? <span className="text-ink-muted"> (default)</span> : null}
                </td>
                <td className="py-1 pr-6">{v.externalId}</td>
                <td className="py-1 pr-6 text-right tabular-nums">
                  {v.currentPrice === null ? "—" : formatPrice(v.currentPrice)}
                </td>
                <td className="py-1 pr-6">
                  <StatusBadge status={v.availability} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {history && defaultVariant ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            Price history — {defaultVariant.name} (last 180 days)
          </h2>
          <PriceChart
            observations={history.observations}
            until={now}
            label={`Price history for ${product.title}`}
          />
          <p className="text-sm text-ink-muted">
            Pricing engine {history.stats.engineVersion}: current{" "}
            {history.stats.current === null ? "—" : formatPrice(history.stats.current)}, previous{" "}
            {history.stats.previous === null ? "—" : formatPrice(history.stats.previous)}, 30-day
            average {history.stats.avg30 === null ? "—" : formatPrice(history.stats.avg30)}, 90-day
            average {history.stats.avg90 === null ? "—" : formatPrice(history.stats.avg90)}.
          </p>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand-600">
              All {history.observations.length} observations
            </summary>
            <div className="max-h-96 overflow-y-auto">
              <table className="mt-2 text-left text-sm">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-1 pr-6 font-medium">Observed</th>
                    <th className="py-1 pr-6 text-right font-medium">Price</th>
                    <th className="py-1 pr-6 font-medium">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history.observations].reverse().map((o) => (
                    <tr key={o.id} className="border-t border-line">
                      <td className="py-1 pr-6 whitespace-nowrap">
                        {formatDateTime(o.observedAt)}
                      </td>
                      <td className="py-1 pr-6 text-right tabular-nums">{formatPrice(o.price)}</td>
                      <td className="py-1 pr-6">{humanise(o.availability)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Outbound link</h2>
        {product.affiliateLinks[0] ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-ink-muted">Public link</dt>
            <dd className="font-mono">/go/{product.affiliateLinks[0].code}</dd>
            <dt className="text-ink-muted">Goes to</dt>
            <dd className="break-all">{product.affiliateLinks[0].destinationUrl}</dd>
            <dt className="text-ink-muted">Built by</dt>
            <dd>{product.affiliateLinks[0].network ?? "—"} adapter</dd>
            <dt className="text-ink-muted">Status</dt>
            <dd>{product.affiliateLinks[0].isActive ? "Active" : "Inactive"}</dd>
            <dt className="text-ink-muted">Clicks by people</dt>
            <dd className="tabular-nums">{product.affiliateLinks[0]._count.clicks}</dd>
            <dt className="text-ink-muted">Last updated</dt>
            <dd>{formatDateTime(product.affiliateLinks[0].updatedAt)}</dd>
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">
            No outbound link yet. The next catalogue import for this retailer creates it.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Deals</h2>
        {product.deals.length === 0 ? (
          <p className="text-sm text-ink-muted">No deals detected for this product.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {product.deals.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge status={d.status} />
                <Link href={`/admin/deals/${d.id}`} className="text-brand-600 hover:underline">
                  {formatPrice(d.dealPrice)} ({formatBps(d.discountBps)} off) — detected{" "}
                  {formatDateTime(d.detectedAt)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
