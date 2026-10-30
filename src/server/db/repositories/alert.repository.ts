import { Prisma } from "@/generated/prisma/client";
import type { DealLevel, ReferenceType } from "@/lib/public-types";
import type { DbClient } from "../types";
import { PUBLIC_DEAL_WHERE } from "./public.repository";
import { PRODUCT_DOCUMENT } from "./search.repository";

export type AlertCreate = {
  userId: string;
  keyword: string | null;
  productId: string | null;
  categoryId: string | null;
  retailerId: string | null;
  maxPrice: number | null;
  minDiscountBps: number | null;
  minLevel: DealLevel | null;
};

export const alertListInclude = {
  product: { select: { title: true } },
  category: { select: { name: true } },
  retailer: { select: { name: true } },
} satisfies Prisma.AlertInclude;

export type AlertRow = Prisma.AlertGetPayload<{ include: typeof alertListInclude }>;

export type AlertMatch = {
  alertId: string;
  userId: string;
  dealId: string;
  dealSlug: string;
  title: string;
  dealPrice: number;
  discountBps: number;
  referenceType: ReferenceType;
  level: DealLevel;
  retailerName: string;
};

export function createAlertRepository(client: DbClient) {
  return {
    create(data: AlertCreate) {
      return client.alert.create({ data });
    },

    countForUser(userId: string) {
      return client.alert.count({ where: { userId } });
    },

    listForUser(userId: string): Promise<AlertRow[]> {
      return client.alert.findMany({
        where: { userId },
        include: alertListInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    },

    /** Updates only the owner's alert; false if it doesn't exist or isn't theirs. */
    async setActive(userId: string, alertId: string, isActive: boolean): Promise<boolean> {
      const { count } = await client.alert.updateMany({
        where: { id: alertId, userId },
        data: { isActive },
      });
      return count === 1;
    },

    async deleteOwned(userId: string, alertId: string): Promise<boolean> {
      const { count } = await client.alert.deleteMany({ where: { id: alertId, userId } });
      return count === 1;
    },

    /** The product behind a public deal, for "alert me about this product". */
    findPublicDealProduct(slug: string) {
      return client.deal.findFirst({
        where: { slug, ...PUBLIC_DEAL_WHERE },
        select: { productId: true, dealPrice: true, product: { select: { title: true } } },
      });
    },

    /** False when the keyword has no searchable words (e.g. only "the"), so could never match. */
    async isSearchableKeyword(keyword: string): Promise<boolean> {
      const [row] = await client.$queryRaw<{ ok: boolean }[]>`
        SELECT numnode(plainto_tsquery('english', ${keyword})) > 0 AS "ok"`;
      return row?.ok ?? false;
    },

    /**
     * Pairs of active alerts and public deals that satisfy them and haven't been notified yet.
     * A deal's news is its publication, or a later rise in level (a deeper drop that became a
     * big drop or possible price error); it only matches alerts that existed by then, so a new
     * alert doesn't fire for deals already on the site. Each (alert, deal, level) notifies
     * once. Categories include their subcategories.
     */
    findMatches(params: { since: Date; dealIds?: string[]; limit: number }): Promise<AlertMatch[]> {
      const onlyDeals = params.dealIds
        ? Prisma.sql`AND d."id" = ANY(${params.dealIds})`
        : Prisma.empty;
      return client.$queryRaw<AlertMatch[]>`
        WITH RECURSIVE tree("rootId", "id") AS (
          SELECT c."id", c."id" FROM "Category" c
          UNION ALL
          SELECT t."rootId", c."id" FROM "Category" c JOIN tree t ON c."parentId" = t."id"
        )
        SELECT a."id" AS "alertId", a."userId", d."id" AS "dealId", d."slug" AS "dealSlug",
               d."title", d."dealPrice",
               d."discountBps", d."referenceType"::text AS "referenceType",
               d."level"::text AS "level", r."name" AS "retailerName"
        FROM "Alert" a
        JOIN "Deal" d ON d."status" = 'PUBLISHED'
          AND (d."publishedAt" >= ${params.since} OR d."levelRaisedAt" >= ${params.since})
          AND GREATEST(d."publishedAt", d."levelRaisedAt") >= a."createdAt"
        JOIN "Product" p ON p."id" = d."productId" AND p."isActive"
        JOIN "Retailer" r ON r."id" = d."retailerId" AND r."status" = 'ACTIVE'
        WHERE a."isActive"
          ${onlyDeals}
          AND (a."productId" IS NULL OR a."productId" = d."productId")
          AND (a."retailerId" IS NULL OR a."retailerId" = d."retailerId")
          AND (a."categoryId" IS NULL OR EXISTS (
            SELECT 1 FROM tree t WHERE t."rootId" = a."categoryId" AND t."id" = p."categoryId"))
          AND (a."maxPrice" IS NULL OR d."dealPrice" <= a."maxPrice")
          AND (a."minDiscountBps" IS NULL OR d."discountBps" >= a."minDiscountBps")
          AND (a."minLevel" IS NULL OR d."level" >= a."minLevel")
          AND (a."keyword" IS NULL OR (
            numnode(plainto_tsquery('english', a."keyword")) > 0
            AND ${PRODUCT_DOCUMENT} @@ plainto_tsquery('english', a."keyword")))
          AND NOT EXISTS (
            SELECT 1 FROM "Notification" n
            WHERE n."dedupeKey" = a."id" || ':' || d."id" || ':' || d."level"::text)
        ORDER BY d."publishedAt", a."id"
        LIMIT ${params.limit}`;
    },

    markTriggered(alertIds: string[], at: Date) {
      return client.alert.updateMany({
        where: { id: { in: alertIds } },
        data: { lastTriggeredAt: at },
      });
    },
  };
}

export type AlertRepository = ReturnType<typeof createAlertRepository>;
