// Runs the reference-data seed (categories, Amazon UK) so E2E tests can rely on it. Idempotent.
import "dotenv/config";
import { runSeed } from "../../../prisma/seed/run-seed";
import { db } from "@/server/db/client";

runSeed(db, { includeDevelopmentData: false })
  .then(() => db.retailer.findUniqueOrThrow({ where: { slug: "amazon-uk" }, select: { id: true } }))
  .then((amazon) => console.log(JSON.stringify(amazon)))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
