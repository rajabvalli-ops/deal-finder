import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "../types";

// Read-only queries for the public website. Everything here is limited to PUBLISHED deals
// on active listings at active retailers.

export const PUBLIC_DEAL_WHERE = {
  status: "PUBLISHED",
  product: { isActive: true },
  retailer: { status: "ACTIVE" },
} satisfies Prisma.DealWhereInput;

export const publicDealInclude = {
  retailer: { select: { slug: true, name: true } },
  _count: { select: { comments: { where: { status: "VISIBLE" } } } },
  /** Switched-on codes for this deal that take something off ("£12.99 with code"). */
  coupons: {
    where: {
      isActive: true,
      code: { not: null },
      OR: [{ discountPence: { not: null } }, { discountBps: { not: null } }],
    },
    select: {
      code: true,
      discountPence: true,
      discountBps: true,
      minSpendPence: true,
      validFrom: true,
      validUntil: true,
    },
  },
  product: {
    select: {
      brand: true,
      model: true,
      title: true,
      description: true,
      rating: true,
      reviewCount: true,
      availability: true,
      priceUpdatedAt: true,
      category: { select: { id: true, slug: true, name: true } },
    },
  },
} satisfies Prisma.DealInclude;

export type PublicDealRow = Prisma.DealGetPayload<{ include: typeof publicDealInclude }>;

const ORDER: Record<string, Prisma.DealOrderByWithRelationInput[]> = {
  newest: [{ publishedAt: "desc" }, { id: "desc" }],
  hot: [{ hotRank: { sort: "desc", nulls: "last" } }, { id: "desc" }],
  discount: [{ discountBps: "desc" }, { publishedAt: "desc" }],
  saving: [{ savingAmount: "desc" }, { publishedAt: "desc" }],
  top: [{ score: "desc" }, { publishedAt: "desc" }],
};

export function createPublicRepository(client: DbClient) {
  return {
    async listDeals(filter: {
      categoryIds?: string[];
      retailerId?: string;
      featuredOnly?: boolean;
      bigDropsOnly?: boolean;
      excludeId?: string;
      /** Deals in any of these categories or from any of these retailers. */
      interests?: { categoryIds: string[]; retailerIds: string[] };
      sort: keyof typeof ORDER;
      skip: number;
      take: number;
    }) {
      const where: Prisma.DealWhereInput = {
        ...PUBLIC_DEAL_WHERE,
        ...(filter.featuredOnly ? { isFeatured: true } : {}),
        ...(filter.bigDropsOnly ? { level: { in: ["BIG_DROP", "PRICE_ERROR"] } } : {}),
        ...(filter.retailerId ? { retailerId: filter.retailerId } : {}),
        ...(filter.excludeId ? { id: { not: filter.excludeId } } : {}),
        ...(filter.categoryIds
          ? { product: { ...PUBLIC_DEAL_WHERE.product, categoryId: { in: filter.categoryIds } } }
          : {}),
        ...(filter.interests
          ? {
              OR: [
                { product: { categoryId: { in: filter.interests.categoryIds } } },
                { retailerId: { in: filter.interests.retailerIds } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        client.deal.findMany({
          where,
          include: publicDealInclude,
          orderBy: ORDER[filter.sort],
          skip: filter.skip,
          take: filter.take,
        }),
        client.deal.count({ where }),
      ]);
      return { items, total };
    },

    /**
     * What a user has shown interest in: categories and retailers of their alerts, and the
     * categories of deals they voted hot, commented on or clicked through to (last 90 days).
     */
    async interests(userId: string, since: Date) {
      const [alerts, votes, comments, clicks] = await Promise.all([
        client.alert.findMany({
          where: { userId, isActive: true },
          select: { categoryId: true, retailerId: true, product: { select: { categoryId: true } } },
        }),
        client.dealVote.findMany({
          where: { userId, value: 1, createdAt: { gte: since } },
          select: { deal: { select: { product: { select: { categoryId: true } } } } },
          take: 200,
        }),
        client.comment.findMany({
          where: { userId, createdAt: { gte: since } },
          select: { deal: { select: { product: { select: { categoryId: true } } } } },
          take: 200,
        }),
        client.click.findMany({
          where: { userId, createdAt: { gte: since } },
          select: { product: { select: { categoryId: true } } },
          take: 200,
        }),
      ]);
      const categoryIds = new Set<string>();
      const retailerIds = new Set<string>();
      const addCategory = (id: string | null | undefined) => {
        if (id) categoryIds.add(id);
      };
      for (const a of alerts) {
        addCategory(a.categoryId);
        addCategory(a.product?.categoryId);
        if (a.retailerId) retailerIds.add(a.retailerId);
      }
      for (const v of [...votes, ...comments]) addCategory(v.deal.product.categoryId);
      for (const c of clicks) addCategory(c.product?.categoryId);
      return { categoryIds: [...categoryIds], retailerIds: [...retailerIds] };
    },

    async liveStats(): Promise<{ count: number; lastCheckedAt: Date | null }> {
      const [count, products] = await Promise.all([
        client.deal.count({ where: PUBLIC_DEAL_WHERE }),
        client.product.aggregate({
          where: {
            ...PUBLIC_DEAL_WHERE.product,
            retailer: PUBLIC_DEAL_WHERE.retailer,
            deals: { some: { status: "PUBLISHED" } },
          },
          _max: { priceUpdatedAt: true },
        }),
      ]);
      return { count, lastCheckedAt: products._max.priceUpdatedAt };
    },

    findDealBySlug(slug: string) {
      return client.deal.findFirst({
        where: { ...PUBLIC_DEAL_WHERE, slug },
        include: publicDealInclude,
      });
    },

    findCategoryBySlug(slug: string) {
      return client.category.findUnique({
        where: { slug },
        include: {
          parent: { select: { slug: true, name: true } },
          children: {
            select: { id: true, slug: true, name: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          },
        },
      });
    },

    findRetailerBySlug(slug: string) {
      return client.retailer.findFirst({
        where: { slug, status: { not: "DISABLED" } },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          websiteUrl: true,
          status: true,
        },
      });
    },

    categoriesWithDealCounts() {
      return client.category.findMany({
        select: {
          id: true,
          slug: true,
          name: true,
          parentId: true,
          sortOrder: true,
          _count: {
            select: {
              products: { where: { isActive: true, deals: { some: { status: "PUBLISHED" } } } },
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
    },

    retailersWithDealCounts() {
      return client.retailer.findMany({
        where: { status: "ACTIVE" },
        select: {
          slug: true,
          name: true,
          _count: { select: { deals: { where: PUBLIC_DEAL_WHERE } } },
        },
        orderBy: { name: "asc" },
      });
    },
  };
}
