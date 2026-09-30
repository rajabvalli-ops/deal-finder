import type { Role } from "@/generated/prisma/enums";
import type { DbClient } from "../types";

export function createUserRepository(client: DbClient) {
  return {
    findById(id: string) {
      return client.user.findUnique({
        where: { id },
        select: { id: true, email: true, role: true },
      });
    },

    countByRole(role: Role): Promise<number> {
      return client.user.count({ where: { role } });
    },

    setRole(id: string, role: Role) {
      return client.user.update({
        where: { id },
        data: { role },
        select: { id: true, role: true },
      });
    },
  };
}
