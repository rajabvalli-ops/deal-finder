import "server-only";
import { db } from "@/server/db/client";

export type HealthReport = { status: "ok" | "error"; database: "ok" | "unreachable" };

export async function checkHealth(): Promise<HealthReport> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok" };
  } catch (error) {
    console.error("Health check: database unreachable", error);
    return { status: "error", database: "unreachable" };
  }
}
