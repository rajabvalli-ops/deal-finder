import Link from "next/link";
import { Pagination } from "@/components/admin/pagination";
import { formatDateTime } from "@/lib/format";
import { pageRequest, toPage } from "@/lib/pagination";
import { adminReads } from "@/server/services/admin";
import { param, type SearchParams } from "../_lib/params";

export const metadata = { title: "Clicks" };

const DAY_MS = 86_400_000;
const SUMMARY_DAYS = 7;

export default async function AdminClicksPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const includeBots = param(params, "bots") === "include";
  const request = pageRequest(params.page);
  const now = new Date();
  const since = new Date(now.getTime() - SUMMARY_DAYS * DAY_MS);
  const [{ items, total }, summary] = await Promise.all([
    adminReads.listClicks({ includeBots, skip: request.skip, take: request.take }),
    adminReads.clickSummary(since),
  ]);
  const page = toPage(items, total, request);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Clicks</h1>

      <section aria-labelledby="summary-heading" className="space-y-3">
        <h2 id="summary-heading" className="text-lg font-semibold">
          Last {SUMMARY_DAYS} days
        </h2>
        <dl className="grid max-w-md grid-cols-2 gap-3">
          <div className="rounded-lg border border-line p-4">
            <dt className="text-sm text-ink-muted">Clicks by people</dt>
            <dd className="text-2xl font-bold tabular-nums">{summary.people}</dd>
          </div>
          <div className="rounded-lg border border-line p-4">
            <dt className="text-sm text-ink-muted">Likely bots (excluded)</dt>
            <dd className="text-2xl font-bold tabular-nums">{summary.bots}</dd>
          </div>
        </dl>
        {summary.topDeals.length > 0 ? (
          <div>
            <h3 className="mb-1 text-sm font-medium text-ink-muted">Most-clicked deals</h3>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {summary.topDeals.map((d) => (
                <li key={d.dealId}>
                  <Link
                    href={`/admin/deals/${d.dealId}`}
                    className="text-brand-600 hover:underline"
                  >
                    {d.title}
                  </Link>{" "}
                  <span className="text-ink-muted tabular-nums">
                    — {d.clicks} click{d.clicks === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="list-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="list-heading" className="text-lg font-semibold">
            {includeBots ? "All clicks" : "Clicks by people"} ({total})
          </h2>
          <Link
            href={includeBots ? "/admin/clicks" : "/admin/clicks?bots=include"}
            className="text-sm text-brand-600 hover:underline"
          >
            {includeBots ? "Hide likely bots" : "Include likely bots"}
          </Link>
        </div>
        {items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Retailer</th>
                  <th className="py-2 pr-4 font-medium">Deal or product</th>
                  <th className="py-2 pr-4 font-medium">Placement</th>
                  <th className="py-2 pr-4 font-medium">Bot</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(c.createdAt)}</td>
                    <td className="py-2 pr-4">{c.affiliateLink.retailer.name}</td>
                    <td className="py-2 pr-4">
                      {c.deal ? (
                        <Link
                          href={`/admin/deals/${c.deal.id}`}
                          className="text-brand-600 hover:underline"
                        >
                          {c.deal.title}
                        </Link>
                      ) : c.product ? (
                        <Link
                          href={`/admin/products/${c.product.id}`}
                          className="text-brand-600 hover:underline"
                        >
                          {c.product.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-4">{c.placement ?? "—"}</td>
                    <td className="py-2 pr-4">{c.isBot ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No clicks yet.</p>
        )}
        <Pagination
          basePath="/admin/clicks"
          params={{ bots: includeBots ? "include" : undefined }}
          page={page.page}
          pageCount={page.pageCount}
        />
      </section>
    </div>
  );
}
