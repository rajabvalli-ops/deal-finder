import { describe, expect, it } from "vitest";
import {
  amazonAsinsFormSchema,
  amazonSearchFormSchema,
  amazonSearchRemoveSchema,
  asinFrom,
  parseAsinList,
} from "./amazon";

describe("asinFrom", () => {
  it.each([
    ["B0ABCDEF12", "B0ABCDEF12"],
    ["b0abcdef12", "B0ABCDEF12"],
    ["https://www.amazon.co.uk/dp/B0ABCDEF12", "B0ABCDEF12"],
    ["https://www.amazon.co.uk/Some-Kettle-Name/dp/B0ABCDEF12/ref=sr_1_1?keywords=x", "B0ABCDEF12"],
    ["https://www.amazon.co.uk/gp/product/B0ABCDEF12?psc=1", "B0ABCDEF12"],
    ["https://amazon.co.uk/gp/aw/d/B0ABCDEF12", "B0ABCDEF12"],
    ["www.amazon.co.uk/dp/B0ABCDEF12#reviews", "B0ABCDEF12"],
  ])("%s → %s", (entry, asin) => {
    expect(asinFrom(entry)).toBe(asin);
  });

  it.each([
    "B0ABCDEF1",
    "https://www.amazon.com/dp/B0ABCDEF12",
    "https://amzn.to/3abcd",
    "https://evil.example/www.amazon.co.uk/dp/B0ABCDEF12",
    "https://www.amazon.co.uk/s?k=kettle",
    "http://[bad",
  ])("rejects %s", (entry) => {
    expect(asinFrom(entry)).toBeNull();
  });
});

describe("parseAsinList", () => {
  it("accepts lines, commas and spaces, de-duplicating and keeping order", () => {
    expect(
      parseAsinList("B0ABCDEF12\nhttps://www.amazon.co.uk/dp/B0ZZZZZZZ1, b0abcdef12  nonsense\n\n"),
    ).toEqual({ asins: ["B0ABCDEF12", "B0ZZZZZZZ1"], invalid: ["nonsense"] });
    expect(parseAsinList("")).toEqual({ asins: [], invalid: [] });
  });
});

describe("amazon admin forms", () => {
  it("parses a search, treating blanks as not set", () => {
    expect(
      amazonSearchFormSchema.parse({
        retailerId: "r1",
        keywords: "  air   fryer ",
        searchIndex: "HomeAndKitchen",
        minSavingPercent: "40",
        pages: "2",
      }),
    ).toEqual({
      retailerId: "r1",
      keywords: "air fryer",
      searchIndex: "HomeAndKitchen",
      minSavingPercent: 40,
      pages: 2,
    });
    expect(
      amazonSearchFormSchema.parse({
        retailerId: "r1",
        keywords: "tv",
        searchIndex: "",
        minSavingPercent: "",
        pages: "1",
      }),
    ).toMatchObject({ searchIndex: undefined, minSavingPercent: undefined });
  });

  it.each([
    { keywords: "x" },
    { searchIndex: "Spaceships" },
    { searchIndex: "toString" },
    { minSavingPercent: "100" },
    { minSavingPercent: "2.5" },
    { pages: "11" },
  ])("rejects %j", (change) => {
    const valid = {
      retailerId: "r1",
      keywords: "kettle",
      searchIndex: "",
      minSavingPercent: "",
      pages: "1",
    };
    expect(amazonSearchFormSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });

  it("parses the other forms", () => {
    expect(amazonAsinsFormSchema.parse({ retailerId: "r1", asins: "B0ABCDEF12" }).asins).toBe(
      "B0ABCDEF12",
    );
    expect(amazonSearchRemoveSchema.parse({ retailerId: "r1", index: "3" }).index).toBe(3);
  });
});
