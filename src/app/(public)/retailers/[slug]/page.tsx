import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { DealGrid } from "@/components/public/deal-card";
import { PageLinks, SortLinks } from "@/components/public/sort-and-pages";
import { pageRequest } from "@/lib/pagination";
import { parseDealSort } from "@/lib/public-types";
import { publicCatalogue } from "@/server/services/public";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const retailer = await publicCatalogue.retailerBySlug((await params).slug);
  return retailer
    ? {
        title: `${retailer.name} deals`,
        description: `Current price drops at ${retailer.name}, checked against price history.`,
      }
    : { title: "Retailer not found" };
}

export default async function RetailerPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const retailer = await publicCatalogue.retailerBySlug(slug);
  if (!retailer) notFound();
  const sort = parseDealSort(typeof sp.sort === "string" ? sp.sort : undefined);
  const deals = await publicCatalogue.listDeals({
    sort,
    page: pageRequest(sp.page, 24),
    retailerId: retailer.id,
  });
  const basePath = `/retailers/${retailer.slug}`;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: retailer.name }]} />
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{retailer.name} deals</h1>
        {retailer.description ? (
          <p className="max-w-prose text-ink-muted">{retailer.description}</p>
        ) : null}
        {retailer.status !== "ACTIVE" ? (
          <p className="text-sm text-ink-muted">
            We&apos;re not currently tracking new deals from {retailer.name}.
          </p>
        ) : null}
      </div>
      <SortLinks basePath={basePath} current={sort} />
      {deals.items.length > 0 ? (
        <DealGrid deals={deals.items} />
      ) : (
        <p className="text-ink-muted">No {retailer.name} deals are live right now.</p>
      )}
      <PageLinks basePath={basePath} sort={sort} page={deals.page} pageCount={deals.pageCount} />
    </div>
  );
}
