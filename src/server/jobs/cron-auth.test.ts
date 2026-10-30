import { describe, expect, it } from "vitest";
import { isAuthorisedCronRequest } from "./cron-auth";

const SECRET = "s3cret-value-that-is-long-enough-123456";

describe("isAuthorisedCronRequest", () => {
  it("accepts the exact bearer token", () => {
    expect(isAuthorisedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ["no header", null],
    ["an empty header", ""],
    ["the wrong secret", "Bearer nope"],
    ["the secret without the scheme", SECRET],
    ["a different scheme", `Basic ${SECRET}`],
    ["extra characters", `Bearer ${SECRET} `],
  ])("rejects %s", (_label, header) => {
    expect(isAuthorisedCronRequest(header, SECRET)).toBe(false);
  });

  it.each([undefined, ""])("fails closed when the secret is %j", (secret) => {
    expect(isAuthorisedCronRequest("Bearer ", secret)).toBe(false);
    expect(isAuthorisedCronRequest("Bearer undefined", secret)).toBe(false);
  });
});
