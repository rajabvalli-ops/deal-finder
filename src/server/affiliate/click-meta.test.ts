import { describe, expect, it } from "vitest";
import { clientIp, hashIp, isLikelyBot, sanitiseReferrer, truncateUserAgent } from "./click-meta";

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry", () => {
    expect(clientIp(headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then null", () => {
    expect(clientIp(headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(headers({ "x-forwarded-for": " ", "x-real-ip": " " }))).toBeNull();
    expect(clientIp(headers({}))).toBeNull();
  });

  it("caps absurdly long values", () => {
    expect(clientIp(headers({ "x-real-ip": "1".repeat(100) }))).toHaveLength(64);
  });
});

describe("hashIp", () => {
  const day1 = new Date("2026-09-30T08:00:00Z");
  const sameDay = new Date("2026-09-30T23:59:59Z");
  const day2 = new Date("2026-10-01T00:00:00Z");

  it("is stable within a UTC day and never contains the IP", () => {
    const hash = hashIp("203.0.113.7", "secret", day1);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toBe(hashIp("203.0.113.7", "secret", sameDay));
    expect(hash).not.toContain("203");
  });

  it("changes with the day, the secret and the IP", () => {
    const hash = hashIp("203.0.113.7", "secret", day1);
    expect(hashIp("203.0.113.7", "secret", day2)).not.toBe(hash);
    expect(hashIp("203.0.113.7", "other", day1)).not.toBe(hash);
    expect(hashIp("203.0.113.8", "secret", day1)).not.toBe(hash);
  });

  it("returns null without an IP", () => {
    expect(hashIp(null, "secret", day1)).toBeNull();
  });
});

describe("isLikelyBot", () => {
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "facebookexternalhit/1.1",
    "Slackbot-LinkExpanding 1.0",
    "WhatsApp/2.23",
    "curl/8.5.0",
    "python-requests/2.31",
    "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0",
  ])("flags %s", (ua) => {
    expect(isLikelyBot(ua)).toBe(true);
  });

  it("flags a missing user agent", () => {
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot("")).toBe(true);
  });

  it.each([
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ])("accepts browser %s", (ua) => {
    expect(isLikelyBot(ua)).toBe(false);
  });
});

describe("truncateUserAgent", () => {
  it("trims, caps and nulls empty values", () => {
    expect(truncateUserAgent("  Browser/1.0 ")).toBe("Browser/1.0");
    expect(truncateUserAgent("x".repeat(600))).toHaveLength(512);
    expect(truncateUserAgent("   ")).toBeNull();
    expect(truncateUserAgent(null)).toBeNull();
  });
});

describe("sanitiseReferrer", () => {
  it("keeps origin and path only", () => {
    expect(sanitiseReferrer("https://deals.example/deals/kettle?email=a@b.c#top")).toBe(
      "https://deals.example/deals/kettle",
    );
    expect(sanitiseReferrer("http://localhost:3000/")).toBe("http://localhost:3000/");
  });

  it("drops non-web and malformed referrers", () => {
    expect(sanitiseReferrer("android-app://com.example")).toBeNull();
    expect(sanitiseReferrer("not a url")).toBeNull();
    expect(sanitiseReferrer(null)).toBeNull();
    expect(sanitiseReferrer("")).toBeNull();
  });

  it("caps the length", () => {
    expect(sanitiseReferrer(`https://a.example/${"p".repeat(600)}`)).toHaveLength(512);
  });
});
