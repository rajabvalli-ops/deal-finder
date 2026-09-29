import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("defaults the site URL outside production", () => {
    expect(parseEnv({ NODE_ENV: "development" })).toEqual({
      NODE_ENV: "development",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    });
  });

  it("defaults NODE_ENV to development", () => {
    expect(parseEnv({}).NODE_ENV).toBe("development");
  });

  it("strips trailing slashes from the site URL", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://example.co.uk/",
    });
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("https://example.co.uk");
  });

  it("requires the site URL in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/NEXT_PUBLIC_SITE_URL is required/);
  });

  it("rejects an invalid site URL", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SITE_URL: "not a url" })).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it("rejects non-http protocols", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" })).toThrow();
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseEnv({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
