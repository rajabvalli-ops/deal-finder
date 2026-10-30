import type { SearchOptions } from "@/lib/public-types";
import {
  DISCOUNT_OPTIONS,
  formatPoundsInput,
  SEARCH_SORT_LABELS,
  SEARCH_SORTS,
  type SearchFilters,
} from "@/lib/validation/search";

const box =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";
const field = `mt-1 ${box}`;
const label = "block text-sm font-medium";

/**
 * The search form: a plain GET form, so it works without JavaScript and every result page
 * has a shareable URL. Changing a filter starts again from page 1.
 */
export function SearchForm({
  filters,
  options,
}: {
  filters: SearchFilters;
  options: SearchOptions;
}) {
  return (
    <form action="/search" method="get" role="search" className="space-y-4">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="search-q">
          Search deals
        </label>
        <input
          id="search-q"
          type="search"
          name="q"
          defaultValue={filters.q}
          maxLength={100}
          placeholder="Search deals, e.g. noise cancelling headphones"
          className={box}
        />
        <button
          type="submit"
          className="rounded-md bg-brand-600 px-5 py-2 font-semibold text-white hover:bg-brand-700"
        >
          Search
        </button>
      </div>

      <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <legend className="sr-only">Filters</legend>
        <label className={`${label} col-span-2 sm:col-span-1`}>
          Category
          <select name="category" defaultValue={filters.category ?? ""} className={field}>
            <option value="">All categories</option>
            {options.categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {`${"  ".repeat(c.depth)}${c.name}`}
              </option>
            ))}
          </select>
        </label>
        <label className={`${label} col-span-2 sm:col-span-1`}>
          Retailer
          <select name="retailer" defaultValue={filters.retailer ?? ""} className={field}>
            <option value="">All retailers</option>
            {options.retailers.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Min price (£)
          <input
            name="min"
            inputMode="decimal"
            defaultValue={formatPoundsInput(filters.minPrice)}
            placeholder="0"
            className={field}
          />
        </label>
        <label className={label}>
          Max price (£)
          <input
            name="max"
            inputMode="decimal"
            defaultValue={formatPoundsInput(filters.maxPrice)}
            placeholder="Any"
            className={field}
          />
        </label>
        <label className={label}>
          Discount
          <select
            name="discount"
            defaultValue={filters.minDiscount === null ? "" : String(filters.minDiscount)}
            className={field}
          >
            <option value="">Any</option>
            {DISCOUNT_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}% or more
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Sort by
          <select name="sort" defaultValue={filters.sort} className={field}>
            {SEARCH_SORTS.map((s) => (
              <option key={s} value={s}>
                {SEARCH_SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex items-center gap-2 text-sm font-medium sm:col-span-3 lg:col-span-6">
          <input
            type="checkbox"
            name="stock"
            value="1"
            defaultChecked={filters.inStock}
            className="h-4 w-4"
          />
          In stock only
        </label>
      </fieldset>
    </form>
  );
}

/** A compact keyword box that hands off to the full search page. */
export function SearchBox() {
  return (
    <form action="/search" method="get" role="search" className="flex max-w-xl gap-2">
      <label className="sr-only" htmlFor="home-search">
        Search deals
      </label>
      <input
        id="home-search"
        type="search"
        name="q"
        maxLength={100}
        placeholder="What are you looking for?"
        className={box}
      />
      <button
        type="submit"
        className="rounded-md bg-brand-600 px-5 py-2 font-semibold text-white hover:bg-brand-700"
      >
        Search
      </button>
    </form>
  );
}
