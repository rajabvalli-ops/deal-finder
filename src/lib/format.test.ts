import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, humanise, toDateTimeLocalValue } from "./format";

describe("format helpers", () => {
  it("formats in UK time, including summer time", () => {
    expect(formatDateTime(new Date("2026-01-15T13:05:00Z"))).toBe("15 Jan 2026, 13:05");
    expect(formatDateTime(new Date("2026-07-15T13:05:00Z"))).toBe("15 Jul 2026, 14:05");
    expect(formatDate(new Date("2026-07-15T23:30:00Z"))).toBe("16 Jul 2026");
  });

  it("shows a dash for missing dates", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(toDateTimeLocalValue(null)).toBe("");
  });

  it("produces datetime-local values", () => {
    expect(toDateTimeLocalValue(new Date("2026-07-01T09:30:45Z"))).toBe("2026-07-01T09:30");
  });

  it("humanises codes", () => {
    expect(humanise("PENDING_REVIEW")).toBe("Pending review");
    expect(humanise("")).toBe("");
  });
});
