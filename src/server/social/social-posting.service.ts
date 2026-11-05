import "server-only";
import { buildDealTweet } from "@/lib/social";
import type { DealLevel } from "@/lib/public-types";
import {
  createSocialPostRepository,
  type DealForPost,
} from "@/server/db/repositories/social-post.repository";
import type { DbClient } from "@/server/db/types";
import { isHigherLevel } from "@/server/deals/engine";
import { shareSettingsFromEnv, socialConfigFromEnv, type ShareSettings } from "./config";
import { createXClient, XApiError } from "./x-client";

/** Posted automatically through X's API. */
export const X_NETWORK = "x";
/** Offered to editors as "tap to tweet" push notifications (free; a person presses Post). */
export const X_SHARE_NETWORK = "x-share";
/** Tries per post before it is marked FAILED. */
const MAX_ATTEMPTS = 3;
const DAY_MS = 86_400_000;

export type PostedDeal = DealForPost;

/** Publishes a prepared post; returns the network's id for it (null for "tap to tweet"). */
export type Poster = {
  post(text: string, deal: PostedDeal): Promise<{ id: string | null }>;
};

export type SocialSummary = {
  queued: number;
  posted: number;
  skipped: number;
  failed: number;
  /** Posts left in today's allowance after this run. */
  remainingToday: number;
};

const LEVELS: DealLevel[] = ["NORMAL", "BIG_DROP", "PRICE_ERROR"];

/** X's "compose a post" page with the text filled in — free, no API keys, a person posts it. */
export function xIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** The link a post carries, following the link setting (retailer falls back to our page). */
export function dealLink(deal: DealForPost, settings: ShareSettings): string | null {
  if (settings.links === "none") return null;
  const retailerLink = deal.product.affiliateLinks[0]?.destinationUrl;
  if (settings.links === "retailer" && retailerLink) return retailerLink;
  return `${settings.siteUrl}/deals/${deal.slug}`;
}

/** The post text for a deal, or null when it isn't live. */
export function tweetFor(deal: DealForPost | null, settings: ShareSettings): string | null {
  const live =
    deal?.status === "PUBLISHED" && deal.product.isActive && deal.retailer.status === "ACTIVE";
  return live
    ? buildDealTweet({ ...deal, retailerName: deal.retailer.name }, dealLink(deal, settings))
    : null;
}

/**
 * Posts deals to the brand's X account — through X's API, or as "tap to tweet" pushes to
 * editors. New deals at the minimum level or above are queued once per deal and level, then
 * sent within a rolling 24-hour allowance, price errors first. A deal that is no longer public
 * by then is skipped.
 */
export function createSocialPostingService(
  client: DbClient,
  settings: ShareSettings & { network: string },
  poster: Poster,
) {
  const posts = createSocialPostRepository(client);
  const { network } = settings;
  const levels = LEVELS.filter(
    (l) => l === settings.minLevel || isHigherLevel(l, settings.minLevel),
  );

  async function send(now: Date): Promise<Omit<SocialSummary, "queued">> {
    const used = await posts.countPostedSince(network, new Date(now.getTime() - DAY_MS));
    let remaining = Math.max(0, settings.dailyLimit - used);
    const summary = { posted: 0, skipped: 0, failed: 0 };
    if (remaining === 0) return { ...summary, remainingToday: 0 };

    for (const post of await posts.listPending(network, remaining)) {
      const deal = post.deal;
      const text = deal && !isHigherLevel(post.level, deal.level) ? tweetFor(deal, settings) : null;
      if (!deal || !text) {
        await posts.markSkipped(post.id, "Deal is no longer live at this level");
        summary.skipped += 1;
        continue;
      }
      try {
        const { id } = await poster.post(text, deal);
        await posts.markPosted(post.id, { text, externalId: id, at: now });
        summary.posted += 1;
        remaining -= 1;
      } catch (error) {
        const giveUp =
          post.attempts + 1 >= MAX_ATTEMPTS ||
          // Duplicate content or a policy rejection won't succeed on a retry.
          (error instanceof XApiError && error.status === 403);
        await posts.markFailedAttempt(post.id, {
          text,
          error: error instanceof Error ? error.message : String(error),
          giveUp,
        });
        if (giveUp) summary.failed += 1;
        // Rate limited, unauthorised or X is down: stop for this run, try again next run.
        if (error instanceof XApiError && error.status !== 403) break;
      }
    }
    return { ...summary, remainingToday: remaining };
  }

  return {
    /** Queues deals that became news since `since`, then sends what today's allowance allows. */
    async run(params: { now: Date; since: Date }): Promise<SocialSummary> {
      const deals = await posts.listNewsworthyDeals(levels, params.since);
      const queued = await posts.queue(
        network,
        deals.map((d) => ({ dealId: d.id, level: d.level })),
      );
      return { queued, ...(await send(params.now)) };
    },

    /** An editor's "Post to X": queues one public deal whatever its level, then sends. */
    async postDeal(params: {
      dealId: string;
      level: DealLevel;
      now: Date;
    }): Promise<SocialSummary> {
      const queued = await posts.queue(network, [{ dealId: params.dealId, level: params.level }]);
      return { queued, ...(await send(params.now)) };
    },
  };
}

export type SocialPostingService = ReturnType<typeof createSocialPostingService>;

type Env = Readonly<Record<string, string | undefined>>;

/** Automatic posting through X's API, or undefined when the X keys aren't set. */
export function socialPostingFromEnv(client: DbClient, env: Env): SocialPostingService | undefined {
  const config = socialConfigFromEnv(env);
  if (!config) return undefined;
  const x = createXClient(config.credentials);
  return createSocialPostingService(
    client,
    { ...config, network: X_NETWORK },
    { post: (text) => x.post(text) },
  );
}

/** "Tap to tweet" for one deal: X's compose page with the post filled in, or null. */
export async function shareIntentForDeal(
  client: DbClient,
  dealId: string,
  env: Env,
): Promise<string | null> {
  const deal = await createSocialPostRepository(client).findDeal(dealId);
  const text = tweetFor(deal, shareSettingsFromEnv(env));
  return text ? xIntentUrl(text) : null;
}
