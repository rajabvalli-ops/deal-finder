import { describe, expect, it } from "vitest";
import { shareSettingsFromEnv, socialConfigFromEnv } from "./config";

const keys = {
  X_API_KEY: "k",
  X_API_SECRET: "s",
  X_ACCESS_TOKEN: "t",
  X_ACCESS_TOKEN_SECRET: "ts",
};

describe("socialConfigFromEnv", () => {
  it("is off until all four X keys are set", () => {
    expect(socialConfigFromEnv({})).toBeNull();
    expect(socialConfigFromEnv({ ...keys, X_ACCESS_TOKEN_SECRET: " " })).toBeNull();
  });

  it("defaults to 10 posts a day of big drops and price errors, linking to our deal page", () => {
    expect(socialConfigFromEnv(keys)).toEqual({
      credentials: { apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts" },
      dailyLimit: 10,
      minLevel: "BIG_DROP",
      links: "deal-page",
      siteUrl: "http://localhost:3000",
    });
  });

  it("reads the optional settings, ignoring invalid ones", () => {
    expect(
      socialConfigFromEnv({
        ...keys,
        X_DAILY_POST_LIMIT: "3",
        X_POST_MIN_LEVEL: "price-error",
        X_POST_LINKS: "none",
        NEXT_PUBLIC_SITE_URL: "https://dealbroker.example/",
      }),
    ).toMatchObject({
      dailyLimit: 3,
      minLevel: "PRICE_ERROR",
      links: "none",
      siteUrl: "https://dealbroker.example",
    });
    expect(
      socialConfigFromEnv({ ...keys, X_DAILY_POST_LIMIT: "9999", X_POST_MIN_LEVEL: "huge" }),
    ).toMatchObject({ dailyLimit: 10, minLevel: "BIG_DROP" });
    expect(socialConfigFromEnv({ ...keys, X_DAILY_POST_LIMIT: "0" })?.dailyLimit).toBe(0);
  });
});

describe("shareSettingsFromEnv", () => {
  it("works without X keys and reads the retailer link mode", () => {
    expect(shareSettingsFromEnv({})).toEqual({
      dailyLimit: 10,
      minLevel: "BIG_DROP",
      links: "deal-page",
      siteUrl: "http://localhost:3000",
    });
    expect(shareSettingsFromEnv({ X_POST_LINKS: "retailer" }).links).toBe("retailer");
    expect(shareSettingsFromEnv({ X_POST_LINKS: "Amazon" }).links).toBe("retailer");
    expect(shareSettingsFromEnv({ X_POST_LINKS: "elsewhere" }).links).toBe("deal-page");
    expect(
      shareSettingsFromEnv({ VERCEL_PROJECT_PRODUCTION_URL: "deal-broker.vercel.app" }).siteUrl,
    ).toBe("https://deal-broker.vercel.app");
  });
});
