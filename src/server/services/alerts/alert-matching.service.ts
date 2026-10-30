import "server-only";
import { alertNotificationContent } from "@/lib/alerts";
import { createAlertRepository } from "@/server/db/repositories/alert.repository";
import { createNotificationRepository } from "@/server/db/repositories/notification.repository";
import { inTransaction } from "@/server/db/transaction";
import type { DbClient } from "@/server/db/types";

/** Matches handled per run; the next run picks up the rest. */
export const MATCH_BATCH_SIZE = 2000;

export type MatchSummary = {
  /** Notifications created. */
  notified: number;
  /** Alerts that fired. */
  alerts: number;
  /** True when the batch limit was reached and more matches may remain. */
  more: boolean;
};

/**
 * Turns newly published deals into in-app notifications for matching alerts.
 * Idempotent: each (alert, deal) pair is notified at most once, via the dedupe key.
 */
export function createAlertMatchingService(client: DbClient, options: { batchSize?: number } = {}) {
  const batchSize = options.batchSize ?? MATCH_BATCH_SIZE;

  return {
    async matchDeals(params: {
      now: Date;
      since: Date;
      dealIds?: string[];
    }): Promise<MatchSummary> {
      const matches = await createAlertRepository(client).findMatches({
        since: params.since,
        dealIds: params.dealIds,
        limit: batchSize,
      });
      if (matches.length === 0) return { notified: 0, alerts: 0, more: false };

      const created = await inTransaction(client, async (tx) => {
        const rows = await createNotificationRepository(tx).createMany(
          matches.map((m) => ({
            userId: m.userId,
            alertId: m.alertId,
            dealId: m.dealId,
            // In-app notifications are delivered by being stored. Email is a later stage.
            channel: "IN_APP",
            status: "SENT",
            sentAt: params.now,
            dedupeKey: `${m.alertId}:${m.dealId}`,
            ...alertNotificationContent(m),
          })),
        );
        const alertIds = [...new Set(rows.map((r) => r.alertId).filter((id) => id !== null))];
        if (alertIds.length > 0) {
          await createAlertRepository(tx).markTriggered(alertIds, params.now);
        }
        return { notified: rows.length, alerts: alertIds.length };
      });
      return { ...created, more: matches.length === batchSize };
    },
  };
}

export type AlertMatchingService = ReturnType<typeof createAlertMatchingService>;
