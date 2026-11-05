import { describe, expect, it } from "vitest";
import { buildDealTweet, MAX_TWEET_LENGTH, tweetLength, type TweetDeal } from "./social";

const deal: TweetDeal = {
  title: "Oust Descaler 18 Sachets",
  dealPrice: 306,
  referencePrice: 2040,
  referenceType: "AVG_30",
  discountBps: 8500,
  retailerName: "Amazon UK",
  level: "PRICE_ERROR",
};
const URL = "https://dealbroker.example/deals/oust-descaler-18-sachets-abc123";

describe("buildDealTweet", () => {
  it("writes a price-error post with the price first, a warning, the link and #ad", () => {
    expect(buildDealTweet(deal, URL)).toBe(
      [
        "🚨 PRICE ERROR?",
        "",
        "£3.06 for Oust Descaler 18 Sachets",
        "30-day average £20.40 · 85% off at Amazon UK",
        "",
        "Could be corrected or cancelled any minute.",
        "",
        URL,
        "",
        "#ad",
      ].join("\n"),
    );
  });

  it("labels big drops and ordinary deals, and names the comparison honestly", () => {
    const big = buildDealTweet(
      { ...deal, level: "BIG_DROP", referenceType: "PREVIOUS", discountBps: 4000 },
      null,
    );
    expect(big).toBe(
      [
        "📉 BIG PRICE DROP",
        "",
        "£3.06 for Oust Descaler 18 Sachets",
        "Was £20.40 · 40% off at Amazon UK",
        "",
        "#ad",
      ].join("\n"),
    );
    expect(buildDealTweet({ ...deal, level: "NORMAL", referenceType: "AVG_90" }, null)).toMatch(
      /^🔥 DEAL\n[\s\S]*90-day average £20\.40/,
    );
  });

  it("shortens long product names to fit", () => {
    const tweet = buildDealTweet({ ...deal, title: "Kettle ".repeat(60).trim() }, URL);
    expect(tweetLength(tweet)).toBeLessThanOrEqual(MAX_TWEET_LENGTH);
    expect(tweet).toMatch(/£3\.06 for Kettle Kettle .*…\n/);
    expect(tweet).toContain(URL);
    expect(tweet.endsWith("#ad")).toBe(true);
  });
});

describe("tweetLength", () => {
  it("counts like X: URLs 23, emoji and CJK 2, Latin and punctuation 1", () => {
    expect(tweetLength("abc")).toBe(3);
    expect(tweetLength("£3.06 — ok")).toBe(10);
    expect(tweetLength("🚨")).toBe(2);
    expect(tweetLength("価格")).toBe(4);
    expect(tweetLength(`see ${URL}`)).toBe(4 + 23);
    expect(tweetLength("‘quoted’ ′")).toBe(10);
  });
});
