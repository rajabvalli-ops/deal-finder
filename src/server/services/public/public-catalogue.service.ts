import "server-only";
import { toPage, type Page, type PageRequest } from "@/lib/pagination";
import {
  isNearHistoricalLow,
  type DealSort,
  type PublicCategory,
  type PublicDealDetail,
  type PublicDealSummary,
  type PublicRetailer,
} from "@/lib/public-types";
import { createAffiliateRepository } from "@/server/db/repositories/affiliate.repository";
import { createPriceHistoryRepository } from "@/server/db/repositories/price-history.repository";
import {
  createPublicRepository,
  type PublicDealRow,
} from "@/server/db/repositories/public.repository";
import type { DbClient } from "@/server/db/types";
import { bestPriceWithCode } from "@/lib/voucher-price";
import { isEarlyAccess } from "@/lib/early-access";
import { computePriceStats } from "@/server/pricing";
import { shareSettingsFromEnv } from "@/server/social/config";

const DAY_MS = 86_400_000;
const CHART_DAYS = 180;

/** Codes that have started and not ended at `now`. */
function liveCoupons(row: PublicDealRow, now: Date) {
  return row.coupons.filter(
    (c) =>
      (c.validFrom === null || c.validFrom <= now) && (c.validUntil === null || c.validUntil > now),
  );
}

/**
 * Cached pages render this, so "live" vouchers and early access are as of the last render
 * (minutes). `linkCodes` maps product ids to their outbound link codes.
 */
export function toSummary(
  row: PublicDealRow,
  linkCodes: ReadonlyMap<string, string>,
): PublicDealSummary {
  const now = new Date();
  const category = row.product.category;
  return {
    slug: row.slug,
    title: row.title,
    imageUrl: row.imageUrl,
    brand: row.product.brand,
    retailer: row.retailer,
    category: category ? { slug: category.slug, name: category.name } : null,
    dealPrice: row.dealPrice,
    referencePrice: row.referencePrice,
    referenceType: row.referenceType,
    savingAmount: row.savingAmount,
    discountBps: row.discountBps,
    historicalLow: row.historicalLow,
    level: row.level,
    withCode: bestPriceWithCode(row.dealPrice, liveCoupons(row, now)),
    voteScore: row.voteScore,
    priceCheckedAt: row.product.priceUpdatedAt,
    publishedAt: row.publishedAt,
    linkCode: linkCodes.get(row.productId) ?? null,
    commentCount: row._count.comments,
    earlyAccess: isEarlyAccess(row, shareSettingsFromEnv(process.env), now),
  };
}

/** Summaries for a list of rows, with their outbound link codes in one query. */
export async function summarise(
  client: DbClient,
  rows: PublicDealRow[],
): Promise<PublicDealSummary[]> {
  const codes = await createAffiliateRepository(client).activeProductLinkCodes([
    ...new Set(rows.map((r) => r.productId)),
  ]);
  return rows.map((row) => toSummary(row, codes));
}

export function createPublicCatalogueService(client: DbClient) {
  const repo = createPublicRepository(client);

  return {
    async listDeals(params: {
      sort: DealSort;
      page: PageRequest;
      categoryIds?: string[];
      retailerId?: string;
      /** Only big drops and possible price errors. */
      bigDropsOnly?: boolean;
    }): Promise<Page<PublicDealSummary>> {
      const { items, total } = await repo.listDeals({
        sort: params.sort,
        categoryIds: params.categoryIds,
        retailerId: params.retailerId,
        bigDropsOnly: params.bigDropsOnly,
        skip: params.page.skip,
        take: params.page.take,
      });
      return toPage(await summarise(client, items), total, params.page);
    },

    /** Everything the homepage shows, in one round of queries. */
    async homepage() {
      const [featured, hot, latest, recent, categories, retailers, live] = await Promise.all([
        repo.listDeals({ sort: "top", featuredOnly: true, skip: 0, take: 4 }),
        repo.listDeals({ sort: "hot", skip: 0, take: 12 }),
        repo.listDeals({ sort: "newest", skip: 0, take: 8 }),
        repo.listDeals({ sort: "newest", skip: 0, take: 60 }),
        this.popularCategories(8),
        this.popularRetailers(8),
        this.liveStats(),
      ]);
      const all = [...featured.items, ...hot.items, ...latest.items, ...recent.items];
      const codes = await createAffiliateRepository(client).activeProductLinkCodes([
        ...new Set(all.map((r) => r.productId)),
      ]);
      const summaries = (rows: PublicDealRow[]) => rows.map((row) => toSummary(row, codes));
      return {
        featured: summaries(featured.items),
        /** Hot deals people have voted up; empty until someone votes. */
        hot: summaries(hot.items)
          .filter((d) => d.voteScore > 0)
          .slice(0, 4),
        latest: summaries(latest.items),
        nearLows: summaries(recent.items).filter(isNearHistoricalLow).slice(0, 4),
        categories,
        retailers,
        live,
      };
    },

    /**
     * "For you": hot deals in the categories and from the retailers the user has shown
     * interest in. `personal` is false (and the list is just Hot) until there is any.
     */
    async forYou(
      userId: string,
      now: Date,
      take = 24,
    ): Promise<{ personal: boolean; deals: PublicDealSummary[] }> {
      const interests = await repo.interests(userId, new Date(now.getTime() - 90 * DAY_MS));
      const personal = interests.categoryIds.length > 0 || interests.retailerIds.length > 0;
      const { items } = await repo.listDeals({
        sort: "hot",
        ...(personal ? { interests } : {}),
        skip: 0,
        take,
      });
      return { personal, deals: await summarise(client, items) };
    },

    /** How many deals are live, and when a live deal's price was last checked. */
    liveStats(): Promise<{ count: number; lastCheckedAt: Date | null }> {
      return repo.liveStats();
    },

    /** Categories ordered by live deal count; top-level categories if nothing is published yet. */
    async popularCategories(limit: number): Promise<PublicCategory[]> {
      const rows = await repo.categoriesWithDealCounts();
      const withDeals = rows
        .map((c) => ({
          slug: c.slug,
          name: c.name,
          dealCount: c._count.products,
          parentId: c.parentId,
        }))
        .filter((c) => c.dealCount > 0)
        .sort((a, b) => b.dealCount - a.dealCount || a.name.localeCompare(b.name));
      const chosen =
        withDeals.length > 0
          ? withDeals
          : rows.filter((c) => c.parentId === null).map((c) => ({ ...c, dealCount: 0 }));
      return chosen.slice(0, limit).map(({ slug, name, dealCount }) => ({ slug, name, dealCount }));
    },

    async popularRetailers(limit: number): Promise<PublicRetailer[]> {
      const rows = await repo.retailersWithDealCounts();
      return rows
        .map((r) => ({ slug: r.slug, name: r.name, dealCount: r._count.deals }))
        .filter((r) => r.dealCount > 0)
        .sort((a, b) => b.dealCount - a.dealCount || a.name.localeCompare(b.name))
        .slice(0, limit);
    },

    async dealBySlug(slug: string, now: Date): Promise<PublicDealDetail | null> {
      const row = await repo.findDealBySlug(slug);
      if (!row) return null;
      const [observations, linkCodes] = await Promise.all([
        createPriceHistoryRepository(client).listForVariant(row.variantId, {
          since: new Date(now.getTime() - CHART_DAYS * DAY_MS),
        }),
        createAffiliateRepository(client).activeProductLinkCodes([row.productId]),
      ]);
      const stats = computePriceStats(observations, now);
      const purchasable = observations.filter(
        (o) => o.availability !== "OUT_OF_STOCK" && o.availability !== "DISCONTINUED",
      );
      return {
        ...toSummary(row, linkCodes),
        id: row.id,
        summary: row.summary,
        description: row.description,
        expiresAt: row.expiresAt,
        product: {
          title: row.product.title,
          model: row.product.model,
          description: row.product.description,
          rating: row.product.rating === null ? null : Number(row.product.rating),
          reviewCount: row.product.reviewCount,
          availability: row.product.availability,
        },
        history: purchasable.map((o) => ({ observedAt: o.observedAt, price: o.price })),
        stats: {
          current: stats.current,
          lowest: stats.lowest,
          highest: stats.highest,
          avg7: stats.avg7,
          avg30: stats.avg30,
          avg90: stats.avg90,
        },
      };
    },

    /** Other deals in the same category (or from the same retailer when uncategorised). */
    async relatedDeals(slug: string, limit = 4): Promise<PublicDealSummary[]> {
      const row = await repo.findDealBySlug(slug);
      if (!row) return [];
      const categoryId = row.product.category?.id;
      const { items } = await repo.listDeals({
        sort: "top",
        excludeId: row.id,
        ...(categoryId ? { categoryIds: [categoryId] } : { retailerId: row.retailerId }),
        skip: 0,
        take: limit,
      });
      return summarise(client, items);
    },

    async categoryBySlug(slug: string) {
      const category = await repo.findCategoryBySlug(slug);
      if (!category) return null;
      return {
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        parent: category.parent,
        children: category.children,
        /** Deals in this category include its subcategories. */
        categoryIds: [category.id, ...category.children.map((c) => c.id)],
      };
    },

    retailerBySlug(slug: string) {
      return repo.findRetailerBySlug(slug);
    },
  };
}

export type PublicCatalogueService = ReturnType<typeof createPublicCatalogueService>;
