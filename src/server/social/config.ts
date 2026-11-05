import type { DealLevel } from "@/lib/public-types";
import type { XCredentials } from "./x-client";

// Auto-posting settings, all from the environment. Without the four X keys nothing is
// queued or posted, so the feature costs nothing until it is switched on.

export const SOCIAL_ENV = {
  apiKey: "X_API_KEY",
  apiSecret: "X_API_SECRET",
  accessToken: "X_ACCESS_TOKEN",
  accessTokenSecret: "X_ACCESS_TOKEN_SECRET",
  dailyLimit: "X_DAILY_POST_LIMIT",
  minLevel: "X_POST_MIN_LEVEL",
  links: "X_POST_LINKS",
} as const;

export type LinkMode = "deal-page" | "none";

export type SocialConfig = {
  credentials: XCredentials;
  /** Posts allowed in any 24 hours (X charges per post). */
  dailyLimit: number;
  /** Deals at this level or above are posted automatically. */
  minLevel: DealLevel;
  /** Link to the deal page on our site, or post without a link (much cheaper on X). */
  links: LinkMode;
  siteUrl: string;
};

const DEFAULT_DAILY_LIMIT = 10;
const MAX_DAILY_LIMIT = 200;
const LEVELS: readonly DealLevel[] = ["NORMAL", "BIG_DROP", "PRICE_ERROR"];

/** Settings, or null when X isn't connected. Invalid optional values fall back to defaults. */
export function socialConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): SocialConfig | null {
  const value = (key: string) => env[key]?.trim() || undefined;
  const apiKey = value(SOCIAL_ENV.apiKey);
  const apiSecret = value(SOCIAL_ENV.apiSecret);
  const accessToken = value(SOCIAL_ENV.accessToken);
  const accessTokenSecret = value(SOCIAL_ENV.accessTokenSecret);
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;

  const limit = Number(value(SOCIAL_ENV.dailyLimit));
  const level = value(SOCIAL_ENV.minLevel)?.toUpperCase().replace(/-/g, "_");
  return {
    credentials: { apiKey, apiSecret, accessToken, accessTokenSecret },
    dailyLimit:
      Number.isInteger(limit) && limit >= 0 && limit <= MAX_DAILY_LIMIT
        ? limit
        : DEFAULT_DAILY_LIMIT,
    minLevel: LEVELS.includes(level as DealLevel) ? (level as DealLevel) : "BIG_DROP",
    links: value(SOCIAL_ENV.links) === "none" ? "none" : "deal-page",
    siteUrl: (value("NEXT_PUBLIC_SITE_URL") ?? "http://localhost:3000").replace(/\/+$/, ""),
  };
}
