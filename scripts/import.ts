// Development helper: runs a catalogue import for one retailer against DATABASE_URL.
//
//   npm run import                          # mock-retailer, now
//   npm run import -- --backfill-days 90    # replay the last 90 days (mock adapter only)
//   npm run import -- --retailer <slug>
//
// Scheduled production imports arrive with the background-jobs stage.
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "@/server/db/client";
import { createRetailerRepository } from "@/server/db/repositories/retailer.repository";
import { createAdapter } from "@/server/retailers";
import { createIngestionService } from "@/server/services/ingestion/ingestion.service";

const DAY_MS = 86_400_000;

const { values } = parseArgs({
  options: {
    retailer: { type: "string", default: "mock-retailer" },
    "backfill-days": { type: "string", default: "0" },
  },
});

async function main() {
  const retailer = await createRetailerRepository(db).findBySlug(values.retailer);
  if (!retailer) throw new Error(`Retailer "${values.retailer}" not found — run npm run db:seed?`);

  const backfillDays = Number.parseInt(values["backfill-days"], 10);
  if (!Number.isInteger(backfillDays) || backfillDays < 0)
    throw new Error("--backfill-days must be ≥ 0");
  if (backfillDays > 0 && retailer.integrationType !== "MOCK") {
    throw new Error("Backfilling replays past dates and is only meaningful for the mock adapter");
  }

  const ingestion = createIngestionService(db);
  const today = Date.now();
  for (let d = backfillDays; d >= 0; d--) {
    const now = new Date(today - d * DAY_MS);
    const adapter = createAdapter(retailer, { now: () => now, env: process.env });
    const result = await ingestion.importCatalogue({ retailerId: retailer.id, adapter, now });
    console.log(
      `${now.toISOString().slice(0, 10)} ${result.status} seen=${result.itemsSeen} ` +
        `upserted=${result.itemsUpserted} failed=${result.itemsFailed}`,
    );
    for (const e of result.errors) console.log(`  ✗ ${e.externalId ?? "-"}: ${e.message}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
