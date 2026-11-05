import { describe, expect, it } from "vitest";
import { checkInPoints, checkInStreak, previousDay, ukDay } from "./points";

describe("ukDay", () => {
  it("uses the UK calendar day, including summer time", () => {
    expect(ukDay(new Date("2026-11-05T23:30:00Z"))).toBe("2026-11-05"); // GMT
    expect(ukDay(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02"); // BST
  });
});

describe("previousDay", () => {
  it("crosses month and year ends", () => {
    expect(previousDay("2026-11-05")).toBe("2026-11-04");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2027-01-01")).toBe("2026-12-31");
  });
});

describe("checkInStreak", () => {
  it("counts consecutive days back from today, or from yesterday before today's check-in", () => {
    const days = ["2026-11-05", "2026-11-04", "2026-11-03", "2026-11-01"];
    expect(checkInStreak(days, "2026-11-05")).toBe(3);
    expect(checkInStreak(days, "2026-11-06")).toBe(3);
    expect(checkInStreak(days, "2026-11-07")).toBe(0);
    expect(checkInStreak([], "2026-11-05")).toBe(0);
  });
});

describe("checkInPoints", () => {
  it("adds a bonus on every 7th day in a row", () => {
    expect(checkInPoints(1)).toBe(10);
    expect(checkInPoints(6)).toBe(10);
    expect(checkInPoints(7)).toBe(40);
    expect(checkInPoints(14)).toBe(40);
    expect(checkInPoints(0)).toBe(10);
  });
});
