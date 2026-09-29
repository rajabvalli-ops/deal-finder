import type { DbClient } from "../types";

export function createJobLockRepository(client: DbClient) {
  return {
    /**
     * Takes the lock if it is free or its lease has expired. Atomic: of two concurrent
     * callers, exactly one gets `true`.
     */
    async acquire(name: string, owner: string, now: Date, leaseMs: number): Promise<boolean> {
      const lockedUntil = new Date(now.getTime() + leaseMs);
      const affected = await client.$executeRaw`
        INSERT INTO "JobLock" ("name", "owner", "lockedUntil", "acquiredAt")
        VALUES (${name}, ${owner}, ${lockedUntil}, ${now})
        ON CONFLICT ("name") DO UPDATE
          SET "owner" = EXCLUDED."owner",
              "lockedUntil" = EXCLUDED."lockedUntil",
              "acquiredAt" = EXCLUDED."acquiredAt"
          WHERE "JobLock"."lockedUntil" <= ${now}`;
      return affected === 1;
    },

    /** Releases the lock only if `owner` still holds it. */
    async release(name: string, owner: string): Promise<void> {
      await client.jobLock.deleteMany({ where: { name, owner } });
    },

    find(name: string) {
      return client.jobLock.findUnique({ where: { name } });
    },
  };
}
