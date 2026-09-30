import "server-only";
import { hasRole } from "@/server/auth/roles";
import { createAuditLogRepository } from "@/server/db/repositories/audit-log.repository";
import { createDealRepository } from "@/server/db/repositories/deal.repository";
import { inTransaction } from "@/server/db/transaction";
import type { DbClient } from "@/server/db/types";
import { isEditable, transition, type DealAction } from "@/server/deals/workflow";
import { fail, ok, type Actor, type AdminResult } from "./result";

export type EditorDealAction = Exclude<DealAction, "submit">;

export type DealContent = {
  title: string;
  summary: string | null;
  description: string | null;
  isFeatured: boolean;
  expiresAt: Date | null;
};

/** A JSON-safe, comparable form of a content value (dates as ISO strings). */
function comparable(value: DealContent[keyof DealContent]): string | boolean | null {
  return value instanceof Date ? value.toISOString() : value;
}

export function createAdminDealsService(client: DbClient) {
  return {
    /** Approve, reject, publish, expire or remove a deal as an editor. */
    applyAction(params: {
      actor: Actor;
      dealId: string;
      action: EditorDealAction;
      reason?: string | null;
      now: Date;
    }): Promise<AdminResult<{ status: string }>> {
      const { actor, dealId, action, now } = params;
      if (!hasRole(actor.role, "EDITOR")) return Promise.resolve(fail("FORBIDDEN"));
      const reason = params.reason?.trim() || null;
      if (action === "reject" && !reason) return Promise.resolve(fail("REASON_REQUIRED"));

      return inTransaction(client, async (tx) => {
        const deals = createDealRepository(tx);
        const deal = await deals.findById(dealId);
        if (!deal) return fail("NOT_FOUND");
        const step = transition(deal.status, action, "editor");
        if (!step.ok) return fail("INVALID_TRANSITION");

        const review =
          action === "approve" || action === "reject"
            ? { reviewedById: actor.id, rejectionReason: action === "reject" ? reason : null }
            : {};
        const moved = await deals.transition(
          deal.id,
          deal.status,
          step.to,
          step.sets ? { [step.sets]: now } : {},
          review,
        );
        if (!moved) return fail("CONFLICT");

        await createAuditLogRepository(tx).record({
          actorId: actor.id,
          action: `deal.${action}`,
          entityType: "Deal",
          entityId: deal.id,
          diff: { from: deal.status, to: step.to, ...(reason ? { reason } : {}) },
          createdAt: now,
        });
        return ok({ status: step.to });
      });
    },

    /** Edit a deal's editorial content. Prices and scores always come from the engines. */
    updateContent(params: {
      actor: Actor;
      dealId: string;
      content: DealContent;
      now: Date;
    }): Promise<AdminResult> {
      const { actor, dealId, content, now } = params;
      if (!hasRole(actor.role, "EDITOR")) return Promise.resolve(fail("FORBIDDEN"));

      return inTransaction(client, async (tx) => {
        const deals = createDealRepository(tx);
        const deal = await deals.findById(dealId);
        if (!deal) return fail("NOT_FOUND");
        if (!isEditable(deal.status)) return fail("NOT_EDITABLE");

        const before: DealContent = {
          title: deal.title,
          summary: deal.summary,
          description: deal.description,
          isFeatured: deal.isFeatured,
          expiresAt: deal.expiresAt,
        };
        const changed = (Object.keys(content) as (keyof DealContent)[]).filter(
          (key) => comparable(before[key]) !== comparable(content[key]),
        );
        if (changed.length === 0) return ok(undefined);

        await deals.updateContent(deal.id, content);
        await createAuditLogRepository(tx).record({
          actorId: actor.id,
          action: "deal.edit",
          entityType: "Deal",
          entityId: deal.id,
          diff: Object.fromEntries(
            changed.map((key) => [
              key,
              { from: comparable(before[key]), to: comparable(content[key]) },
            ]),
          ),
          createdAt: now,
        });
        return ok(undefined);
      });
    },
  };
}
