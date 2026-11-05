// Search query parsing. Search URLs are shared and bookmarked, so bad values are dropped
// rather than rejected: the page always renders, showing only the filters that made sense.

export const SEARCH_SORTS = [
  "relevance",
  "newest",
  "discount",
  "saving",
  "price-asc",
  "price-desc",
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  relevance: "Best match",
  newest: "Newest",
  discount: "Biggest discount",
  saving: "Biggest saving",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
};

/** Minimum-discount choices offered in the form, in percent. */
export const DISCOUNT_OPTIONS = [10, 20, 30, 50] as const;

export const MAX_QUERY_LENGTH = 100;
/** £100,000 — far above any real deal; stops absurd values reaching the database. */
const MAX_PRICE_PENCE = 10_000_000;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SearchFilters = {
  q: string;
  category: string | null;
  retailer: string | null;
  /** Pence, inclusive. */
  minPrice: number | null;
  maxPrice: number | null;
  /** Percent, one of DISCOUNT_OPTIONS. */
  minDiscount: number | null;
  inStock: boolean;
  sort: SearchSort;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(raw: RawParams, key: string): string {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function slug(value: string): string | null {
  return value.length <= 100 && SLUG.test(value) ? value : null;
}

/** "12", "12.5", "£12.50" → pence. Anything else (or out of range) → null. */
export function parsePounds(value: string): number | null {
  const match = /^£?(\d{1,6})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const pence = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return pence <= MAX_PRICE_PENCE ? pence : null;
}

/** Pence → the plain pounds string a price input shows ("12.5" → "12.50", "12.00" → "12"). */
export function formatPoundsInput(pence: number | null): string {
  if (pence === null) return "";
  return pence % 100 === 0 ? String(pence / 100) : (pence / 100).toFixed(2);
}

export function parseSearchParams(raw: RawParams): SearchFilters {
  const q = first(raw, "q").replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
  let minPrice = parsePounds(first(raw, "min"));
  let maxPrice = parsePounds(first(raw, "max"));
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  const discount = Number(first(raw, "discount"));
  const requestedSort = first(raw, "sort");
  const sort = (SEARCH_SORTS as readonly string[]).includes(requestedSort)
    ? (requestedSort as SearchSort)
    : null;
  const pageValue = first(raw, "page");
  const page = /^\d{1,6}$/.test(pageValue) ? Math.max(1, Number(pageValue)) : 1;

  return {
    q,
    category: slug(first(raw, "category")),
    retailer: slug(first(raw, "retailer")),
    minPrice,
    maxPrice,
    minDiscount: (DISCOUNT_OPTIONS as readonly number[]).includes(discount) ? discount : null,
    inStock: first(raw, "stock") === "1",
    // Relevance only means something with a keyword.
    sort: sort === null || (sort === "relevance" && !q) ? (q ? "relevance" : "newest") : sort,
    page,
  };
}

/**
 * Typo matching ignores search operators, so it is skipped for queries that use them:
 * "quoted phrases", -exclusions and OR. A hyphen inside a word (EX-100) is not an operator.
 */
export function allowsTypoMatching(q: string): boolean {
  return q !== "" && !/"|(^|\s)-|(^|\s)or(\s|$)/i.test(q);
}

export const MAX_QUERY_TERMS = 8;

/** The distinct words of a keyword query (lower-cased), each of which must match. */
export function queryTerms(q: string): string[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_QUERY_TERMS);
}

/** True when the visitor searched or filtered (used to keep result pages out of search engines). */
export function hasCriteria(filters: SearchFilters): boolean {
  return Boolean(
    filters.q ||
    filters.category ||
    filters.retailer ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    filters.minDiscount !== null ||
    filters.inStock,
  );
}

/** A /search URL for these filters; defaults are left out so links stay short. */
export function searchHref(filters: SearchFilters, changes: Partial<SearchFilters> = {}): string {
  const f = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.category) params.set("category", f.category);
  if (f.retailer) params.set("retailer", f.retailer);
  if (f.minPrice !== null) params.set("min", formatPoundsInput(f.minPrice));
  if (f.maxPrice !== null) params.set("max", formatPoundsInput(f.maxPrice));
  if (f.minDiscount !== null) params.set("discount", String(f.minDiscount));
  if (f.inStock) params.set("stock", "1");
  if (f.sort !== (f.q ? "relevance" : "newest")) params.set("sort", f.sort);
  if (f.page > 1) params.set("page", String(f.page));
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}
