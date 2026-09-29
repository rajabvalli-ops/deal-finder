import type { Prisma } from "@/generated/prisma/client";
import type { DealStatus, Role } from "@/generated/prisma/enums";
import type { DbClient } from "../types";

// Read-side queries for the admin dashboard: paginated lists, detail views and counts.

type Paging = { skip: number; take: number };
const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

export function createAdminRepository(client: DbClient) {
  return {
    async listDeals(filter: { statuses?: DealStatus[]; q?: string } & Paging) {
      const where: Prisma.DealWhereInput = {
        ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
        ...(filter.q
          ? { OR: [{ title: contains(filter.q) }, { product: { brand: contains(filter.q) } }] }
          : {}),
      };
      const [items, total] = await Promise.all([
        client.deal.findMany({
          where,
          include: { retailer: { select: { name: true } } },
          orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
          skip: filter.skip,
          take: filter.take,
        }),
        client.deal.count({ where }),
      ]);
      return { items, total };
    },

    findDeal(id: string) {
      return client.deal.findUnique({
        where: { id },
        include: {
          product: { include: { category: true, retailer: true } },
          variant: true,
          reviewedBy: { select: { email: true } },
        },
      });
    },

    async listProducts(filter: { q?: string; isActive?: boolean } & Paging) {
      const where: Prisma.ProductWhereInput = {
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...(filter.q
          ? {
              OR: [
                { title: contains(filter.q) },
                { brand: contains(filter.q) },
                { externalId: contains(filter.q) },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        client.product.findMany({
          where,
          include: { retailer: { select: { name: true } }, category: { select: { name: true } } },
          orderBy: [{ title: "asc" }, { id: "asc" }],
          skip: filter.skip,
          take: filter.take,
        }),
        client.product.count({ where }),
      ]);
      return { items, total };
    },

    findProduct(id: string) {
      return client.product.findUnique({
        where: { id },
        include: {
          retailer: true,
          category: true,
          variants: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] },
          deals: { orderBy: { detectedAt: "desc" }, take: 20 },
        },
      });
    },

    listRetailers() {
      return client.retailer.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { products: true, deals: true } } },
      });
    },

    listCategories() {
      return client.category.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { products: true } } },
      });
    },

    async listUsers(filter: { q?: string; role?: Role } & Paging) {
      const where: Prisma.UserWhereInput = {
        ...(filter.role ? { role: filter.role } : {}),
        ...(filter.q ? { OR: [{ email: contains(filter.q) }, { name: contains(filter.q) }] } : {}),
      };
      const [items, total] = await Promise.all([
        client.user.findMany({
          where,
          select: { id: true, email: true, name: true, role: true, createdAt: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: filter.skip,
          take: filter.take,
        }),
        client.user.count({ where }),
      ]);
      return { items, total };
    },

    async listAlerts(paging: Paging) {
      const [items, total] = await Promise.all([
        client.alert.findMany({
          include: {
            user: { select: { email: true } },
            product: { select: { title: true } },
            category: { select: { name: true } },
            retailer: { select: { name: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          ...paging,
        }),
        client.alert.count(),
      ]);
      return { items, total };
    },

    async listClicks(paging: Paging) {
      const [items, total] = await Promise.all([
        client.click.findMany({
          include: {
            deal: { select: { title: true } },
            affiliateLink: { select: { retailer: { select: { name: true } } } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          ...paging,
        }),
        client.click.count(),
      ]);
      return { items, total };
    },

    async overview(since: Date) {
      const [
        dealsByStatus,
        activeProducts,
        activeRetailers,
        users,
        activeAlerts,
        recentClicks,
        recentRuns,
        recentAudit,
      ] = await Promise.all([
        client.deal.groupBy({ by: ["status"], _count: { _all: true } }),
        client.product.count({ where: { isActive: true } }),
        client.retailer.count({ where: { status: "ACTIVE" } }),
        client.user.count(),
        client.alert.count({ where: { isActive: true } }),
        client.click.count({ where: { createdAt: { gte: since }, isBot: false } }),
        client.importRun.findMany({
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: 8,
          include: { retailer: { select: { name: true } } },
        }),
        client.auditLog.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 10,
          include: { actor: { select: { email: true } } },
        }),
      ]);
      return {
        dealsByStatus,
        activeProducts,
        activeRetailers,
        users,
        activeAlerts,
        recentClicks,
        recentRuns,
        recentAudit,
      };
    },

    auditTrail(entityType: string, entityId: string) {
      return client.auditLog.findMany({
        where: { entityType, entityId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { actor: { select: { email: true } } },
      });
    },
  };
}

export type AdminRepository = ReturnType<typeof createAdminRepository>;
