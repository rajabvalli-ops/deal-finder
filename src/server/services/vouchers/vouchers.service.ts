import "server-only";
import type { VoucherInput } from "@/lib/validation/vouchers";
import { hasRole } from "@/server/auth/roles";
import { createAuditLogRepository } from "@/server/db/repositories/audit-log.repository";
import {
  createCouponRepository,
  type PublicCouponRow,
} from "@/server/db/repositories/coupon.repository";
import { createReportRepository } from "@/server/db/repositories/report.repository";
import { inTransaction } from "@/server/db/transaction";
import type { DbClient } from "@/server/db/types";
import { fail, ok, type Actor, type AdminResult } from "@/server/services/admin/result";

/** A voucher as the public site shows it. */
export type VoucherView = {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  terms: string | null;
  validUntil: Date | null;
  retailer: { slug: string; name: string };
  /** The deal it belongs to, while that deal is live. */
  dealSlug: string | null;
};

function toView(row: PublicCouponRow): VoucherView {
  const deal = row.deal;
  const live =
    deal?.status === "PUBLISHED" && deal.product.isActive && deal.retailer.status === "ACTIVE";
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    terms: row.terms,
    validUntil: row.validUntil,
    retailer: row.retailer,
    dealSlug: live ? deal.slug : null,
  };
}

export function createVouchersService(client: DbClient) {
  const coupons = createCouponRepository(client);

  return {
    /** Live vouchers, ending soonest first. */
    async listLive(now: Date): Promise<VoucherView[]> {
      return (await coupons.listLive(now)).map(toView);
    },

    async forDeal(dealId: string, now: Date): Promise<VoucherView[]> {
      return (await coupons.listLive(now, { dealId })).map(toView);
    },

    listForAdmin() {
      return coupons.listForAdmin();
    },

    /** Adds a voucher. EDITOR+; a linked deal must be at the same retailer. Audited. */
    create(params: { actor: Actor; input: VoucherInput; now: Date }): Promise<AdminResult> {
      const { actor, input, now } = params;
      if (!hasRole(actor.role, "EDITOR")) return Promise.resolve(fail("FORBIDDEN"));
      return inTransaction(client, async (tx) => {
        const retailer = await tx.retailer.findUnique({ where: { id: input.retailerId } });
        if (!retailer) return fail("NOT_FOUND");
        let dealId: string | null = null;
        if (input.deal) {
          const deal = await tx.deal.findUnique({ where: { slug: input.deal } });
          if (!deal || deal.retailerId !== retailer.id) return fail("WRONG_DEAL");
          dealId = deal.id;
        }
        const created = await createCouponRepository(tx).create({
          retailerId: retailer.id,
          dealId,
          code: input.code,
          title: input.title,
          description: input.description,
          terms: input.terms,
          validUntil: input.validUntil,
        });
        await createAuditLogRepository(tx).record({
          actorId: actor.id,
          action: "coupon.create",
          entityType: "Coupon",
          entityId: created.id,
          diff: { code: input.code, title: input.title, retailer: retailer.slug },
          createdAt: now,
        });
        return ok(undefined);
      });
    },

    /** Switch a voucher off or on, or delete it. Closes its open reports. EDITOR+; audited. */
    change(params: {
      actor: Actor;
      couponId: string;
      action: "deactivate" | "activate" | "delete";
      now: Date;
    }): Promise<AdminResult> {
      const { actor, couponId, action, now } = params;
      if (!hasRole(actor.role, "EDITOR")) return Promise.resolve(fail("FORBIDDEN"));
      return inTransaction(client, async (tx) => {
        const repo = createCouponRepository(tx);
        const coupon = await repo.findById(couponId);
        if (!coupon) return fail("NOT_FOUND");
        await createAuditLogRepository(tx).record({
          actorId: actor.id,
          action: `coupon.${action}`,
          entityType: "Coupon",
          entityId: coupon.id,
          diff: { code: coupon.code, title: coupon.title },
          createdAt: now,
        });
        if (action === "delete") {
          await repo.delete(coupon.id);
          return ok(undefined);
        }
        await repo.setActive(coupon.id, action === "activate");
        if (action === "deactivate") {
          await createReportRepository(tx).close(coupon.id, "RESOLVED", actor.id, now);
        }
        return ok(undefined);
      });
    },
  };
}

export type VouchersService = ReturnType<typeof createVouchersService>;
