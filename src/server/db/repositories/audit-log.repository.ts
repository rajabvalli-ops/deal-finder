import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "../types";

export type AuditEntry = {
  /** Null for system actions (jobs, engines). */
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  diff?: Prisma.InputJsonValue;
  createdAt: Date;
};

export function createAuditLogRepository(client: DbClient) {
  return {
    record(entry: AuditEntry) {
      return client.auditLog.create({ data: entry });
    },

    listForEntity(entityType: string, entityId: string) {
      return client.auditLog.findMany({
        where: { entityType, entityId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
    },
  };
}
