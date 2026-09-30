import "server-only";
import { createImportRunRepository } from "@/server/db/repositories/import-run.repository";
import { createProductRepository } from "@/server/db/repositories/product.repository";
import { createRetailerRepository } from "@/server/db/repositories/retailer.repository";
import type { DbClient, Retailer } from "@/server/db/types";
import { ACTIVE_DEAL_STATUSES } from "@/server/deals/workflow";
import { createAdapter, type RetailerAdapter } from "@/server/retailers";
import {
  createDealDetectionService,
  type DetectionSummary,
} from "@/server/services/deals/deal-detection.service";
import {
  createIngestionService,
  type IngestionResult,
} from "@/server/services/ingestion/ingestion.service";
import { withJobLock } from "./lock";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export const JOB_NAMES = [
  "import-catalogue",
  "refresh-prices",
  "detect-deals",
  "expire-deals",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

export type JobContext = {
  client: DbClient;
  now: Date;
  env: Readonly<Record<string, string | undefined>>;
};

export type JobSettings = {
  /** Catalogue pages per retailer per run (keeps each run within the function time limit). */
  cataloguePagesPerRun: number;
  cataloguePageSize: number;
  /** Listings not seen by a completed catalogue pass for this long are marked inactive. */
  delistAfterMs: number;
  pricesPerRetailerPerRun: number;
  /** detect-deals looks at listings priced within this window. */
  detectWindowMs: number;
};

export const DEFAULT_JOB_SETTINGS: JobSettings = {
  cataloguePagesPerRun: 20,
  cataloguePageSize: 100,
  delistAfterMs: 3 * DAY_MS,
  pricesPerRetailerPerRun: 200,
  detectWindowMs: 26 * 3_600_000,
};

type RetailerOutcome = {
  retailer: string;
  import?: Pick<
    IngestionResult,
    "status" | "itemsSeen" | "itemsUpserted" | "itemsFailed" | "nextCursor"
  >;
  delisted?: number;
  error?: string;
};

export type JobReport =
  | {
      job: JobName;
      status: "completed";
      retailers?: RetailerOutcome[];
      deals?: Omit<DetectionSummary, "errors"> & { errors: number };
    }
  | { job: JobName; status: "skipped"; reason: string };

const LEASES: Record<JobName, number> = {
  "import-catalogue": 15 * MINUTE_MS,
  "refresh-prices": 15 * MINUTE_MS,
  "detect-deals": 10 * MINUTE_MS,
  "expire-deals": 10 * MINUTE_MS,
};

function summarise(summary: DetectionSummary) {
  const { errors, ...counts } = summary;
  for (const e of errors)
    console.error(`Deal detection failed for product ${e.productId}: ${e.message}`);
  return { ...counts, errors: errors.length };
}

function trimImport(result: IngestionResult): RetailerOutcome["import"] {
  const { status, itemsSeen, itemsUpserted, itemsFailed, nextCursor } = result;
  return { status, itemsSeen, itemsUpserted, itemsFailed, nextCursor };
}

async function forEachActiveRetailer(
  ctx: JobContext,
  work: (
    retailer: Retailer,
    adapter: RetailerAdapter,
  ) => Promise<Omit<RetailerOutcome, "retailer"> | null>,
): Promise<RetailerOutcome[]> {
  const outcomes: RetailerOutcome[] = [];
  for (const retailer of await createRetailerRepository(ctx.client).listByStatus("ACTIVE")) {
    try {
      const adapter = createAdapter(retailer, { now: () => ctx.now, env: ctx.env });
      const outcome = await work(retailer, adapter);
      if (outcome) outcomes.push({ retailer: retailer.slug, ...outcome });
    } catch (error) {
      // One broken integration must not stop the others.
      outcomes.push({
        retailer: retailer.slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}

const JOBS: Record<
  JobName,
  (
    ctx: JobContext,
    settings: JobSettings,
  ) => Promise<Omit<Extract<JobReport, { status: "completed" }>, "job" | "status">>
> = {
  /** Imports (or resumes importing) each active retailer's catalogue, then detects deals. */
  async "import-catalogue"(ctx, settings) {
    const ingestion = createIngestionService(ctx.client);
    const runs = createImportRunRepository(ctx.client);
    const retailers = await forEachActiveRetailer(ctx, async (retailer, adapter) => {
      if (!adapter.capabilities.catalogue) return null;
      const previous = await runs.latestFor(retailer.id, "CATALOGUE_IMPORT");
      const result = await ingestion.importCatalogue({
        retailerId: retailer.id,
        adapter,
        now: ctx.now,
        cursor: previous?.cursor ?? null,
        pageSize: settings.cataloguePageSize,
        maxPages: settings.cataloguePagesPerRun,
      });
      // Only a pass that reached the end of the catalogue proves which listings disappeared.
      const completedPass = result.nextCursor === null && result.status !== "FAILED";
      const delisted = completedPass
        ? await createProductRepository(ctx.client).deactivateNotSeenSince(
            retailer.id,
            new Date(ctx.now.getTime() - settings.delistAfterMs),
          )
        : 0;
      return { import: trimImport(result), delisted };
    });
    const deals = await createDealDetectionService(ctx.client).detectChanged({
      now: ctx.now,
      since: ctx.now,
    });
    return { retailers, deals: summarise(deals) };
  },

  /** Re-prices the most important listings of each retailer, then detects deals on them. */
  async "refresh-prices"(ctx, settings) {
    const ingestion = createIngestionService(ctx.client);
    const products = createProductRepository(ctx.client);
    const retailers = await forEachActiveRetailer(ctx, async (retailer, adapter) => {
      if (!adapter.capabilities.priceLookup) return null;
      const targets = await products.listForPriceRefresh(
        retailer.id,
        ACTIVE_DEAL_STATUSES,
        settings.pricesPerRetailerPerRun,
      );
      if (targets.length === 0) return null;
      const result = await ingestion.importPrices({
        retailerId: retailer.id,
        adapter,
        now: ctx.now,
        productExternalIds: targets.map((p) => p.externalId),
      });
      return { import: trimImport(result) };
    });
    const deals = await createDealDetectionService(ctx.client).detectChanged({
      now: ctx.now,
      since: ctx.now,
    });
    return { retailers, deals: summarise(deals) };
  },

  async "detect-deals"(ctx, settings) {
    const since = new Date(ctx.now.getTime() - settings.detectWindowMs);
    const deals = await createDealDetectionService(ctx.client).detectChanged({
      now: ctx.now,
      since,
    });
    return { deals: summarise(deals) };
  },

  async "expire-deals"(ctx) {
    const deals = await createDealDetectionService(ctx.client).verifyActive({ now: ctx.now });
    return { deals: summarise(deals) };
  },
};

/** Runs a job under its lock. Returns "skipped" if another instance is already running. */
export async function runJob(
  name: JobName,
  ctx: JobContext,
  settings: JobSettings = DEFAULT_JOB_SETTINGS,
): Promise<JobReport> {
  const locked = await withJobLock(ctx.client, name, ctx.now, LEASES[name], () =>
    JOBS[name](ctx, settings),
  );
  return locked.status === "completed"
    ? { job: name, status: "completed", ...locked.result }
    : { job: name, status: "skipped", reason: locked.reason };
}
