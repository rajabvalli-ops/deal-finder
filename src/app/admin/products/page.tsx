import Link from "next/link";
import { Pagination } from "@/components/admin/pagination";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/format";
import { formatPrice } from "@/lib/money";
import { pageRequest, toPage } from "@/lib/pagination";
import { adminReads } from "@/server/services/admin";
import { param, type SearchParams } from "../_lib/params";

export const metadata = { title: "Products" };

export default async function AdminProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = param(sp, "q");
  const show = param(sp, "show");
  const isActive = show === "inactive" ? false : show === "all" ? undefined : true;
  const request = pageRequest(sp.page);
  const { items, total } = await adminReads.listProducts({
    q,
    isActive,
    skip: request.skip,
    take: request.take,
  });
  const page = toPage(items, total, request);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Products</h1>
      <form className="flex flex-wrap items-end gap-3 text-sm" role="search">
        <label className="flex flex-col">
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Title, brand or retailer ID"
            className="mt-1 rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        <label className="flex flex-col">
          Show
          <select
            name="show"
            defaultValue={show ?? ""}
            className="mt-1 rounded-md border border-line bg-surface px-2 py-1"
          >
            <option value="">Active</option>
            <option value="inactive">Inactive (delisted)</option>
            <option value="all">All</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
        >
          Filter
        </button>
      </form>
      <p className="text-sm text-ink-muted">
        {total} product{total === 1 ? "" : "s"}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">No products match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Product</th>
                <th className="py-2 pr-4 font-medium">Retailer</th>
                <th className="py-2 pr-4 font-medium">Category</th>
                <th className="py-2 pr-4 text-right font-medium">Current</th>
                <th className="py-2 pr-4 text-right font-medium">Lowest</th>
                <th className="py-2 pr-4 font-medium">Stock</th>
                <th className="py-2 pr-4 font-medium">Priced</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/products/${p.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{p.retailer.name}</td>
                  <td className="py-2 pr-4">{p.category?.name ?? "—"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {p.currentPrice === null ? "—" : formatPrice(p.currentPrice)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {p.lowestPrice === null ? "—" : formatPrice(p.lowestPrice)}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={p.availability} />
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {formatDateTime(p.priceUpdatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        basePath="/admin/products"
        params={{ q, show }}
        page={page.page}
        pageCount={page.pageCount}
      />
    </div>
  );
}
