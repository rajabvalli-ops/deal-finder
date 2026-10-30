import { afterAll, beforeEach } from "vitest";
import { createPrismaClient } from "@/server/db/client";
import { assertTestDatabase } from "./test-database";

export const testDb = createPrismaClient(assertTestDatabase());

beforeEach(async () => {
  const tables = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  if (list) await testDb.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await testDb.$disconnect();
});
