export const site = {
  name: "Deal Broker",
  tagline:
    "Your source for UK deals — price errors and price drops, checked against real price history.",
} as const;

export const primaryNav = [
  { href: "/deals", label: "Deals" },
  { href: "/price-drops", label: "Price drops" },
  { href: "/search", label: "Search" },
  { href: "/alerts", label: "Price alerts" },
] as const;

/**
 * The site's public address: NEXT_PUBLIC_SITE_URL when set, otherwise the production domain
 * Vercel provides (VERCEL_PROJECT_PRODUCTION_URL, without a scheme), otherwise null.
 */
export function siteUrlFromEnv(env: Readonly<Record<string, string | undefined>>): string | null {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const url = explicit || (vercel ? `https://${vercel}` : "");
  return url ? url.replace(/\/+$/, "") : null;
}
