import "server-only";
import { createHash } from "node:crypto";
import { slugify } from "@/lib/slug";
import { createAuditLogRepository } from "@/server/db/repositories/audit-log.repository";
import { createDealRepository } from "@/server/db/repositories/deal.repository";
import { createPriceHistoryRepository } from "@/server/db/repositories/price-history.repository";
import {
  createProductRepository,
  type ProductForDetection,
} from "@/server/db/repositories/product.repository";
import { inTransaction } from "@/server/db/transaction";
import type { DbClient } from "@/server/db/types";
import {
  DEFAULT_DEAL_ENGINE_CONFIG,
  evaluateDeal,
  type DealEngineConfig,
  type DealEvaluation,
} from "@/server/deals/engine";
import { ACTIVE_DEAL_STATUSES, transition } from "@/server/deals/workflow";
import { computePriceStats } from "@/server/pricing";

const DAY_MS = 86_400_000;
const HISTORY_MS = 365 * DAY_MS;

/** Re-checking existing deals tolerates a missed refresh or two before expiring them. */
const VERIFY_MAX_PRICE_AGE_MS = 48 * 3_600_000;

export type ReconcileOutcome = "created" | "updated" | "expired" | "unchanged" | "none";

export type DetectionSummary = Record<ReconcileOutcome | "failed", number> & {
  errors: { productId: string; message: string }[];
};

function emptySummary(): DetectionSummary {
  return { created: 0, updated: 0, expired: 0, unchanged: 0, none: 0, failed: 0, errors: [] };
}

function dealSlug(title: string, variantId: string, now: Date): string {
  const suffix = createHash("sha256")
    .update(`${variantId}:${now.toISOString()}`)
    .digest("hex")
    .slice(0, 6);
  return `${slugify(title, 60) || "deal"}-${suffix}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Keeps deals in step with prices. For each product it evaluates the default variant and
 * creates a PENDING_REVIEW deal, refreshes an active deal's numbers, or expires it. Every
 * change is written to the audit log with a null actor (system).
 */
export function createDealDetectionService(
  client: DbClient,
  options: { engineConfig?: DealEngineConfig } = {},
) {
  const detectConfig = options.engineConfig ?? DEFAULT_DEAL_ENGINE_CONFIG;
  const verifyConfig: DealEngineConfig = {
    ...detectConfig,
    maxPriceAgeMs: VERIFY_MAX_PRICE_AGE_MS,
  };

  async function evaluate(
    tx: DbClient,
    product: ProductForDetection,
    variantId: string,
    now: Date,
    config: DealEngineConfig,
  ) {
    const history = await createPriceHistoryRepository(tx).listForVariant(variantId, {
      since: new Date(now.getTime() - HISTORY_MS),
    });
    return evaluateDeal(
      {
        stats: computePriceStats(history, now),
        now,
        retailer: {
          isActive: product.retailer.status === "ACTIVE",
          trustScore: product.retailer.trustScore,
        },
        product: {
          rating: product.rating === null ? null : Number(product.rating),
          reviewCount: product.reviewCount,
          categorySlug: product.category?.slug ?? null,
        },
      },
      config,
    );
  }

  function invalidReason(
    product: ProductForDetection,
    deal: { expiresAt: Date | null } | null,
    evaluation: DealEvaluation,
    now: Date,
  ): string | null {
    if (!product.isActive) return "Product is no longer listed";
    if (deal?.expiresAt && deal.expiresAt <= now) return "Deal end date passed";
    if (!evaluation.isDeal) return evaluation.rejections.map((r) => r.message).join("; ");
    return null;
  }

  async function expire(
    tx: DbClient,
    deal: { id: string; status: (typeof ACTIVE_DEAL_STATUSES)[number] },
    reason: string,
    rejections: string[],
    now: Date,
  ): Promise<boolean> {
    const step = transition(deal.status, "expire", "system");
    if (
      !step.ok ||
      !(await createDealRepository(tx).transition(deal.id, deal.status, step.to, {
        expiredAt: now,
      }))
    ) {
      return false;
    }
    await createAuditLogRepository(tx).record({
      actorId: null,
      action: "deal.expire",
      entityType: "Deal",
      entityId: deal.id,
      diff: { reason, rejections },
      createdAt: now,
    });
    return true;
  }

  async function reconcile(
    product: ProductForDetection,
    now: Date,
    mode: "detect" | "verify",
  ): Promise<ReconcileOutcome> {
    const variant = product.variants[0];
    if (!variant) return "none";

    return inTransaction(client, async (tx) => {
      const deals = createDealRepository(tx);
      const audit = createAuditLogRepository(tx);
      const active = await deals.findActiveForVariant(variant.id, ACTIVE_DEAL_STATUSES);
      const evaluation = await evaluate(
        tx,
        product,
        variant.id,
        now,
        mode === "verify" ? verifyConfig : detectConfig,
      );
      const reason = invalidReason(product, active, evaluation, now);

      if (reason !== null) {
        if (!active) return "none";
        const step = transition(active.status, "expire", "system");
        if (
          !step.ok ||
          !(await deals.transition(active.id, active.status, step.to, { expiredAt: now }))
        ) {
          return "unchanged";
        }
        await audit.record({
          actorId: null,
          action: "deal.expire",
          entityType: "Deal",
          entityId: active.id,
          diff: { reason, rejections: evaluation.rejections.map((r) => r.code) },
          createdAt: now,
        });
        return "expired";
      }

      const candidate = evaluation.candidate!;
      const snapshot = {
        dealPrice: candidate.dealPrice,
        referencePrice: candidate.referencePrice,
        referenceType: candidate.referenceType,
        savingAmount: candidate.savingAmount,
        discountBps: candidate.discountBps,
        historicalLow: candidate.historicalLow,
        avg30Price: candidate.avg30Price,
        avg90Price: candidate.avg90Price,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown,
        engineVersion: candidate.engineVersion,
      };
      const summary = candidate.reasons[0] ?? null;

      if (active) {
        // The snapshot records the numbers at detection. Averages drift as time passes, so it
        // is only rewritten when the deal price itself changes — not on every re-evaluation.
        if (active.dealPrice === snapshot.dealPrice) return "unchanged";
        await deals.updateSnapshot(active.id, snapshot, summary);
        await audit.record({
          actorId: null,
          action: "deal.update",
          entityType: "Deal",
          entityId: active.id,
          diff: {
            from: {
              dealPrice: active.dealPrice,
              referencePrice: active.referencePrice,
              score: active.score,
            },
            to: {
              dealPrice: snapshot.dealPrice,
              referencePrice: snapshot.referencePrice,
              score: snapshot.score,
            },
          },
          createdAt: now,
        });
        return "updated";
      }

      if (mode === "verify") return "none";

      const submitted = transition("DETECTED", "submit", "system");
      const created = await deals.create({
        ...snapshot,
        slug: dealSlug(product.title, variant.id, now),
        productId: product.id,
        variantId: variant.id,
        retailerId: product.retailerId,
        status: submitted.ok ? submitted.to : "DETECTED",
        title: product.title,
        summary,
        imageUrl: product.imageUrl,
        detectedAt: now,
      });
      await audit.record({
        actorId: null,
        action: "deal.detect",
        entityType: "Deal",
        entityId: created.id,
        diff: { score: snapshot.score, reasons: candidate.reasons },
        createdAt: now,
      });
      return "created";
    });
  }

  async function reconcileAll(
    products: ProductForDetection[],
    now: Date,
    mode: "detect" | "verify",
  ): Promise<DetectionSummary> {
    const summary = emptySummary();
    for (const product of products) {
      try {
        summary[await reconcile(product, now, mode)] += 1;
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Another run created the active deal for this variant first.
          summary.unchanged += 1;
          continue;
        }
        summary.failed += 1;
        summary.errors.push({
          productId: product.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return summary;
  }

  return {
    /** Evaluates every active listing priced at or after `since`. */
    async detectChanged(params: { now: Date; since: Date }): Promise<DetectionSummary> {
      const products = await createProductRepository(client).listPricedSince(params.since);
      return reconcileAll(products, params.now, "detect");
    },

    /** Re-checks every active deal; expires or refreshes it but never creates new deals. */
    async verifyActive(params: { now: Date }): Promise<DetectionSummary> {
      const deals = await createDealRepository(client).listByStatus(ACTIVE_DEAL_STATUSES);
      const repo = createProductRepository(client);
      const products: ProductForDetection[] = [];
      let orphansExpired = 0;
      for (const productId of new Set(deals.map((d) => d.productId))) {
        const product = await repo.findForDetection(productId);
        if (!product) continue;
        products.push(product);
        // Deals left on a variant that is no longer the product's default can't be re-evaluated.
        for (const deal of deals.filter(
          (d) => d.productId === productId && d.variantId !== product.variants[0]?.id,
        )) {
          if (
            await expire(client, deal, "Variant is no longer the product's default", [], params.now)
          )
            orphansExpired++;
        }
      }
      const summary = await reconcileAll(products, params.now, "verify");
      summary.expired += orphansExpired;
      return summary;
    },
  };
}

export type DealDetectionService = ReturnType<typeof createDealDetectionService>;
