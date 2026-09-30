import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it.each([
    ["Sony WH-1000XM5 Wireless Headphones", "sony-wh-1000xm5-wireless-headphones"],
    ["  Home & Kitchen  ", "home-and-kitchen"],
    ["Crème Brûlée Torch", "creme-brulee-torch"],
    ["£50 off TVs!!!", "gbp-50-off-tvs"],
    ["---", ""],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("truncates without leaving a trailing hyphen", () => {
    expect(slugify("abc def ghi", 4)).toBe("abc");
  });
});
