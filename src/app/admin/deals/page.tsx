import Link from "next/link";
import { Pagination } from "@/components/admin/pagination";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, humanise } from "@/lib/format";
import { formatBps, formatPrice } from "@/lib/money";
import { pageRequest, toPage } from "@/lib/pagination";
import { DEAL_STATUSES, type DealStatus } from "@/server/deals/workflow";
import { adminReads } from "@/server/services/admin";
import { param, type SearchParams } from "../_lib/params";

export const metadata = { title: "Deals" };

export default async function AdminDealsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const status = param(sp, "status");
  const q = param(sp, "q");
  const statusFilter = (DEAL_STATUSES as readonly string[]).includes(status ?? "")
    ? (status as DealStatus)
    : undefined;
  const request = pageRequest(sp.page);
  const { items, total } = await adminReads.listDeals({
    statuses: statusFilter ? [statusFilter] : undefined,
    q,
    skip: request.skip,
    take: request.take,
  });
  const page = toPage(items, total, request);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Deals</h1>
      <form className="flex flex-wrap items-end gap-3 text-sm" role="search">
        <label className="flex flex-col">
          Status
          <select
            name="status"
            defaultValue={statusFilter ?? ""}
            className="mt-1 rounded-md border border-line bg-surface px-2 py-1"
          >
            <option value="">All</option>
            {DEAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanise(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Title or brand"
            className="mt-1 rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
        >
          Filter
        </button>
      </form>

      <p className="text-sm text-ink-muted">
        {total} deal{total === 1 ? "" : "s"}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">No deals match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Deal</th>
                <th className="py-2 pr-4 font-medium">Retailer</th>
                <th className="py-2 pr-4 text-right font-medium">Price</th>
                <th className="py-2 pr-4 text-right font-medium">Discount</th>
                <th className="py-2 pr-4 text-right font-medium">Score</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Detected</th>
              </tr>
            </thead>
            <tbody>
              {items.map((deal) => (
                <tr key={deal.id} className="border-t border-line align-top">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/deals/${deal.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {deal.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{deal.retailer.name}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPrice(deal.dealPrice)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatBps(deal.discountBps)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{deal.score}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={deal.status} />
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(deal.detectedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        basePath="/admin/deals"
        params={{ status: statusFilter, q }}
        page={page.page}
        pageCount={page.pageCount}
      />
    </div>
  );
}
