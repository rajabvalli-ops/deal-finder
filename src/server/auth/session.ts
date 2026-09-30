import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "./auth";
import { hasRole, isRole, type Role } from "./roles";

export type CurrentUser = { id: string; email: string; name: string; role: Role };

/** The signed-in user, or null. Reads the session from the database on every call. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const role = String((session.user as { role?: unknown }).role ?? "USER");
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: isRole(role) ? role : "USER",
  };
}

/**
 * For pages, layouts and Server Actions. Signed-out visitors are sent to sign in and then
 * back to `returnTo`; signed-in users without the role get a 404, so admin pages don't
 * reveal that they exist.
 */
export async function requireRole(required: Role, returnTo = "/"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  if (!hasRole(user.role, required)) notFound();
  return user;
}
