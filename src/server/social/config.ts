import type { DealLevel } from "@/lib/public-types";
import type { XCredentials } from "./x-client";

// Social posting settings, all from the environment. The share settings (what to post and how
// to link) always apply; the X API keys are only needed for fully automatic posting. Without
// them the site prepares each post for a person to send ("tap to tweet"), which costs nothing.

export const SOCIAL_ENV = {
  apiKey: "X_API_KEY",
  apiSecret: "X_API_SECRET",
  accessToken: "X_ACCESS_TOKEN",
  accessTokenSecret: "X_ACCESS_TOKEN_SECRET",
  dailyLimit: "X_DAILY_POST_LIMIT",
  minLevel: "X_POST_MIN_LEVEL",
  links: "X_POST_LINKS",
} as const;

/**
 * Where a post links: our deal page; straight to the retailer through the product's
 * affiliate link (for Amazon: the tagged amazon.co.uk page, so X shows Amazon's preview); or
 * no link (much cheaper through X's API).
 */
export type LinkMode = "deal-page" | "retailer" | "none";

export type ShareSettings = {
  /** Posts allowed in any 24 hours (X charges per API post). */
  dailyLimit: number;
  /** Deals at this level or above are posted (or offered for posting). */
  minLevel: DealLevel;
  links: LinkMode;
  siteUrl: string;
};

export type SocialConfig = ShareSettings & { credentials: XCredentials };

const DEFAULT_DAILY_LIMIT = 10;
const MAX_DAILY_LIMIT = 200;
const LEVELS: readonly DealLevel[] = ["NORMAL", "BIG_DROP", "PRICE_ERROR"];

type Env = Readonly<Record<string, string | undefined>>;
const reader = (env: Env) => (key: string) => env[key]?.trim() || undefined;

/** What to post and how to link it. Invalid values fall back to the defaults. */
export function shareSettingsFromEnv(env: Env): ShareSettings {
  const value = reader(env);
  const limit = Number(value(SOCIAL_ENV.dailyLimit));
  const level = value(SOCIAL_ENV.minLevel)?.toUpperCase().replace(/-/g, "_");
  const links = value(SOCIAL_ENV.links)?.toLowerCase();
  return {
    dailyLimit:
      Number.isInteger(limit) && limit >= 0 && limit <= MAX_DAILY_LIMIT
        ? limit
        : DEFAULT_DAILY_LIMIT,
    minLevel: LEVELS.includes(level as DealLevel) ? (level as DealLevel) : "BIG_DROP",
    links:
      links === "none"
        ? "none"
        : links === "retailer" || links === "amazon"
          ? "retailer"
          : "deal-page",
    siteUrl: (value("NEXT_PUBLIC_SITE_URL") ?? "http://localhost:3000").replace(/\/+$/, ""),
  };
}

/** Settings for automatic posting through X's API, or null when the X keys aren't set. */
export function socialConfigFromEnv(env: Env): SocialConfig | null {
  const value = reader(env);
  const apiKey = value(SOCIAL_ENV.apiKey);
  const apiSecret = value(SOCIAL_ENV.apiSecret);
  const accessToken = value(SOCIAL_ENV.accessToken);
  const accessTokenSecret = value(SOCIAL_ENV.accessTokenSecret);
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  return {
    credentials: { apiKey, apiSecret, accessToken, accessTokenSecret },
    ...shareSettingsFromEnv(env),
  };
}
