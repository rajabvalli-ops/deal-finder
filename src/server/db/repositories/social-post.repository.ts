import type { Prisma } from "@/generated/prisma/client";
import type { DealLevel } from "@/generated/prisma/enums";
import type { DbClient } from "../types";
import { PUBLIC_DEAL_WHERE } from "./public.repository";

const dealForPost = {
  id: true,
  slug: true,
  title: true,
  dealPrice: true,
  referencePrice: true,
  referenceType: true,
  discountBps: true,
  level: true,
  status: true,
  product: {
    select: {
      isActive: true,
      // The product's outbound affiliate link (for "link straight to the retailer").
      affiliateLinks: {
        where: { dealId: null, isActive: true },
        select: { destinationUrl: true },
        take: 1,
      },
    },
  },
  retailer: { select: { name: true, status: true } },
} as const;

export type DealForPost = Prisma.DealGetPayload<{ select: typeof dealForPost }>;

export function createSocialPostRepository(client: DbClient) {
  return {
    /** Public deals at one of `levels` that became news (published or levelled up) since `since`. */
    listNewsworthyDeals(levels: DealLevel[], since: Date) {
      return client.deal.findMany({
        where: {
          ...PUBLIC_DEAL_WHERE,
          level: { in: levels },
          OR: [{ publishedAt: { gte: since } }, { levelRaisedAt: { gte: since } }],
        },
        select: { id: true, level: true },
        orderBy: { publishedAt: "asc" },
      });
    },

    /** Queues posts, ignoring (deal, level) pairs already queued or posted. Returns how many were new. */
    async queue(
      network: string,
      posts: { dealId: string; level: DealLevel }[],
      at: Date,
    ): Promise<number> {
      if (posts.length === 0) return 0;
      const { count } = await client.socialPost.createMany({
        data: posts.map((p) => ({
          network,
          dealId: p.dealId,
          level: p.level,
          text: "",
          createdAt: at,
        })),
        skipDuplicates: true,
      });
      return count;
    },

    countPostedSince(network: string, since: Date) {
      return client.socialPost.count({
        where: { network, status: "POSTED", postedAt: { gte: since } },
      });
    },

    /** Pending posts, most striking first (price errors before big drops), oldest first. */
    /** Pending posts queued at or before `readyBy` (plus any for `alwaysDealId`). */
    listPending(network: string, take: number, readyBy: Date, alwaysDealId?: string) {
      return client.socialPost.findMany({
        where: {
          network,
          status: "PENDING",
          OR: [
            { createdAt: { lte: readyBy } },
            ...(alwaysDealId ? [{ dealId: alwaysDealId }] : []),
          ],
        },
        orderBy: [{ level: "desc" }, { createdAt: "asc" }],
        take,
        include: { deal: { select: dealForPost } },
      });
    },

    findDeal(dealId: string): Promise<DealForPost | null> {
      return client.deal.findUnique({ where: { id: dealId }, select: dealForPost });
    },

    listForDeal(dealId: string) {
      return client.socialPost.findMany({ where: { dealId }, orderBy: { createdAt: "desc" } });
    },

    markPosted(id: string, data: { text: string; externalId: string | null; at: Date }) {
      return client.socialPost.update({
        where: { id },
        data: {
          status: "POSTED",
          text: data.text,
          externalId: data.externalId,
          postedAt: data.at,
          attempts: { increment: 1 },
        },
      });
    },

    markSkipped(id: string, reason: string) {
      return client.socialPost.update({
        where: { id },
        data: { status: "SKIPPED", lastError: reason },
      });
    },

    markFailedAttempt(id: string, data: { text: string; error: string; giveUp: boolean }) {
      return client.socialPost.update({
        where: { id },
        data: {
          text: data.text,
          lastError: data.error.slice(0, 500),
          attempts: { increment: 1 },
          ...(data.giveUp ? { status: "FAILED" as const } : {}),
        },
      });
    },
  };
}

export type SocialPostRepository = ReturnType<typeof createSocialPostRepository>;
