const BASE = "http://same-site.invalid";

/**
 * Returns `target` if it is a same-site path, otherwise `fallback`. Prevents open redirects
 * through `?next=` parameters (e.g. "//evil.example" or "https://evil.example").
 */
export function safeRedirectPath(target: string | null | undefined, fallback = "/"): string {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.includes("\\")) {
    return fallback;
  }
  // The URL parser drops tabs and newlines, so "/\t/evil.example" resolves off-site:
  // resolve it and check the origin rather than trusting the prefix checks alone.
  const url = new URL(target, BASE);
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
