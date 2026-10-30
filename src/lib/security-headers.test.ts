import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

const toMap = (production: boolean) =>
  Object.fromEntries(securityHeaders({ production }).map((h) => [h.key, h.value]));

describe("securityHeaders", () => {
  it("locks down production", () => {
    const h = toMap(true);
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(h["Content-Security-Policy"]).toContain("upgrade-insecure-requests");
    expect(h["Content-Security-Policy"]).not.toContain("unsafe-eval");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(h).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
  });

  it("relaxes only what development tooling needs", () => {
    const h = toMap(false);
    expect(h["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(h["Content-Security-Policy"]).toContain("ws:");
    expect(h["Content-Security-Policy"]).not.toContain("upgrade-insecure-requests");
    expect(h["Strict-Transport-Security"]).toBeUndefined();
  });
});
