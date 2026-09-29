import "server-only";
import { slugify } from "@/lib/slug";
import { createCategoryRepository } from "@/server/db/repositories/category.repository";
import { createImportRunRepository } from "@/server/db/repositories/import-run.repository";
import { createPriceHistoryRepository } from "@/server/db/repositories/price-history.repository";
import { createProductRepository } from "@/server/db/repositories/product.repository";
import { inTransaction } from "@/server/db/transaction";
import type { DbClient } from "@/server/db/types";
import { computePriceStats } from "@/server/pricing";
import {
  isAllowedUrl,
  normalisedPriceUpdateSchema,
  normalisedProductSchema,
  type NormalisedProduct,
  type RetailerAdapter,
} from "@/server/retailers";
import { DEFAULT_HEARTBEAT_MS, shouldRecordObservation } from "./observation-policy";
import { toPriceSnapshot } from "./price-snapshot";

const DAY_MS = 86_400_000;
/** History used for a product's cached price snapshot. */
const SNAPSHOT_HISTORY_MS = 365 * DAY_MS;
const MAX_ERROR_SAMPLE = 20;

type Status = "SUCCEEDED" | "PARTIAL" | "FAILED";

export type IngestionResult = {
  importRunId: string;
  status: Status;
  itemsSeen: number;
  itemsUpserted: number;
  itemsFailed: number;
  /** Set when the page limit was reached before the catalogue ended; pass back to resume. */
  nextCursor: string | null;
  errors: { externalId: string | null; message: string }[];
};

class ItemError extends Error {}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Turns normalised adapter output into catalogue rows, price history and price snapshots. */
export function createIngestionService(client: DbClient, options: { heartbeatMs?: number } = {}) {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const runs = createImportRunRepository(client);

  /** Records observations for a variant's new price and refreshes the product snapshot. */
  async function recordPrices(
    tx: DbClient,
    product: { id: string; defaultVariantId: string },
    variants: {
      id: string;
      price: number | null;
      availability: NormalisedProduct["availability"];
    }[],
    currency: string,
    now: Date,
    importRunId: string,
  ) {
    const history = createPriceHistoryRepository(tx);
    for (const v of variants) {
      if (v.price === null) continue;
      const latest = await history.latestForVariant(v.id);
      const next = { price: v.price, currency, availability: v.availability };
      if (shouldRecordObservation(latest, next, now, heartbeatMs)) {
        await history.record({ ...next, variantId: v.id, observedAt: now, importRunId });
      }
    }
    const observations = await history.listForVariant(product.defaultVariantId, {
      since: new Date(now.getTime() - SNAPSHOT_HISTORY_MS),
    });
    const stats = computePriceStats(observations, now);
    await createProductRepository(tx).updatePriceSnapshot(product.id, toPriceSnapshot(stats, now));
  }

  async function run(
    retailerId: string,
    jobType: "CATALOGUE_IMPORT" | "PRICE_REFRESH",
    now: Date,
    body: (ctx: {
      importRunId: string;
      process: (externalId: string | null, work: () => Promise<void>) => Promise<void>;
      setCursor: (cursor: string | null) => void;
      save: () => Promise<void>;
    }) => Promise<void>,
  ): Promise<IngestionResult> {
    const importRun = await runs.start(retailerId, jobType, now);
    const result: IngestionResult = {
      importRunId: importRun.id,
      status: "SUCCEEDED",
      itemsSeen: 0,
      itemsUpserted: 0,
      itemsFailed: 0,
      nextCursor: null,
      errors: [],
    };
    const progress = () => ({
      cursor: result.nextCursor,
      itemsSeen: result.itemsSeen,
      itemsUpserted: result.itemsUpserted,
      itemsFailed: result.itemsFailed,
      errorSample: result.errors.length ? result.errors.slice(0, MAX_ERROR_SAMPLE) : null,
    });
    const fail = (externalId: string | null, message: string) => {
      result.itemsFailed += 1;
      if (result.errors.length < MAX_ERROR_SAMPLE) result.errors.push({ externalId, message });
    };

    try {
      await body({
        importRunId: importRun.id,
        async process(externalId, work) {
          result.itemsSeen += 1;
          try {
            await work();
            result.itemsUpserted += 1;
          } catch (error) {
            fail(externalId, describeError(error));
          }
        },
        setCursor: (cursor) => {
          result.nextCursor = cursor;
        },
        save: async () => {
          await runs.saveProgress(importRun.id, progress());
        },
      });
      result.status =
        result.itemsFailed === 0 ? "SUCCEEDED" : result.itemsUpserted > 0 ? "PARTIAL" : "FAILED";
    } catch (error) {
      // The adapter itself failed (network, bad cursor…): keep what was processed so far.
      result.status = "FAILED";
      result.errors.push({ externalId: null, message: `Run aborted: ${describeError(error)}` });
    }
    await runs.finish(importRun.id, result.status, progress(), now);
    return result;
  }

  return {
    /**
     * Imports up to `maxPages` catalogue pages starting at `cursor`. One bad item never
     * stops the run: it is counted and sampled on the ImportRun instead.
     */
    importCatalogue(params: {
      retailerId: string;
      adapter: RetailerAdapter;
      now: Date;
      cursor?: string | null;
      pageSize?: number;
      maxPages?: number;
    }): Promise<IngestionResult> {
      const { retailerId, adapter, now, pageSize = 100, maxPages = 50 } = params;
      const categoryCache = new Map<string, string | null>();

      async function categoryIdFor(hint: string | null | undefined): Promise<string | null> {
        if (!hint) return null;
        const slug = slugify(hint);
        if (!categoryCache.has(slug)) {
          const category = await createCategoryRepository(client).findBySlug(slug);
          categoryCache.set(slug, category?.id ?? null);
        }
        return categoryCache.get(slug)!;
      }

      return run(retailerId, "CATALOGUE_IMPORT", now, async (ctx) => {
        let cursor = params.cursor ?? null;
        for (let page = 0; page < maxPages; page++) {
          const { items, nextCursor } = await adapter.fetchCatalogue({ cursor, limit: pageSize });
          for (const raw of items) {
            const rawId = typeof raw?.externalId === "string" ? raw.externalId : null;
            await ctx.process(rawId, async () => {
              const parsed = normalisedProductSchema.safeParse(raw);
              if (!parsed.success) {
                throw new ItemError(
                  `Invalid product: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
                );
              }
              const item = parsed.data;
              if (!isAllowedUrl(adapter, item.productUrl)) {
                throw new ItemError(`Product URL host is not allowed: ${item.productUrl}`);
              }
              const categoryId = await categoryIdFor(item.categoryHint);
              await inTransaction(client, async (tx) => {
                const product = await createProductRepository(tx).upsertListing({
                  retailerId,
                  externalId: item.externalId,
                  title: item.title,
                  brand: item.brand ?? null,
                  model: item.model ?? null,
                  gtin: item.gtin ?? null,
                  description: item.description ?? null,
                  imageUrl: item.imageUrl ?? null,
                  productUrl: item.productUrl,
                  categoryId,
                  currency: item.currency,
                  availability: item.availability,
                  rating: item.rating ?? null,
                  reviewCount: item.reviewCount ?? null,
                  seenAt: now,
                  variants: item.variants.map((v) => ({
                    externalId: v.externalId,
                    name: v.name,
                    attributes: v.attributes,
                    isDefault: v.isDefault,
                    currentPrice: v.price,
                    availability: v.availability,
                  })),
                });
                const idByExternal = new Map(product.variants.map((v) => [v.externalId, v.id]));
                await recordPrices(
                  tx,
                  {
                    id: product.id,
                    defaultVariantId: product.variants.find((v) => v.isDefault)!.id,
                  },
                  item.variants.map((v) => ({
                    id: idByExternal.get(v.externalId)!,
                    price: v.price,
                    availability: v.availability,
                  })),
                  item.currency,
                  now,
                  ctx.importRunId,
                );
              });
            });
          }
          cursor = nextCursor;
          ctx.setCursor(cursor);
          await ctx.save();
          if (cursor === null) break;
        }
      });
    },

    /** Refreshes prices for listings already in the catalogue. */
    importPrices(params: {
      retailerId: string;
      adapter: RetailerAdapter;
      now: Date;
      productExternalIds: readonly string[];
    }): Promise<IngestionResult> {
      const { retailerId, adapter, now, productExternalIds } = params;
      return run(retailerId, "PRICE_REFRESH", now, async (ctx) => {
        const products = await createProductRepository(client).findManyByExternalIds(
          retailerId,
          productExternalIds,
        );
        const byExternalId = new Map(products.map((p) => [p.externalId, p]));
        const updates = await adapter.fetchPrices(productExternalIds);

        for (const raw of updates) {
          const rawId = typeof raw?.productExternalId === "string" ? raw.productExternalId : null;
          await ctx.process(rawId, async () => {
            const parsed = normalisedPriceUpdateSchema.safeParse(raw);
            if (!parsed.success) throw new ItemError("Invalid price update");
            const update = parsed.data;
            const product = byExternalId.get(update.productExternalId);
            if (!product) throw new ItemError(`Unknown product ${update.productExternalId}`);
            const variantByExternal = new Map(product.variants.map((v) => [v.externalId, v]));
            const unknown = update.variants.find((v) => !variantByExternal.has(v.externalId));
            if (unknown) throw new ItemError(`Unknown variant ${unknown.externalId}`);

            await inTransaction(client, async (tx) => {
              const repo = createProductRepository(tx);
              const defaultVariant = product.variants.find((v) => v.isDefault)!;
              for (const v of update.variants) {
                await repo.updateVariantPrice(variantByExternal.get(v.externalId)!.id, {
                  currentPrice: v.price,
                  availability: v.availability,
                });
              }
              const defaultUpdate = update.variants.find(
                (v) => v.externalId === defaultVariant.externalId,
              );
              if (defaultUpdate)
                await repo.updateAvailability(product.id, defaultUpdate.availability, now);
              await recordPrices(
                tx,
                { id: product.id, defaultVariantId: defaultVariant.id },
                update.variants.map((v) => ({
                  id: variantByExternal.get(v.externalId)!.id,
                  price: v.price,
                  availability: v.availability,
                })),
                update.currency,
                now,
                ctx.importRunId,
              );
            });
          });
        }
        await ctx.save();
      });
    },
  };
}

export type IngestionService = ReturnType<typeof createIngestionService>;
