import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { DealGrid } from "@/components/public/deal-card";
import { PageLinks } from "@/components/public/sort-and-pages";
import { pageRequest } from "@/lib/pagination";
import { publicCatalogue } from "@/server/services/public";

export const metadata: Metadata = {
  title: "Big price drops and possible price errors",
  description:
    "Live deals at least 35% below their usual price, including possible pricing mistakes, checked against each product's price history.",
};

const PAGE_SIZE = 24;

export default async function PriceDropsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const deals = await publicCatalogue.listDeals({
    sort: "newest",
    bigDropsOnly: true,
    page: pageRequest(sp.page, PAGE_SIZE),
  });

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Price drops" }]} />
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Big price drops</h1>
        <p className="max-w-prose text-ink-muted">
          Deals at least 35% below the product&apos;s usual price. Anything 70% or more below is
          flagged as a possible price error — those are often corrected or cancelled quickly.{" "}
          <Link href="/alerts" className="font-medium text-brand-600 hover:underline">
            Get alerts
          </Link>{" "}
          so you hear about them first.
        </p>
      </div>
      {deals.items.length > 0 ? (
        <DealGrid deals={deals.items} />
      ) : (
        <p className="text-ink-muted">No big drops are live right now. Check back soon.</p>
      )}
      <PageLinks
        basePath="/price-drops"
        sort="newest"
        page={deals.page}
        pageCount={deals.pageCount}
      />
    </div>
  );
}
