import "server-only";
import { alertPushContent } from "@/lib/alerts";
import type { DealLevel } from "@/lib/public-types";
import { isQuietHour } from "@/lib/quiet-hours";
import { createPushSubscriptionRepository } from "@/server/db/repositories/push-subscription.repository";
import type { DbClient } from "@/server/db/types";
import { isHigherLevel } from "@/server/deals/engine";
import { createPushSender, pushConfigFromEnv, type PushSender } from "@/server/push/web-push";
import { shareSettingsFromEnv } from "@/server/social/config";
import {
  createSocialPostingService,
  type SocialPostingService,
} from "@/server/social/social-posting.service";

// "Get price error alerts — no account needed": every new big drop or price error is pushed to
// every device following that level. Uses the posting queue (network "push-broadcast"), so each
// deal goes out once per level, price errors first.

export const BROADCAST_NETWORK = "push-broadcast";
/** Broadcasts per 24 hours; a flood of notifications makes people switch them off. */
export const BROADCAST_DAILY_LIMIT = 60;

export function createBroadcastService(
  client: DbClient,
  sender: PushSender,
  env: Readonly<Record<string, string | undefined>> = {},
): SocialPostingService {
  const subscriptions = createPushSubscriptionRepository(client);
  let now = new Date();

  const service = createSocialPostingService(
    client,
    {
      ...shareSettingsFromEnv(env),
      minLevel: "BIG_DROP",
      dailyLimit: BROADCAST_DAILY_LIMIT,
      network: BROADCAST_NETWORK,
    },
    {
      async post(_text, deal) {
        // Devices following this deal's level or a lower one, outside their quiet hours.
        const levels: DealLevel[] = (["BIG_DROP", "PRICE_ERROR"] as const).filter(
          (l) => !isHigherLevel(l, deal.level),
        );
        const targets = (await subscriptions.listFollowing(levels)).filter(
          (t) => !isQuietHour(t, now),
        );
        const content = alertPushContent({ ...deal, retailerName: deal.retailer.name });
        for (const target of targets) {
          const result = await sender.send(target, {
            ...content,
            url: `/deals/${deal.slug}`,
            tag: `deal-${deal.slug}`,
            image: null,
            urgent: true,
          });
          if (result === "delivered") await subscriptions.markDelivered(target.id, now);
          else await subscriptions.markFailed(target.id, result === "gone");
        }
        return { id: null };
      },
    },
  );
  return {
    run(params) {
      now = params.now;
      return service.run(params);
    },
    postDeal(params) {
      now = params.now;
      return service.postDeal(params);
    },
  };
}

/** Broadcasts when push notifications are set up, otherwise undefined. */
export function broadcastFromEnv(
  client: DbClient,
  env: Readonly<Record<string, string | undefined>>,
): SocialPostingService | undefined {
  const push = pushConfigFromEnv(env);
  return push ? createBroadcastService(client, createPushSender(push), env) : undefined;
}
