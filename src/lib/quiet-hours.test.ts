import { describe, expect, it } from "vitest";
import { formatQuietHours, isQuietHour, ukHour } from "./quiet-hours";

// 2026-07-01 is in BST (UTC+1); 2026-12-01 is in GMT.
const summer = (utcHour: number) => new Date(Date.UTC(2026, 6, 1, utcHour, 30));
const winter = (utcHour: number) => new Date(Date.UTC(2026, 11, 1, utcHour, 30));
const night = { quietStartHour: 23, quietEndHour: 7 };

describe("ukHour", () => {
  it("follows British Summer Time", () => {
    expect(ukHour(summer(22))).toBe(23);
    expect(ukHour(winter(22))).toBe(22);
    expect(ukHour(summer(23))).toBe(0);
  });
});

describe("isQuietHour", () => {
  it("handles a window that crosses midnight, in UK time", () => {
    expect(isQuietHour(night, winter(22))).toBe(false); // 22:30 GMT
    expect(isQuietHour(night, winter(23))).toBe(true); // 23:30
    expect(isQuietHour(night, winter(3))).toBe(true);
    expect(isQuietHour(night, winter(7))).toBe(false); // 07:30 — window ended at 07:00
    expect(isQuietHour(night, summer(22))).toBe(true); // 23:30 BST
    expect(isQuietHour(night, summer(6))).toBe(false); // 07:30 BST
  });

  it("handles a daytime window", () => {
    const work = { quietStartHour: 9, quietEndHour: 17 };
    expect(isQuietHour(work, winter(9))).toBe(true);
    expect(isQuietHour(work, winter(17))).toBe(false);
    expect(isQuietHour(work, winter(8))).toBe(false);
  });

  it("is never quiet without a window or with an empty one", () => {
    expect(isQuietHour({ quietStartHour: null, quietEndHour: null }, winter(2))).toBe(false);
    expect(isQuietHour({ quietStartHour: 5, quietEndHour: 5 }, winter(5))).toBe(false);
    expect(isQuietHour({ quietStartHour: 5, quietEndHour: null }, winter(5))).toBe(false);
  });
});

describe("formatQuietHours", () => {
  it("formats a window", () => {
    expect(formatQuietHours(night)).toBe("23:00–07:00");
    expect(formatQuietHours({ quietStartHour: 9, quietEndHour: 9 })).toBeNull();
    expect(formatQuietHours({ quietStartHour: null, quietEndHour: null })).toBeNull();
  });
});
