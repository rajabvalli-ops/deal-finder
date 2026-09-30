import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "./rate-limiter";

const T = new Date(Date.UTC(2026, 0, 1));
const later = (ms: number) => new Date(T.getTime() + ms);

describe("createMemoryRateLimiter", () => {
  it("allows up to the limit per window, then blocks until the window resets", async () => {
    const limiter = createMemoryRateLimiter({ limit: 2, windowMs: 1000 });
    expect(await limiter.consume("ip", T)).toEqual({
      allowed: true,
      remaining: 1,
      resetAt: later(1000),
    });
    expect(await limiter.consume("ip", later(10))).toMatchObject({ allowed: true, remaining: 0 });
    expect(await limiter.consume("ip", later(999))).toMatchObject({ allowed: false, remaining: 0 });
    expect(await limiter.consume("ip", later(1000))).toMatchObject({
      allowed: true,
      remaining: 1,
      resetAt: later(2000),
    });
  });

  it("counts keys independently", async () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 1000 });
    expect((await limiter.consume("a", T)).allowed).toBe(true);
    expect((await limiter.consume("b", T)).allowed).toBe(true);
    expect((await limiter.consume("a", T)).allowed).toBe(false);
  });

  it("uses the current time by default", async () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    expect((await limiter.consume("k")).allowed).toBe(true);
    expect((await limiter.consume("k")).allowed).toBe(false);
  });

  it("bounds memory by evicting expired, then oldest, windows", async () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    await limiter.consume("a", T);
    await limiter.consume("b", later(500));
    await limiter.consume("c", later(600)); // full: nothing expired yet → evicts "a"
    expect((await limiter.consume("a", later(700))).allowed).toBe(true); // "a" was forgotten
    await limiter.consume("d", later(1600)); // "b" (and "c") expired → evicted
    expect((await limiter.consume("d", later(1601))).allowed).toBe(false);
  });

  it.each([
    [{ limit: 0, windowMs: 1000 }],
    [{ limit: 1.5, windowMs: 1000 }],
    [{ limit: 1, windowMs: 0 }],
  ])("rejects invalid options %j", (options) => {
    expect(() => createMemoryRateLimiter(options)).toThrow(RangeError);
  });
});
