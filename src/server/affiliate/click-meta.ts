import { createHmac } from "node:crypto";

// Turns request details into what a Click row may store. Raw IP addresses are never stored:
// only a keyed hash that changes every day, so clicks can be de-duplicated and rate-limited
// within a day but not linked across days or reversed.

const MAX_TEXT = 512;

/**
 * The client IP from proxy headers. On Vercel the platform sets these, so the first
 * x-forwarded-for entry is the client; elsewhere they can be spoofed, which only affects
 * rate limiting and de-duplication, never access.
 */
export function clientIp(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim();
  return ip ? ip.slice(0, 64) : null;
}

/** HMAC of the IP with a key that includes the UTC day, so hashes rotate daily. */
export function hashIp(ip: string | null, secret: string, now: Date): string | null {
  if (!ip) return null;
  const day = now.toISOString().slice(0, 10);
  return createHmac("sha256", `click-ip:${day}:${secret}`).update(ip).digest("hex").slice(0, 32);
}

// Crawlers, link unfurlers, monitoring and scripted clients. Deliberately broad: a false
// positive only excludes a click from reports, it never blocks the redirect.
const BOT_PATTERN =
  /bot|crawl|spider|slurp|scrape|preview|fetch|monitor|headless|lighthouse|facebookexternalhit|embedly|whatsapp|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|undici|libwww|httpclient/i;

export function isLikelyBot(userAgent: string | null): boolean {
  return !userAgent || BOT_PATTERN.test(userAgent);
}

export function truncateUserAgent(userAgent: string | null): string | null {
  const trimmed = userAgent?.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null;
}

/** Origin and path only: query strings and fragments can carry personal data. */
export function sanitiseReferrer(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`.slice(0, MAX_TEXT);
  } catch {
    return null;
  }
}
