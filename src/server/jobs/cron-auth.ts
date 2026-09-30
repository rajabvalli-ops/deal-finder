import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Checks `Authorization: Bearer <CRON_SECRET>` in constant time (hashing first so the
 * comparison leaks neither content nor length). Fails closed when no secret is configured.
 */
export function isAuthorisedCronRequest(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !authorization) return false;
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
