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
      excludeId?: string;
      sort: keyof typeof ORDER;
      skip: number;
      take: number;
    }) {
      const where: Prisma.DealWhereInput = {
        ...PUBLIC_DEAL_WHERE,
        ...(filter.featuredOnly ? { isFeatured: true } : {}),
        ...(filter.retailerId ? { retailerId: filter.retailerId } : {}),
        ...(filter.excludeId ? { id: { not: filter.excludeId } } : {}),
        ...(filter.categoryIds
          ? { product: { ...PUBLIC_DEAL_WHERE.product, categoryId: { in: filter.categoryIds } } }
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
