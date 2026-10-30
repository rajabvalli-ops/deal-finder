import { describe, expect, it } from "vitest";
import { generateLinkCode, isValidLinkCode, LINK_CODE_LENGTH } from "./codes";

describe("generateLinkCode", () => {
  it("produces URL-safe codes of the default length", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateLinkCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) {
      expect(code).toHaveLength(LINK_CODE_LENGTH);
      expect(isValidLinkCode(code)).toBe(true);
    }
  });

  it("maps bytes onto the alphabet and skips biased bytes", () => {
    // 0 → "A", 61 → "9", 62 → "A" (wraps), 248+ is discarded.
    const bytes = [0, 255, 61, 248, 62, 25, 26];
    const random = (size: number) => Uint8Array.from({ length: size }, (_, i) => bytes[i] ?? 0);
    expect(generateLinkCode(random, 6)).toBe("A9AZaA");
  });

  it("asks for more bytes when a batch is all discarded", () => {
    let calls = 0;
    const random = (size: number) => {
      calls += 1;
      return new Uint8Array(size).fill(calls === 1 ? 250 : 1);
    };
    expect(generateLinkCode(random, 6)).toBe("BBBBBB");
    expect(calls).toBe(2);
  });
});

describe("isValidLinkCode", () => {
  it.each([
    ["abc123", true],
    ["A".repeat(32), true],
    ["abc12", false],
    ["A".repeat(33), false],
    ["abc-123", false],
    ["abc 123", false],
    ["../etc", false],
    ["", false],
  ])("%j → %s", (value, expected) => {
    expect(isValidLinkCode(value)).toBe(expected);
  });
});
