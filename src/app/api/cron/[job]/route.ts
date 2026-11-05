import { env } from "@/server/env";
import { isAuthorisedCronRequest, isJobName, runScheduledJob } from "@/server/jobs";

// Jobs process bounded batches; raise this if the hosting plan allows longer functions.
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

/**
 * Called on a schedule by GitHub Actions (.github/workflows/scheduled-jobs.yml) with
 * `Authorization: Bearer $CRON_SECRET`; any scheduler sending that header works.
 */
export async function GET(request: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!env.CRON_SECRET) {
    return Response.json({ error: "Cron is not configured" }, { status: 503, headers: noStore });
  }
  if (!isAuthorisedCronRequest(request.headers.get("authorization"), env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  }
  const { job } = await params;
  if (!isJobName(job)) {
    return Response.json({ error: "Unknown job" }, { status: 404, headers: noStore });
  }
  try {
    const report = await runScheduledJob(job);
    console.info(`[cron] ${job}`, JSON.stringify(report));
    return Response.json(report, { headers: noStore });
  } catch (error) {
    console.error(`[cron] ${job} failed`, error);
    return Response.json({ job, status: "failed" }, { status: 500, headers: noStore });
  }
}
