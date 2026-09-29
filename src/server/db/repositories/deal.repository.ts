import type { Prisma } from "@/generated/prisma/client";
import type { DealStatus } from "@/generated/prisma/enums";
import type { DbClient } from "../types";

/** The numbers a deal snapshots at detection (mirrors the deal engine's DealCandidate). */
export type DealSnapshot = {
  dealPrice: number;
  referencePrice: number;
  referenceType: "PREVIOUS" | "AVG_30" | "AVG_90";
  savingAmount: number;
  discountBps: number;
  historicalLow: number | null;
  avg30Price: number | null;
  avg90Price: number | null;
  score: number;
  scoreBreakdown: unknown;
  engineVersion: string;
};

export type NewDeal = DealSnapshot & {
  slug: string;
  productId: string;
  variantId: string;
  retailerId: string;
  status: DealStatus;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  detectedAt: Date;
};

const toJson = (value: unknown) => value as Prisma.InputJsonValue;

const withRelations = {
  product: { include: { category: true } },
  retailer: true,
} satisfies Prisma.DealInclude;

export function createDealRepository(client: DbClient) {
  return {
    create(deal: NewDeal) {
      return client.deal.create({
        data: { ...deal, scoreBreakdown: toJson(deal.scoreBreakdown) },
      });
    },

    findById(id: string) {
      return client.deal.findUnique({ where: { id } });
    },

    findActiveForVariant(variantId: string, activeStatuses: readonly DealStatus[]) {
      return client.deal.findFirst({ where: { variantId, status: { in: [...activeStatuses] } } });
    },

    listByStatus(statuses: readonly DealStatus[]) {
      return client.deal.findMany({
        where: { status: { in: [...statuses] } },
        include: withRelations,
        orderBy: { detectedAt: "asc" },
      });
    },

    updateContent(
      id: string,
      data: {
        title: string;
        summary: string | null;
        description: string | null;
        isFeatured: boolean;
        expiresAt: Date | null;
      },
    ) {
      return client.deal.update({ where: { id }, data });
    },

    updateSnapshot(id: string, snapshot: DealSnapshot, summary: string | null) {
      return client.deal.update({
        where: { id },
        data: { ...snapshot, scoreBreakdown: toJson(snapshot.scoreBreakdown), summary },
      });
    },

    /**
     * Moves a deal from `from` to `to` only if it is still in `from` (optimistic concurrency).
     * Returns false if someone else changed it first.
     */
    async transition(
      id: string,
      from: DealStatus,
      to: DealStatus,
      timestamps: Partial<Record<"reviewedAt" | "publishedAt" | "expiredAt", Date>> = {},
      review: { reviewedById?: string; rejectionReason?: string | null } = {},
    ): Promise<boolean> {
      const { count } = await client.deal.updateMany({
        where: { id, status: from },
        data: { status: to, ...timestamps, ...review },
      });
      return count === 1;
    },
  };
}

export type DealRepository = ReturnType<typeof createDealRepository>;
