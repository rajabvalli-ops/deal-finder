export const ROLES = ["USER", "EDITOR", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { USER: 0, EDITOR: 1, ADMIN: 2 };

/** EDITOR can review and publish deals; ADMIN can also manage retailers and users. */
export function hasRole(userRole: string, required: Role): boolean {
  return (
    (ROLES as readonly string[]).includes(userRole) && RANK[userRole as Role] >= RANK[required]
  );
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
