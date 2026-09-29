import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, type Crumb } from "@/components/public/breadcrumbs";
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
  const category = await publicCatalogue.categoryBySlug((await params).slug);
  return category
    ? {
        title: `${category.name} deals`,
        description: `Price drops on ${category.name.toLowerCase()} from UK retailers.`,
      }
    : { title: "Category not found" };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const category = await publicCatalogue.categoryBySlug(slug);
  if (!category) notFound();
  const sort = parseDealSort(typeof sp.sort === "string" ? sp.sort : undefined);
  const deals = await publicCatalogue.listDeals({
    sort,
    page: pageRequest(sp.page, 24),
    categoryIds: category.categoryIds,
  });
  const basePath = `/categories/${category.slug}`;

  const crumbs: Crumb[] = [
    { href: "/", label: "Home" },
    ...(category.parent
      ? [{ href: `/categories/${category.parent.slug}`, label: category.parent.name }]
      : []),
    { label: category.name },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={crumbs} />
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{category.name} deals</h1>
        {category.description ? <p className="text-ink-muted">{category.description}</p> : null}
      </div>
      {category.children.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Subcategories">
          {category.children.map((child) => (
            <li key={child.slug}>
              <Link
                href={`/categories/${child.slug}`}
                className="inline-block rounded-full border border-line px-3 py-1 text-sm hover:border-brand-600"
              >
                {child.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <SortLinks basePath={basePath} current={sort} />
      {deals.items.length > 0 ? (
        <DealGrid deals={deals.items} />
      ) : (
        <p className="text-ink-muted">No {category.name.toLowerCase()} deals are live right now.</p>
      )}
      <PageLinks basePath={basePath} sort={sort} page={deals.page} pageCount={deals.pageCount} />
    </div>
  );
}
