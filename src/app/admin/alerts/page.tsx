import { Pagination } from "@/components/admin/pagination";
import { formatDateTime } from "@/lib/format";
import { formatBps, formatPrice } from "@/lib/money";
import { pageRequest, toPage } from "@/lib/pagination";
import { adminReads } from "@/server/services/admin";
import type { SearchParams } from "../_lib/params";

export const metadata = { title: "Alerts" };

export default async function AdminAlertsPage({ searchParams }: { searchParams: SearchParams }) {
  const request = pageRequest((await searchParams).page);
  const { items, total } = await adminReads.listAlerts({ skip: request.skip, take: request.take });
  const page = toPage(items, total, request);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Alerts</h1>
      <p className="text-sm text-ink-muted">
        {total} alert{total === 1 ? "" : "s"}. Users create alerts once price alerts launch.
      </p>
      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Watching</th>
                <th className="py-2 pr-4 font-medium">Condition</th>
                <th className="py-2 pr-4 font-medium">Active</th>
                <th className="py-2 pr-4 font-medium">Last triggered</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="py-2 pr-4">{a.user.email}</td>
                  <td className="py-2 pr-4">
                    {[
                      a.keyword && `“${a.keyword}”`,
                      a.product?.title,
                      a.category?.name,
                      a.retailer?.name,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td className="py-2 pr-4">
                    {[
                      a.maxPrice !== null && `≤ ${formatPrice(a.maxPrice)}`,
                      a.minDiscountBps !== null && `≥ ${formatBps(a.minDiscountBps)} off`,
                    ]
                      .filter(Boolean)
                      .join(", ") || "Any price"}
                  </td>
                  <td className="py-2 pr-4">{a.isActive ? "Yes" : "No"}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {formatDateTime(a.lastTriggeredAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Pagination
        basePath="/admin/alerts"
        params={{}}
        page={page.page}
        pageCount={page.pageCount}
      />
    </div>
  );
}
