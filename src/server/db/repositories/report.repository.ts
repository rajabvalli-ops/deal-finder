import type { Prisma } from "@/generated/prisma/client";
import type { ReportReason } from "@/generated/prisma/enums";
import type { DbClient } from "../types";

export type ReportCreate = {
  target: "DEAL" | "COUPON";
  targetId: string;
  reason: ReportReason;
  note: string | null;
  userId: string | null;
  reporterKey: string;
};

const openInclude = {
  deal: { select: { id: true, slug: true, title: true, status: true } },
  coupon: {
    select: {
      id: true,
      code: true,
      title: true,
      isActive: true,
      retailer: { select: { name: true } },
    },
  },
} satisfies Prisma.ReportInclude;

export type OpenReportRow = Prisma.ReportGetPayload<{ include: typeof openInclude }>;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

export function createReportRepository(client: DbClient) {
  return {
    /** Stores a report; false if this reporter already reported this deal or voucher. */
    async create(data: ReportCreate, at: Date): Promise<boolean> {
      try {
        await client.report.create({
          data: {
            ...data,
            dealId: data.target === "DEAL" ? data.targetId : null,
            couponId: data.target === "COUPON" ? data.targetId : null,
            createdAt: at,
          },
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },

    /** Distinct reporters with an open report of one of `reasons` since `since`. */
    countOpen(targetId: string, reasons: ReportReason[], since: Date) {
      return client.report.count({
        where: { targetId, status: "OPEN", reason: { in: reasons }, createdAt: { gte: since } },
      });
    },

    countAllOpen() {
      return client.report.count({ where: { status: "OPEN" } });
    },

    listOpen(): Promise<OpenReportRow[]> {
      return client.report.findMany({
        where: { status: "OPEN" },
        include: openInclude,
        orderBy: { createdAt: "desc" },
        take: 500,
      });
    },

    /** Closes every open report on one deal or voucher. Returns how many. */
    async close(
      targetId: string,
      status: "RESOLVED" | "DISMISSED",
      by: string | null,
      at: Date,
    ): Promise<number> {
      const { count } = await client.report.updateMany({
        where: { targetId, status: "OPEN" },
        data: { status, resolvedAt: at, resolvedById: by },
      });
      return count;
    },
  };
}

export type ReportRepository = ReturnType<typeof createReportRepository>;
