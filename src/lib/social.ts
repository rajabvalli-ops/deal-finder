import { formatBps, formatPrice } from "./money";
import type { DealLevel, ReferenceType } from "./public-types";

// Text of the posts the site makes about deals on social networks (the brand's X account).
// Built only from the deal engine's numbers, like every other price claim on the site.

export const MAX_TWEET_LENGTH = 280;
/** X counts every link as this many characters (it shortens them to t.co). */
const TWEET_URL_LENGTH = 23;

const HEADLINE: Record<DealLevel, string> = {
  NORMAL: "🔥 DEAL",
  BIG_DROP: "📉 BIG PRICE DROP",
  PRICE_ERROR: "🚨 PRICE ERROR?",
};

/** How the comparison price is described — never a bare "was" for an average. */
const REFERENCE_LABEL: Record<ReferenceType, string> = {
  PREVIOUS: "Was",
  AVG_30: "30-day average",
  AVG_90: "90-day average",
};

export type TweetDeal = {
  title: string;
  dealPrice: number;
  referencePrice: number;
  referenceType: ReferenceType;
  discountBps: number;
  retailerName: string;
  level: DealLevel;
};

/**
 * Characters as X counts them: most Latin text counts 1, other scripts and emoji 2, and
 * every URL 23 whatever its real length.
 */
export function tweetLength(text: string): number {
  let length = 0;
  const withoutUrls = text.replace(/https?:\/\/\S+/g, () => {
    length += TWEET_URL_LENGTH;
    return "";
  });
  for (const char of withoutUrls) {
    const code = char.codePointAt(0)!;
    const light =
      code <= 4351 ||
      (code >= 8192 && code <= 8205) ||
      (code >= 8208 && code <= 8223) ||
      (code >= 8242 && code <= 8247);
    length += light ? 1 : 2;
  }
  return length;
}

function compose(deal: TweetDeal, title: string, url: string | null): string {
  const lines = [
    HEADLINE[deal.level],
    "",
    `${formatPrice(deal.dealPrice)} for ${title}`,
    `${REFERENCE_LABEL[deal.referenceType]} ${formatPrice(deal.referencePrice)} · ${formatBps(deal.discountBps)} off at ${deal.retailerName}`,
  ];
  if (deal.level === "PRICE_ERROR") lines.push("", "Could be corrected or cancelled any minute.");
  if (url) lines.push("", url);
  // Affiliate posts must be labelled as ads (ASA/CAP code; Amazon Associates rules).
  lines.push("", "#ad");
  return lines.join("\n");
}

/** The post for a deal, shortening the product name if needed to fit X's limit. */
export function buildDealTweet(deal: TweetDeal, url: string | null): string {
  const full = compose(deal, deal.title, url);
  if (tweetLength(full) <= MAX_TWEET_LENGTH) return full;
  const spare = MAX_TWEET_LENGTH - tweetLength(compose(deal, "…", url));
  const chars = [...deal.title];
  let title = "";
  for (const char of chars) {
    if (tweetLength(`${title}${char}`) > spare) break;
    title += char;
  }
  return compose(deal, `${title.trimEnd()}…`, url);
}
