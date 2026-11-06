import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { LiveLine } from "@/components/public/live-line";
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
  const [deals, live] = await Promise.all([
    publicCatalogue.listDeals({ sort, page: pageRequest(sp.page, PAGE_SIZE) }),
    publicCatalogue.liveStats(),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Deals" }]} />
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Latest deals</h1>
        <LiveLine count={live.count} lastCheckedAt={live.lastCheckedAt} />
        <p className="text-ink-muted">
          Each deal is checked against the product&apos;s own price history.
        </p>
      </div>
      <SortLinks basePath="/deals" current={sort} forYou />
      {deals.items.length > 0 ? (
        <DealGrid deals={deals.items} />
      ) : (
        <p className="text-ink-muted">No deals are live right now.</p>
      )}
      <PageLinks basePath="/deals" sort={sort} page={deals.page} pageCount={deals.pageCount} />
    </div>
  );
}
