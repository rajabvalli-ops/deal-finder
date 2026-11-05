import "server-only";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { createMemoryRateLimiter } from "@/server/rate-limit/rate-limiter";
import { createReportsService } from "./reports.service";

export type { ReportGroup, ReportResult } from "./reports.service";

/** Per-instance: 10 reports per reporter per 10 minutes is plenty for a person. */
const reportRateLimiter = createMemoryRateLimiter({ limit: 10, windowMs: 10 * 60_000 });

export const reports = createReportsService(db, {
  // Domain-separated inside hashIp, so reusing the auth secret leaks nothing about either.
  hashSecret: env.BETTER_AUTH_SECRET,
  rateLimiter: reportRateLimiter,
});
