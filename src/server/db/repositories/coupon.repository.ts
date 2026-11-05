import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "../types";

export type CouponCreate = {
  retailerId: string;
  dealId: string | null;
  code: string | null;
  title: string;
  description: string | null;
  terms: string | null;
  validUntil: Date | null;
};

const publicInclude = {
  retailer: { select: { slug: true, name: true } },
  deal: {
    select: {
      slug: true,
      status: true,
      product: { select: { isActive: true } },
      retailer: { select: { status: true } },
    },
  },
} satisfies Prisma.CouponInclude;

export type PublicCouponRow = Prisma.CouponGetPayload<{ include: typeof publicInclude }>;

/** Live vouchers: switched on, started, not ended, at an active retailer. */
function liveWhere(now: Date): Prisma.CouponWhereInput {
  return {
    isActive: true,
    retailer: { status: "ACTIVE" },
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
    ],
  };
}

export function createCouponRepository(client: DbClient) {
  return {
    create(data: CouponCreate) {
      return client.coupon.create({ data });
    },

    findById(id: string) {
      return client.coupon.findUnique({ where: { id } });
    },

    setActive(id: string, isActive: boolean) {
      return client.coupon.update({ where: { id }, data: { isActive } });
    },

    delete(id: string) {
      return client.coupon.delete({ where: { id } });
    },

    listForAdmin() {
      return client.coupon.findMany({
        include: {
          retailer: { select: { name: true } },
          deal: { select: { id: true, slug: true, title: true } },
          _count: { select: { reports: { where: { status: "OPEN" } } } },
        },
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        take: 300,
      });
    },

    listLive(now: Date, filter: { dealId?: string } = {}): Promise<PublicCouponRow[]> {
      return client.coupon.findMany({
        where: { ...liveWhere(now), ...(filter.dealId ? { dealId: filter.dealId } : {}) },
        include: publicInclude,
        orderBy: [{ validUntil: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        take: 200,
      });
    },

    findLive(id: string, now: Date) {
      return client.coupon.findFirst({ where: { id, ...liveWhere(now) }, select: { id: true } });
    },
  };
}

export type CouponRepository = ReturnType<typeof createCouponRepository>;
