import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { DealGrid } from "@/components/public/deal-card";
import { SearchForm } from "@/components/public/search-form";
import { hasCriteria, parseSearchParams, searchHref } from "@/lib/validation/search";
import { publicSearch } from "@/server/services/public";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Result pages vary with every query, so they are kept out of search engines; the empty
// search page itself can be indexed.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const filters = parseSearchParams(await searchParams);
  return {
    title: filters.q ? `Search: ${filters.q}` : "Search deals",
    description: "Search live deals by keyword, category, retailer, price and discount.",
    ...(hasCriteria(filters) ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const requested = parseSearchParams(await searchParams);
  const [{ filters, results }, options] = await Promise.all([
    publicSearch.search(requested),
    publicSearch.options(),
  ]);
  const searched = hasCriteria(filters);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Search" }]} />
      <h1 className="text-3xl font-bold">Search deals</h1>
      <SearchForm filters={filters} options={options} />

      <section aria-labelledby="results-heading" className="space-y-4">
        <h2 id="results-heading" className="text-lg font-semibold">
          {results.total === 0
            ? "No deals found"
            : `${results.total} deal${results.total === 1 ? "" : "s"}${filters.q ? ` for “${filters.q}”` : searched ? " match your filters" : " live now"}`}
        </h2>

        {results.items.length > 0 ? (
          <DealGrid deals={results.items} />
        ) : results.total === 0 ? (
          <div className="space-y-2 rounded-lg border border-line p-6 text-ink-muted">
            <p>
              {searched
                ? "Nothing live matches that right now. Try fewer words, a different spelling or fewer filters."
                : "No deals are live right now. Prices are checked throughout the day, so come back soon."}
            </p>
            {searched ? (
              <p>
                <Link href="/search" className="font-medium text-brand-600 hover:underline">
                  Clear search
                </Link>{" "}
                or{" "}
                <Link href="/deals" className="font-medium text-brand-600 hover:underline">
                  browse all deals
                </Link>
                .
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-ink-muted">
            There are no more results.{" "}
            <Link
              href={searchHref(filters, { page: 1 })}
              className="font-medium text-brand-600 hover:underline"
            >
              Back to the first page
            </Link>
          </p>
        )}

        {results.pageCount > 1 ? (
          <nav aria-label="Pagination" className="flex items-center justify-center gap-4 text-sm">
            {results.page > 1 && results.page <= results.pageCount ? (
              <Link
                href={searchHref(filters, { page: results.page - 1 })}
                className="font-medium text-brand-600 hover:underline"
              >
                ← Previous
              </Link>
            ) : null}
            <span className="text-ink-muted">
              Page {Math.min(results.page, results.pageCount)} of {results.pageCount}
            </span>
            {results.page < results.pageCount ? (
              <Link
                href={searchHref(filters, { page: results.page + 1 })}
                className="font-medium text-brand-600 hover:underline"
              >
                Next →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
