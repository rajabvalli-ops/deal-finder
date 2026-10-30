import "server-only";
import { alertNotificationContent } from "@/lib/alerts";
import { createAlertRepository } from "@/server/db/repositories/alert.repository";
import { createNotificationRepository } from "@/server/db/repositories/notification.repository";
import { inTransaction } from "@/server/db/transaction";
import type { DbClient } from "@/server/db/types";
import type { PushDelivery } from "./push-delivery.service";

/** Matches handled per run; the next run picks up the rest. */
export const MATCH_BATCH_SIZE = 2000;

export type MatchSummary = {
  /** Notifications created. */
  notified: number;
  /** Alerts that fired. */
  alerts: number;
  /** True when the batch limit was reached and more matches may remain. */
  more: boolean;
  /** Browser push messages delivered (0 when push isn't configured). */
  pushed: number;
};

/**
 * Turns newly published deals into in-app notifications for matching alerts.
 * Idempotent: each (alert, deal, level) is notified at most once, via the dedupe key.
 */
export function createAlertMatchingService(
  client: DbClient,
  options: { batchSize?: number; push?: PushDelivery } = {},
) {
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
      if (matches.length === 0) return { notified: 0, alerts: 0, more: false, pushed: 0 };

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
            dedupeKey: `${m.alertId}:${m.dealId}:${m.level}`,
            ...alertNotificationContent(m),
          })),
        );
        const alertIds = [...new Set(rows.map((r) => r.alertId).filter((id) => id !== null))];
        if (alertIds.length > 0) {
          await createAlertRepository(tx).markTriggered(alertIds, params.now);
        }
        return { notified: rows.length, alerts: alertIds.length, rows };
      });

      // After the commit: pushes go out only for notifications that really were stored.
      let pushed = 0;
      if (options.push && created.rows.length > 0) {
        const byKey = new Map(matches.map((m) => [`${m.alertId}:${m.dealId}`, m]));
        const notices = created.rows.flatMap((row) => {
          const match = byKey.get(`${row.alertId}:${row.dealId}`);
          return match
            ? [
                {
                  userId: row.userId,
                  subject: row.subject,
                  body: row.body,
                  dealSlug: match.dealSlug,
                  level: match.level,
                },
              ]
            : [];
        });
        try {
          pushed = (await options.push.deliver(notices, params.now)).pushed;
        } catch (error) {
          console.error("Push delivery failed", error);
        }
      }
      return {
        notified: created.notified,
        alerts: created.alerts,
        more: matches.length === batchSize,
        pushed,
      };
    },
  };
}

export type AlertMatchingService = ReturnType<typeof createAlertMatchingService>;
