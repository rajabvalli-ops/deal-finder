import "server-only";
import { buildDealTweet } from "@/lib/social";
import type { DealLevel } from "@/lib/public-types";
import { createSocialPostRepository } from "@/server/db/repositories/social-post.repository";
import type { DbClient } from "@/server/db/types";
import { isHigherLevel } from "@/server/deals/engine";
import { socialConfigFromEnv, type SocialConfig } from "./config";
import { createXClient, XApiError } from "./x-client";

export const X_NETWORK = "x";
/** Tries per post before it is marked FAILED. */
const MAX_ATTEMPTS = 3;
const DAY_MS = 86_400_000;

export type Poster = { post(text: string): Promise<{ id: string }> };

export type SocialSummary = {
  queued: number;
  posted: number;
  skipped: number;
  failed: number;
  /** Posts left in today's allowance after this run. */
  remainingToday: number;
};

const LEVELS: DealLevel[] = ["NORMAL", "BIG_DROP", "PRICE_ERROR"];

/**
 * Posts deals to the brand's X account. New big drops and price errors (or whatever the
 * minimum level is) are queued once per deal and level, then posted within a rolling 24-hour
 * allowance, price errors first. A deal that is no longer public by then is skipped.
 */
export function createSocialPostingService(client: DbClient, config: SocialConfig, poster: Poster) {
  const posts = createSocialPostRepository(client);
  const levels = LEVELS.filter((l) => l === config.minLevel || isHigherLevel(l, config.minLevel));

  function dealUrl(slug: string): string | null {
    return config.links === "deal-page" ? `${config.siteUrl}/deals/${slug}` : null;
  }

  async function send(now: Date): Promise<Omit<SocialSummary, "queued">> {
    const used = await posts.countPostedSince(X_NETWORK, new Date(now.getTime() - DAY_MS));
    let remaining = Math.max(0, config.dailyLimit - used);
    const summary = { posted: 0, skipped: 0, failed: 0 };
    if (remaining === 0) return { ...summary, remainingToday: 0 };

    for (const post of await posts.listPending(X_NETWORK, remaining)) {
      const deal = post.deal;
      const live =
        deal?.status === "PUBLISHED" &&
        deal.product.isActive &&
        deal.retailer.status === "ACTIVE" &&
        !isHigherLevel(post.level, deal.level);
      if (!deal || !live) {
        await posts.markSkipped(post.id, "Deal is no longer live at this level");
        summary.skipped += 1;
        continue;
      }
      const text = buildDealTweet(
        { ...deal, retailerName: deal.retailer.name },
        dealUrl(deal.slug),
      );
      try {
        const { id } = await poster.post(text);
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
    /** Queues deals that became news since `since`, then posts what today's allowance allows. */
    async run(params: { now: Date; since: Date }): Promise<SocialSummary> {
      const deals = await posts.listNewsworthyDeals(levels, params.since);
      const queued = await posts.queue(
        X_NETWORK,
        deals.map((d) => ({ dealId: d.id, level: d.level })),
      );
      return { queued, ...(await send(params.now)) };
    },

    /** An editor's "Post to X": queues one public deal whatever its level, then posts. */
    async postDeal(params: {
      dealId: string;
      level: DealLevel;
      now: Date;
    }): Promise<SocialSummary> {
      const queued = await posts.queue(X_NETWORK, [{ dealId: params.dealId, level: params.level }]);
      return { queued, ...(await send(params.now)) };
    },
  };
}

export type SocialPostingService = ReturnType<typeof createSocialPostingService>;

/** The X posting service from environment variables, or undefined when X isn't connected. */
export function socialPostingFromEnv(
  client: DbClient,
  env: Readonly<Record<string, string | undefined>>,
): SocialPostingService | undefined {
  const config = socialConfigFromEnv(env);
  return config
    ? createSocialPostingService(client, config, createXClient(config.credentials))
    : undefined;
}
