import "server-only";
import { db } from "@/server/db/client";
import { runJob, type JobName, type JobReport } from "./jobs";

export { isAuthorisedCronRequest } from "./cron-auth";
export { isJobName, JOB_NAMES, type JobName, type JobReport } from "./jobs";

/** Entry point for cron routes and scripts: runs a job against the app database at the current time. */
export function runScheduledJob(name: JobName, now: Date = new Date()): Promise<JobReport> {
  return runJob(name, { client: db, now, env: process.env });
}
