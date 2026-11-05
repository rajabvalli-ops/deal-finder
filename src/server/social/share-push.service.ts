import "server-only";
import type { DealLevel } from "@/lib/public-types";
import { createPushSubscriptionRepository } from "@/server/db/repositories/push-subscription.repository";
import type { DbClient } from "@/server/db/types";
import { createPushSender, pushConfigFromEnv, type PushSender } from "@/server/push/web-push";
import { shareSettingsFromEnv, socialConfigFromEnv } from "./config";
import {
  createSocialPostingService,
  X_SHARE_NETWORK,
  type PostedDeal,
  type SocialPostingService,
} from "./social-posting.service";

// "Tap to tweet": instead of posting through X's paid API, each post-worthy deal is pushed to
// the editors' phones. Tapping opens /admin/deals/<id>/tweet, which opens X's compose screen
// with the post filled in; a person checks it and presses Post. Free, and nothing goes out
// unseen.

/** Share pushes per 24 hours (they cost nothing; this just stops a flood). */
export const SHARE_DAILY_LIMIT = 50;

const HEADLINE: Record<DealLevel, string> = {
  NORMAL: "🔥 Deal — tap to tweet",
  BIG_DROP: "📉 Big drop — tap to tweet",
  PRICE_ERROR: "🚨 Price error — tap to tweet",
};

export class NoEditorDevicesError extends Error {
  constructor() {
    super("No editor or admin has turned on notifications on a device");
    this.name = "NoEditorDevicesError";
  }
}

export function createSharePushService(
  client: DbClient,
  sender: PushSender,
  env: Readonly<Record<string, string | undefined>>,
): SocialPostingService {
  const subscriptions = createPushSubscriptionRepository(client);

  async function pushToEditors(text: string, deal: PostedDeal, now: Date): Promise<void> {
    const targets = await subscriptions.listForRoles(["EDITOR", "ADMIN"]);
    let delivered = 0;
    for (const target of targets) {
      const result = await sender.send(target, {
        title: HEADLINE[deal.level],
        // The price line of the post ("£3.06 for Oust Descaler…").
        body: text.split("\n")[2] ?? deal.title,
        url: `/admin/deals/${deal.id}/tweet`,
        tag: `share-${deal.id}`,
        image: null,
        urgent: deal.level !== "NORMAL",
      });
      if (result === "delivered") {
        delivered += 1;
        await subscriptions.markDelivered(target.id, now);
      } else {
        await subscriptions.markFailed(target.id, result === "gone");
      }
    }
    if (delivered === 0) throw new NoEditorDevicesError();
  }

  let now = new Date();
  const service = createSocialPostingService(
    client,
    { ...shareSettingsFromEnv(env), dailyLimit: SHARE_DAILY_LIMIT, network: X_SHARE_NETWORK },
    {
      async post(text, deal) {
        await pushToEditors(text, deal, now);
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

/**
 * "Tap to tweet" pushes, when push notifications are set up and X's API isn't (with the API
 * keys set, posts go out automatically instead).
 */
export function sharePushFromEnv(
  client: DbClient,
  env: Readonly<Record<string, string | undefined>>,
): SocialPostingService | undefined {
  const push = pushConfigFromEnv(env);
  if (!push || socialConfigFromEnv(env)) return undefined;
  return createSharePushService(client, createPushSender(push), env);
}
