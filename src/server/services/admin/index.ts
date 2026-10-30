import "server-only";
import { db } from "@/server/db/client";
import { createAdminRepository } from "@/server/db/repositories/admin.repository";
import { createPriceHistoryRepository } from "@/server/db/repositories/price-history.repository";
import { computePriceStats } from "@/server/pricing";
import { createAdminCatalogueService } from "./admin-catalogue.service";
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
  const [history, audit] = await Promise.all([
    variantHistory(deal.variantId, now),
    adminReads.auditTrail("Deal", deal.id),
  ]);
  return { deal, ...history, audit };
}

export async function getProductDetail(id: string, now: Date) {
  const product = await adminReads.findProduct(id);
  if (!product) return null;
  const defaultVariant = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const history = defaultVariant ? await variantHistory(defaultVariant.id, now) : null;
  return { product, defaultVariant, history };
}
