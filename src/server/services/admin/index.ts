import "server-only";
import { db } from "@/server/db/client";
import { createAdminRepository } from "@/server/db/repositories/admin.repository";
import { createPriceHistoryRepository } from "@/server/db/repositories/price-history.repository";
import { computePriceStats } from "@/server/pricing";
import { AMAZON_ENV } from "@/server/retailers/adapters/amazon";
import { createSocialPostRepository } from "@/server/db/repositories/social-post.repository";
import { shareIntentForDeal, socialPostingFromEnv } from "@/server/social/social-posting.service";
import { fail, ok, type AdminResult } from "./result";
import { amazonConfigOf, createAdminCatalogueService } from "./admin-catalogue.service";
import { createAdminDealsService } from "./admin-deals.service";
import { createAdminUsersService } from "./admin-users.service";

export { ADMIN_ERROR_MESSAGES, type AdminErrorCode, type Actor } from "./result";

const DAY_MS = 86_400_000;
/** History shown on admin detail pages. */
const HISTORY_DAYS = 180;

export const adminDeals = createAdminDealsService(db);
export const adminCatalogue = createAdminCatalogueService(db);
export const adminUsers = createAdminUsersService(db);
export const adminReads = createAdminRepository(db);

async function variantHistory(variantId: string, now: Date) {
  const observations = await createPriceHistoryRepository(db).listForVariant(variantId, {
    since: new Date(now.getTime() - HISTORY_DAYS * DAY_MS),
  });
  return { observations, stats: computePriceStats(observations, now) };
}

export async function getDealDetail(id: string, now: Date) {
  const deal = await adminReads.findDeal(id);
  if (!deal) return null;
  const [history, audit, socialPosts] = await Promise.all([
    variantHistory(deal.variantId, now),
    adminReads.auditTrail("Deal", deal.id),
    createSocialPostRepository(db).listForDeal(deal.id),
  ]);
  return {
    deal,
    ...history,
    audit,
    socialPosts,
    socialEnabled: socialPostingFromEnv(db, process.env) !== undefined,
  };
}

export async function getProductDetail(id: string, now: Date) {
  const product = await adminReads.findProduct(id);
  if (!product) return null;
  const defaultVariant = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const history = defaultVariant ? await variantHistory(defaultVariant.id, now) : null;
  return { product, defaultVariant, history };
}

/** An Amazon retailer's tracking settings and which credentials are missing (names only). */
export async function getAmazonTracking(retailerId: string) {
  const retailer = await adminReads.findRetailer(retailerId);
  const config = retailer ? amazonConfigOf(retailer) : null;
  if (!retailer || !config) return null;
  const missingEnv = Object.values(AMAZON_ENV).filter((key) => !process.env[key]?.trim());
  return { retailer, config, missingEnv };
}

/** An editor's "Post to X now" for a live deal. Counts against the daily posting limit. */
export async function postDealToSocial(dealId: string, now: Date): Promise<AdminResult> {
  const social = socialPostingFromEnv(db, process.env);
  if (!social) return fail("SOCIAL_OFF");
  const deal = await adminReads.findDeal(dealId);
  if (!deal) return fail("NOT_FOUND");
  if (deal.status !== "PUBLISHED") return fail("NOT_LIVE");
  const result = await social.postDeal({ dealId: deal.id, level: deal.level, now });
  return result.posted > 0 ? ok(undefined) : fail("SOCIAL_FAILED");
}

/** X's compose screen with this deal's post filled in ("tap to tweet"), or null if not live. */
export function tweetIntentForDeal(dealId: string): Promise<string | null> {
  return shareIntentForDeal(db, dealId, process.env);
}
