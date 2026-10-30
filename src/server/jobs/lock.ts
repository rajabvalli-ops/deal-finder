import { randomUUID } from "node:crypto";
import { createJobLockRepository } from "@/server/db/repositories/job-lock.repository";
import type { DbClient } from "@/server/db/types";

export type LockedResult<T> =
  { status: "completed"; result: T } | { status: "skipped"; reason: string };

/**
 * Runs `fn` only if no other instance of job `name` holds the lock. The lease bounds how
 * long a crashed run can block the job; it should exceed the job's maximum duration.
 */
export async function withJobLock<T>(
  client: DbClient,
  name: string,
  now: Date,
  leaseMs: number,
  fn: () => Promise<T>,
): Promise<LockedResult<T>> {
  const locks = createJobLockRepository(client);
  const owner = randomUUID();
  if (!(await locks.acquire(name, owner, now, leaseMs))) {
    return { status: "skipped", reason: `Job "${name}" is already running` };
  }
  try {
    return { status: "completed", result: await fn() };
  } finally {
    await locks.release(name, owner);
  }
}
