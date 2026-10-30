import "server-only";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { createMemoryRateLimiter } from "@/server/rate-limit/rate-limiter";
import { createAffiliateLinkService } from "./affiliate-links.service";
import { createOutboundService } from "./outbound.service";

export { AffiliateLinkError, createAffiliateLinkService } from "./affiliate-links.service";
export type { ClickRequest, OutboundResolution } from "./outbound.service";

export const affiliateLinks = createAffiliateLinkService(db);

/**
 * Per-instance limit: generous for people (nobody follows 60 retailer links a minute) and
 * enough to stop one client hammering the database. See docs/ARCHITECTURE.md §10.
 */
const outboundRateLimiter = createMemoryRateLimiter({ limit: 60, windowMs: 60_000 });

export const outbound = createOutboundService(db, {
  // Domain-separated inside hashIp, so reusing the auth secret leaks nothing about either.
  hashSecret: env.BETTER_AUTH_SECRET,
  rateLimiter: outboundRateLimiter,
  env: process.env,
});
