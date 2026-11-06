import { describe, expect, it } from "vitest";
import { formatVotes, hotPoints, hotRank } from "./hot";

const at = (iso: string) => new Date(iso);

describe("hotRank", () => {
  it("counts the level as starting points", () => {
    expect(hotPoints(0, "NORMAL")).toBe(0);
    expect(hotPoints(2, "BIG_DROP")).toBe(5);
    expect(hotPoints(-3, "PRICE_ERROR")).toBe(7);
  });

  it("is zero for a pointless deal at the ranking's zero time", () => {
    expect(
      hotRank({ voteScore: 0, level: "NORMAL", publishedAt: at("2026-01-01T00:00:00Z") }),
    ).toBe(0);
  });

  it("weighs ten times the points the same as 12.5 hours", () => {
    const older = hotRank({
      voteScore: 100,
      level: "NORMAL",
      publishedAt: at("2026-11-05T00:00:00Z"),
    });
    const newer = hotRank({
      voteScore: 10,
      level: "NORMAL",
      publishedAt: at("2026-11-05T12:30:00Z"),
    });
    expect(newer).toBeCloseTo(older, 10);
  });

  it("ranks negative scores below neutral ones of the same age", () => {
    const publishedAt = at("2026-11-05T00:00:00Z");
    const cold = hotRank({ voteScore: -10, level: "NORMAL", publishedAt });
    const neutral = hotRank({ voteScore: 1, level: "NORMAL", publishedAt });
    expect(neutral - cold).toBeCloseTo(1, 10);
  });

  it("puts a price error above an unvoted normal deal of the same age", () => {
    const publishedAt = at("2026-11-05T00:00:00Z");
    expect(hotRank({ voteScore: 0, level: "PRICE_ERROR", publishedAt })).toBeGreaterThan(
      hotRank({ voteScore: 0, level: "NORMAL", publishedAt }),
    );
  });
});

describe("formatVotes", () => {
  it("shows the score as a temperature", () => {
    expect(formatVotes(14)).toBe("14°");
    expect(formatVotes(0)).toBe("0°");
    expect(formatVotes(-2)).toBe("-2°");
  });
});
