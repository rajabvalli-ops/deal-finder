import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/admin", "/admin"],
    ["/admin/deals?status=PENDING_REVIEW#top", "/admin/deals?status=PENDING_REVIEW#top"],
    ["/", "/"],
  ])("allows %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "admin",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example/admin",
    "javascript:alert(1)",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
  ])("falls back for %j", (input) => {
    expect(safeRedirectPath(input, "/home")).toBe("/home");
  });
});
