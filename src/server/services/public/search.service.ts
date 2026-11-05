import "server-only";
import { toPage, type Page } from "@/lib/pagination";
import type { PublicDealSummary, SearchOptions } from "@/lib/public-types";
import type { SearchFilters } from "@/lib/validation/search";
import { createPublicRepository } from "@/server/db/repositories/public.repository";
import { createSearchRepository } from "@/server/db/repositories/search.repository";
import type { DbClient } from "@/server/db/types";
import { toSummary } from "./public-catalogue.service";

export const SEARCH_PAGE_SIZE = 24;

export type SearchResult = {
  /** The filters actually applied: unknown categories and retailers are dropped. */
  filters: SearchFilters;
  results: Page<PublicDealSummary>;
};

/** Search over public deals. Read-only; see docs/ARCHITECTURE.md §5 (search). */
export function createSearchService(client: DbClient, options: { pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? SEARCH_PAGE_SIZE;
  const publicRepo = createPublicRepository(client);
  const searchRepo = createSearchRepository(client);

  return {
    async search(requested: SearchFilters): Promise<SearchResult> {
      const [category, retailer] = await Promise.all([
        requested.category ? publicRepo.findCategoryBySlug(requested.category) : null,
        requested.retailer ? publicRepo.findRetailerBySlug(requested.retailer) : null,
      ]);
      const activeRetailer = retailer?.status === "ACTIVE" ? retailer : null;
      const filters: SearchFilters = {
        ...requested,
        category: category ? category.slug : null,
        retailer: activeRetailer ? activeRetailer.slug : null,
      };
      const request = {
        page: filters.page,
        skip: (filters.page - 1) * pageSize,
        take: pageSize,
      };
      const { items, total } = await searchRepo.searchDeals({
        q: filters.q,
        // A category includes its subcategories, as on category pages.
        categoryIds: category ? [category.id, ...category.children.map((c) => c.id)] : undefined,
        retailerId: activeRetailer?.id,
        minPrice: filters.minPrice ?? undefined,
        maxPrice: filters.maxPrice ?? undefined,
        minDiscountBps: filters.minDiscount === null ? undefined : filters.minDiscount * 100,
        inStock: filters.inStock,
        sort: filters.sort,
        skip: request.skip,
        take: request.take,
      });
      return { filters, results: toPage(items.map(toSummary), total, request) };
    },

    /** Choices for the category and retailer filters. */
    async options(): Promise<SearchOptions> {
      const [categories, retailers] = await Promise.all([
        publicRepo.categoriesWithDealCounts(),
        publicRepo.retailersWithDealCounts(),
      ]);
      const children = new Map<string | null, typeof categories>();
      for (const c of categories) {
        children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
      }
      // Parents first, each followed by its subcategories (already in display order).
      const ordered: SearchOptions["categories"] = [];
      const visit = (parentId: string | null, depth: number) => {
        for (const c of children.get(parentId) ?? []) {
          ordered.push({ slug: c.slug, name: c.name, depth });
          visit(c.id, depth + 1);
        }
      };
      visit(null, 0);
      return {
        categories: ordered,
        retailers: retailers
          .filter((r) => r._count.deals > 0)
          .map((r) => ({ slug: r.slug, name: r.name })),
      };
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
