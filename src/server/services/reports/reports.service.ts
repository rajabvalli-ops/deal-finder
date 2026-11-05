import "server-only";
import type { ReportInput } from "@/lib/validation/vouchers";
import { hashIp } from "@/server/affiliate";
import { hasRole } from "@/server/auth/roles";
import { createAuditLogRepository } from "@/server/db/repositories/audit-log.repository";
import { createCouponRepository } from "@/server/db/repositories/coupon.repository";
import { PUBLIC_DEAL_WHERE } from "@/server/db/repositories/public.repository";
import {
  createReportRepository,
  type OpenReportRow,
} from "@/server/db/repositories/report.repository";
import { inTransaction } from "@/server/db/transaction";
import type { DbClient } from "@/server/db/types";
import type { RateLimiter } from "@/server/rate-limit/rate-limiter";
import { fail, ok, type Actor, type AdminResult } from "@/server/services/admin/result";

/** Distinct "ended / doesn't work" reports that hide a voucher automatically. */
export const VOUCHER_AUTO_HIDE_REPORTS = 3;
const AUTO_HIDE_WINDOW_MS = 7 * 86_400_000;

export type ReportResult =
  { ok: true; hidden: boolean } | { ok: false; error: "NOT_FOUND" | "RATE_LIMITED" };

/** Open reports gathered per deal or voucher, for the admin queue. */
export type ReportGroup = {
  target: "DEAL" | "COUPON";
  targetId: string;
  label: string;
  /** Admin page to act on it. */
  href: string;
  /** Still visible on the public site. */
  live: boolean;
  count: number;
  reasons: Partial<Record<string, number>>;
  notes: string[];
  latestAt: Date;
};

function groupReports(rows: OpenReportRow[]): ReportGroup[] {
  const groups = new Map<string, ReportGroup>();
  for (const r of rows) {
    let group = groups.get(r.targetId);
    if (!group) {
      group =
        r.target === "DEAL"
          ? {
              target: "DEAL",
              targetId: r.targetId,
              label: r.deal?.title ?? "Deleted deal",
              href: `/admin/deals/${r.targetId}`,
              live: r.deal?.status === "PUBLISHED",
              count: 0,
              reasons: {},
              notes: [],
              latestAt: r.createdAt,
            }
          : {
              target: "COUPON",
              targetId: r.targetId,
              label: r.coupon
                ? `${r.coupon.code ?? r.coupon.title} (${r.coupon.retailer.name})`
                : "Deleted voucher",
              href: "/admin/vouchers",
              live: r.coupon?.isActive ?? false,
              count: 0,
              reasons: {},
              notes: [],
              latestAt: r.createdAt,
            };
      groups.set(r.targetId, group);
    }
    group.count += 1;
    group.reasons[r.reason] = (group.reasons[r.reason] ?? 0) + 1;
    if (r.note) group.notes.push(r.note);
  }
  // Most-reported first, then most recent.
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || b.latestAt.getTime() - a.latestAt.getTime(),
  );
}

export function createReportsService(
  client: DbClient,
  options: { hashSecret: string; rateLimiter: RateLimiter },
) {
  return {
    /**
     * A visitor's report. One per reporter per deal or voucher (repeats are accepted quietly);
     * enough "ended / doesn't work" reports on a voucher switch it off. Deals are never taken
     * down by reports alone — they go to the editors' queue.
     */
    async submit(params: {
      input: ReportInput;
      userId: string | null;
      ip: string | null;
      now: Date;
    }): Promise<ReportResult> {
      const { input, userId, ip, now } = params;
      const reporterKey = userId
        ? `user:${userId}`
        : `ip:${hashIp(ip, options.hashSecret, now) ?? "unknown"}`;
      if (!(await options.rateLimiter.consume(`report:${reporterKey}`, now)).allowed) {
        return { ok: false, error: "RATE_LIMITED" };
      }
      const target = input.target === "deal" ? "DEAL" : "COUPON";
      const exists =
        target === "DEAL"
          ? await client.deal.findFirst({
              where: { id: input.id, ...PUBLIC_DEAL_WHERE },
              select: { id: true },
            })
          : await createCouponRepository(client).findLive(input.id, now);
      if (!exists) return { ok: false, error: "NOT_FOUND" };

      return inTransaction(client, async (tx) => {
        const reports = createReportRepository(tx);
        const added = await reports.create(
          {
            target,
            targetId: input.id,
            reason: input.reason,
            note: input.note,
            userId,
            reporterKey,
          },
          now,
        );
        if (!added || target !== "COUPON") return { ok: true, hidden: false };

        const dead = await reports.countOpen(
          input.id,
          ["EXPIRED", "CODE_NOT_WORKING"],
          new Date(now.getTime() - AUTO_HIDE_WINDOW_MS),
        );
        if (dead < VOUCHER_AUTO_HIDE_REPORTS) return { ok: true, hidden: false };
        await createCouponRepository(tx).setActive(input.id, false);
        await reports.close(input.id, "RESOLVED", null, now);
        await createAuditLogRepository(tx).record({
          actorId: null,
          action: "coupon.auto-deactivate",
          entityType: "Coupon",
          entityId: input.id,
          diff: { reason: `${dead} visitors reported it ended or not working` },
          createdAt: now,
        });
        return { ok: true, hidden: true };
      });
    },

    async openGroups(): Promise<ReportGroup[]> {
      return groupReports(await createReportRepository(client).listOpen());
    },

    countOpen() {
      return createReportRepository(client).countAllOpen();
    },

    /** An editor closes the reports on one deal or voucher (after acting on them, or not). */
    async close(params: {
      actor: Actor;
      targetId: string;
      outcome: "RESOLVED" | "DISMISSED";
      now: Date;
    }): Promise<AdminResult> {
      const { actor, targetId, outcome, now } = params;
      if (!hasRole(actor.role, "EDITOR")) return fail("FORBIDDEN");
      const closed = await createReportRepository(client).close(targetId, outcome, actor.id, now);
      return closed > 0 ? ok(undefined) : fail("NOT_FOUND");
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
