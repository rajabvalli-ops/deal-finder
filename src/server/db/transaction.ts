import type { DbClient } from "./types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Runs `fn` in a transaction. If `client` is already a transaction client, `fn` joins it
 * instead of opening a nested one, so repositories compose inside service-level transactions.
 */
export async function inTransaction<T>(
  client: DbClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in client) return client.$transaction(fn);
  return fn(client);
}
