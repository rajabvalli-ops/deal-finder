import "server-only";
import { hasRole, type Role } from "@/server/auth/roles";
import { createAuditLogRepository } from "@/server/db/repositories/audit-log.repository";
import { createUserRepository } from "@/server/db/repositories/user.repository";
import { inTransaction } from "@/server/db/transaction";
import type { DbClient } from "@/server/db/types";
import { fail, ok, type Actor, type AdminResult } from "./result";

export function createAdminUsersService(client: DbClient) {
  return {
    /** Changes a user's role. Admins can't change their own role or remove the last admin. */
    setRole(params: { actor: Actor; userId: string; role: Role; now: Date }): Promise<AdminResult> {
      const { actor, userId, role, now } = params;
      if (!hasRole(actor.role, "ADMIN")) return Promise.resolve(fail("FORBIDDEN"));
      if (actor.id === userId) return Promise.resolve(fail("SELF_CHANGE"));

      return inTransaction(client, async (tx) => {
        const users = createUserRepository(tx);
        const target = await users.findById(userId);
        if (!target) return fail("NOT_FOUND");
        if (target.role === role) return ok(undefined);
        if (target.role === "ADMIN" && (await users.countByRole("ADMIN")) <= 1)
          return fail("LAST_ADMIN");

        await users.setRole(userId, role);
        await createAuditLogRepository(tx).record({
          actorId: actor.id,
          action: "user.set-role",
          entityType: "User",
          entityId: userId,
          diff: { from: target.role, to: role },
          createdAt: now,
        });
        return ok(undefined);
      });
    },
  };
}
