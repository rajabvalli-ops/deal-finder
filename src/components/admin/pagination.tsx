import Link from "next/link";

type Props = {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageCount: number;
};

function href(basePath: string, params: Props["params"], page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function Pagination({ basePath, params, page, pageCount }: Props) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center gap-4 text-sm">
      {page > 1 ? (
        <Link href={href(basePath, params, page - 1)} className="text-brand-600 hover:underline">
          ← Previous
        </Link>
      ) : null}
      <span className="text-ink-muted">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(basePath, params, page + 1)} className="text-brand-600 hover:underline">
          Next →
        </Link>
      ) : null}
    </nav>
  );
}
