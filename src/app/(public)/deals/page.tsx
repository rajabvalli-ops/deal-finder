import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { DealGrid } from "@/components/public/deal-card";
import { PageLinks, SortLinks } from "@/components/public/sort-and-pages";
import { pageRequest } from "@/lib/pagination";
import { parseDealSort } from "@/lib/public-types";
import { publicCatalogue } from "@/server/services/public";

export const metadata: Metadata = {
  title: "Latest deals",
  description: "Price drops from UK retailers, checked against each product's own price history.",
};

const PAGE_SIZE = 24;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const sort = parseDealSort(typeof sp.sort === "string" ? sp.sort : undefined);
  const deals = await publicCatalogue.listDeals({ sort, page: pageRequest(sp.page, PAGE_SIZE) });

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Deals" }]} />
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Latest deals</h1>
        <p className="text-ink-muted">
          {deals.total} live deal{deals.total === 1 ? "" : "s"}, each checked against the
          product&apos;s own price history.
        </p>
      </div>
      <SortLinks basePath="/deals" current={sort} />
      {deals.items.length > 0 ? (
        <DealGrid deals={deals.items} />
      ) : (
        <p className="text-ink-muted">No deals are live right now.</p>
      )}
      <PageLinks basePath="/deals" sort={sort} page={deals.page} pageCount={deals.pageCount} />
    </div>
  );
}
