import { Pagination } from "@/components/admin/pagination";
import { formatDateTime } from "@/lib/format";
import { pageRequest, toPage } from "@/lib/pagination";
import { adminReads } from "@/server/services/admin";
import type { SearchParams } from "../_lib/params";

export const metadata = { title: "Clicks" };

export default async function AdminClicksPage({ searchParams }: { searchParams: SearchParams }) {
  const request = pageRequest((await searchParams).page);
  const { items, total } = await adminReads.listClicks({ skip: request.skip, take: request.take });
  const page = toPage(items, total, request);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Clicks</h1>
      <p className="text-sm text-ink-muted">
        {total} outbound click{total === 1 ? "" : "s"}. Clicks are recorded once affiliate links go
        live.
      </p>
      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Retailer</th>
                <th className="py-2 pr-4 font-medium">Deal</th>
                <th className="py-2 pr-4 font-medium">Placement</th>
                <th className="py-2 pr-4 font-medium">Bot</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(c.createdAt)}</td>
                  <td className="py-2 pr-4">{c.affiliateLink.retailer.name}</td>
                  <td className="py-2 pr-4">{c.deal?.title ?? "—"}</td>
                  <td className="py-2 pr-4">{c.placement ?? "—"}</td>
                  <td className="py-2 pr-4">{c.isBot ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Pagination
        basePath="/admin/clicks"
        params={{}}
        page={page.page}
        pageCount={page.pageCount}
      />
    </div>
  );
}
