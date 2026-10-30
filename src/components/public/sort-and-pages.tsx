import Link from "next/link";
import { DEAL_SORT_LABELS, DEAL_SORTS, type DealSort } from "@/lib/public-types";

function href(basePath: string, sort: DealSort, page: number) {
  const params = new URLSearchParams();
  if (sort !== "newest") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** Sort links (no JavaScript needed). */
export function SortLinks({ basePath, current }: { basePath: string; current: DealSort }) {
  return (
    <nav aria-label="Sort deals" className="flex flex-wrap gap-2 text-sm">
      {DEAL_SORTS.map((sort) => (
        <Link
          key={sort}
          href={href(basePath, sort, 1)}
          aria-current={sort === current ? "true" : undefined}
          className={`rounded-full border px-3 py-1 ${sort === current ? "border-brand-600 bg-brand-50 font-semibold text-brand-700" : "border-line hover:border-brand-600"}`}
        >
          {DEAL_SORT_LABELS[sort]}
        </Link>
      ))}
    </nav>
  );
}

export function PageLinks({
  basePath,
  sort,
  page,
  pageCount,
}: {
  basePath: string;
  sort: DealSort;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-4 text-sm">
      {page > 1 ? (
        <Link
          href={href(basePath, sort, page - 1)}
          className="font-medium text-brand-600 hover:underline"
        >
          ← Previous
        </Link>
      ) : null}
      <span className="text-ink-muted">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link
          href={href(basePath, sort, page + 1)}
          className="font-medium text-brand-600 hover:underline"
        >
          Next →
        </Link>
      ) : null}
    </nav>
  );
}
