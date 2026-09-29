import { redirect } from "next/navigation";

/**
 * Redirects back to an admin page with a result code in the query string. `returnTo` comes
 * from a hidden form field, so only /admin paths are accepted.
 */
export function backTo(
  returnTo: FormDataEntryValue | null,
  fallback: string,
  params: Record<string, string>,
): never {
  const path =
    typeof returnTo === "string" && /^\/admin(\/|$|\?)/.test(returnTo) && !returnTo.includes("//")
      ? returnTo
      : fallback;
  const url = new URL(path, "http://admin.invalid");
  for (const key of ["notice", "error"]) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  redirect(`${url.pathname}${url.search}`);
}

/** FormData → plain object for Zod (last value wins; files ignored). */
export function formObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData) if (typeof value === "string") result[key] = value;
  return result;
}
