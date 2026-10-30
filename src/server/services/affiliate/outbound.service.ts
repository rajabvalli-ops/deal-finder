import "server-only";
import { parsePlacement } from "@/lib/outbound";
import {
  hashIp,
  isLikelyBot,
  isValidLinkCode,
  sanitiseReferrer,
  truncateUserAgent,
} from "@/server/affiliate";
import { createAffiliateRepository } from "@/server/db/repositories/affiliate.repository";
import type { DbClient } from "@/server/db/types";
import type { RateLimiter } from "@/server/rate-limit/rate-limiter";
import { createAdapter, isAllowedUrl, type AdapterContext } from "@/server/retailers";

/** What the browser sent with the click. Raw values; the service decides what is kept. */
export type ClickRequest = {
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  placement: string | null;
  dealSlug: string | null;
};

export type OutboundTarget = { linkId: string; productId: string | null; destinationUrl: string };

export type OutboundResolution =
  | { kind: "redirect"; target: OutboundTarget; ipHash: string | null }
  | { kind: "not-found" }
  | { kind: "rate-limited"; retryAfterSeconds: number };

type Logger = Pick<Console, "warn" | "error">;

/**
 * Resolves /go/[code] to a retailer URL and records clicks. A code only redirects when its
 * link, product and retailer are all active and the stored URL is still on one of the
 * retailer adapter's allowed hosts, so the endpoint can never be used as an open redirect.
 */
export function createOutboundService(
  client: DbClient,
  options: {
    /** Keys the daily IP hash. */
    hashSecret: string;
    rateLimiter: RateLimiter;
    env: AdapterContext["env"];
    logger?: Logger;
  },
) {
  const repo = createAffiliateRepository(client);
  const logger = options.logger ?? console;

  return {
    async resolve(
      code: string,
      request: Pick<ClickRequest, "ip">,
      now: Date,
    ): Promise<OutboundResolution> {
      const ipHash = hashIp(request.ip, options.hashSecret, now);
      const limit = await options.rateLimiter.consume(`go:${ipHash ?? "unknown"}`, now);
      if (!limit.allowed) {
        return {
          kind: "rate-limited",
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((limit.resetAt.getTime() - now.getTime()) / 1000),
          ),
        };
      }
      if (!isValidLinkCode(code)) return { kind: "not-found" };

      const link = await repo.findByCode(code);
      if (
        !link ||
        !link.isActive ||
        link.retailer.status !== "ACTIVE" ||
        (link.product !== null && !link.product.isActive)
      ) {
        return { kind: "not-found" };
      }

      let allowed = false;
      try {
        const adapter = createAdapter(link.retailer, { now: () => now, env: options.env });
        allowed = isAllowedUrl(adapter, link.destinationUrl);
      } catch (error) {
        logger.error(`[outbound] no adapter for link ${link.code}:`, error);
        return { kind: "not-found" };
      }
      if (!allowed) {
        logger.warn(`[outbound] link ${link.code} points outside its retailer's allowed hosts`);
        return { kind: "not-found" };
      }
      return {
        kind: "redirect",
        target: { linkId: link.id, productId: link.productId, destinationUrl: link.destinationUrl },
        ipHash,
      };
    },

    /**
     * Stores one click. Called after the redirect has been sent; failures are logged and
     * swallowed so tracking can never break a visitor's journey.
     */
    async recordClick(
      target: OutboundTarget,
      ipHash: string | null,
      request: ClickRequest,
      now: Date,
    ): Promise<boolean> {
      try {
        const dealId =
          request.dealSlug && target.productId
            ? await repo.dealIdForProduct(request.dealSlug.slice(0, 200), target.productId)
            : null;
        await repo.recordClick({
          affiliateLinkId: target.linkId,
          dealId,
          productId: target.productId,
          ipHash,
          userAgent: truncateUserAgent(request.userAgent),
          referrer: sanitiseReferrer(request.referrer),
          placement: parsePlacement(request.placement),
          isBot: isLikelyBot(request.userAgent),
          createdAt: now,
        });
        return true;
      } catch (error) {
        logger.error("[outbound] failed to record click:", error);
        return false;
      }
    },
  };
}

export type OutboundService = ReturnType<typeof createOutboundService>;
