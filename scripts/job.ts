// Runs one background job locally against DATABASE_URL, exactly as the cron route would.
//
//   npm run job -- detect-deals
import "dotenv/config";
import { db } from "@/server/db/client";
import { isJobName, JOB_NAMES, runScheduledJob } from "@/server/jobs";

async function main() {
  const name = process.argv[2] ?? "";
  if (!isJobName(name)) throw new Error(`Usage: npm run job -- <${JOB_NAMES.join("|")}>`);
  console.log(JSON.stringify(await runScheduledJob(name), null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
