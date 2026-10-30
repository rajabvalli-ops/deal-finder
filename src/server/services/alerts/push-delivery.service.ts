import "server-only";
import type { DealLevel } from "@/lib/public-types";
import { createPushSubscriptionRepository } from "@/server/db/repositories/push-subscription.repository";
import type { DbClient } from "@/server/db/types";
import {
  createPushSender,
  pushConfigFromEnv,
  type PushMessage,
  type PushSender,
} from "@/server/push/web-push";

export type PushNotice = {
  userId: string;
  /** Push headline and text (see alertPushContent). */
  title: string;
  body: string;
  dealSlug: string;
  imageUrl: string | null;
  level: DealLevel;
};

/** Pushes sent at once; push services handle bursts, our function time limit is the constraint. */
const CONCURRENCY = 10;

/**
 * Sends new alert notifications to every browser the user turned push on in. Best effort:
 * the in-app notification is already stored, so a failed push loses nothing.
 */
export function createPushDelivery(client: DbClient, sender: PushSender) {
  const subscriptions = createPushSubscriptionRepository(client);

  return {
    async deliver(notices: PushNotice[], now: Date): Promise<{ pushed: number; failed: number }> {
      if (notices.length === 0) return { pushed: 0, failed: 0 };
      const targets = await subscriptions.listForUsers([...new Set(notices.map((n) => n.userId))]);
      const jobs = notices.flatMap((notice) =>
        targets
          .filter((t) => t.userId === notice.userId)
          .map((target) => ({ target, message: toMessage(notice) })),
      );
      let pushed = 0;
      let failed = 0;
      for (let i = 0; i < jobs.length; i += CONCURRENCY) {
        await Promise.all(
          jobs.slice(i, i + CONCURRENCY).map(async ({ target, message }) => {
            const result = await sender.send(target, message);
            if (result === "delivered") {
              pushed += 1;
              await subscriptions.markDelivered(target.id, now);
            } else {
              failed += 1;
              await subscriptions.markFailed(target.id, result === "gone");
            }
          }),
        );
      }
      return { pushed, failed };
    },
  };
}

function toMessage(notice: PushNotice): PushMessage {
  return {
    title: notice.title,
    body: notice.body,
    url: `/deals/${notice.dealSlug}`,
    image: notice.imageUrl?.startsWith("https://") ? notice.imageUrl : null,
    tag: `deal-${notice.dealSlug}`,
    urgent: notice.level !== "NORMAL",
  };
}

export type PushDelivery = ReturnType<typeof createPushDelivery>;

/** Push delivery from VAPID environment variables, or undefined when push isn't configured. */
export function pushDeliveryFromEnv(
  client: DbClient,
  env: Readonly<Record<string, string | undefined>>,
): PushDelivery | undefined {
  const config = pushConfigFromEnv(env);
  return config ? createPushDelivery(client, createPushSender(config)) : undefined;
}
