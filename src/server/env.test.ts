import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

describe("parseEnv", () => {
  it("defaults the site URL outside production", () => {
    expect(parseEnv({ NODE_ENV: "development", DATABASE_URL })).toEqual({
      NODE_ENV: "development",
      DATABASE_URL,
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    });
  });

  it("defaults NODE_ENV to development", () => {
    expect(parseEnv({ DATABASE_URL }).NODE_ENV).toBe("development");
  });

  it("strips trailing slashes from the site URL", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL,
      NEXT_PUBLIC_SITE_URL: "https://example.co.uk/",
    });
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("https://example.co.uk");
  });

  it("requires the site URL in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production", DATABASE_URL })).toThrow(
      /NEXT_PUBLIC_SITE_URL is required/,
    );
  });

  it("rejects an invalid site URL", () => {
    expect(() => parseEnv({ DATABASE_URL, NEXT_PUBLIC_SITE_URL: "not a url" })).toThrow(
      /NEXT_PUBLIC_SITE_URL/,
    );
  });

  it("rejects non-http site URL protocols", () => {
    expect(() => parseEnv({ DATABASE_URL, NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" })).toThrow();
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseEnv({ DATABASE_URL, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it("requires DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it.each(["postgres://u:p@host/db", "postgresql://u:p@host:6543/db?sslmode=require"])(
    "accepts the Postgres URL %s",
    (url) => {
      expect(parseEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
    },
  );

  it("rejects a non-Postgres DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://u:p@host/db" })).toThrow(
      /postgres:\/\/ or postgresql:\/\//,
    );
  });
});
