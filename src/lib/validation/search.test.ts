import { describe, expect, it } from "vitest";
import {
  allowsTypoMatching,
  formatPoundsInput,
  hasCriteria,
  MAX_QUERY_LENGTH,
  parsePounds,
  MAX_QUERY_TERMS,
  parseSearchParams,
  queryTerms,
  searchHref,
  type SearchFilters,
} from "./search";

const empty = parseSearchParams({});

describe("parsePounds", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12.05", 1205],
    ["£199.99", 19999],
    ["0", 0],
    ["100000", 10_000_000],
  ])("%s → %d pence", (value, pence) => {
    expect(parsePounds(value)).toBe(pence);
  });

  it.each(["", "abc", "-5", "1.234", "12,50", "100000.01", "1e3", "£"])("rejects %j", (value) => {
    expect(parsePounds(value)).toBeNull();
  });
});

describe("formatPoundsInput", () => {
  it("shows whole pounds without decimals and pennies with two", () => {
    expect(formatPoundsInput(null)).toBe("");
    expect(formatPoundsInput(1200)).toBe("12");
    expect(formatPoundsInput(1250)).toBe("12.50");
    expect(formatPoundsInput(5)).toBe("0.05");
  });
});

describe("parseSearchParams", () => {
  it("has sensible defaults", () => {
    expect(empty).toEqual({
      q: "",
      category: null,
      retailer: null,
      minPrice: null,
      maxPrice: null,
      minDiscount: null,
      inStock: false,
      sort: "newest",
      page: 1,
    });
    expect(hasCriteria(empty)).toBe(false);
  });

  it("reads every filter", () => {
    expect(
      parseSearchParams({
        q: "  noise   cancelling headphones ",
        category: "audio",
        retailer: "mock-retailer",
        min: "20",
        max: "£150.50",
        discount: "30",
        stock: "1",
        sort: "price-asc",
        page: "3",
      }),
    ).toEqual({
      q: "noise cancelling headphones",
      category: "audio",
      retailer: "mock-retailer",
      minPrice: 2000,
      maxPrice: 15050,
      minDiscount: 30,
      inStock: true,
      sort: "price-asc",
      page: 3,
    });
  });

  it("uses the first value of repeated parameters", () => {
    expect(parseSearchParams({ q: ["kettle", "toaster"] }).q).toBe("kettle");
  });

  it("drops invalid values instead of failing", () => {
    expect(
      parseSearchParams({
        category: "../admin",
        retailer: "Not A Slug",
        min: "cheap",
        discount: "15",
        stock: "yes",
        sort: "random",
        page: "-2",
      }),
    ).toEqual(empty);
    expect(parseSearchParams({ category: "a".repeat(101) }).category).toBeNull();
    expect(parseSearchParams({ page: "0" }).page).toBe(1);
  });

  it("caps the keyword length", () => {
    expect(parseSearchParams({ q: "x".repeat(500) }).q).toHaveLength(MAX_QUERY_LENGTH);
  });

  it("swaps a reversed price range", () => {
    const f = parseSearchParams({ min: "100", max: "20" });
    expect([f.minPrice, f.maxPrice]).toEqual([2000, 10000]);
  });

  it("sorts by relevance only when there is a keyword", () => {
    expect(parseSearchParams({ q: "kettle" }).sort).toBe("relevance");
    expect(parseSearchParams({ sort: "relevance" }).sort).toBe("newest");
    expect(parseSearchParams({ q: "kettle", sort: "discount" }).sort).toBe("discount");
  });
});

describe("hasCriteria", () => {
  it.each<[string, Partial<SearchFilters>]>([
    ["keyword", { q: "kettle" }],
    ["category", { category: "audio" }],
    ["retailer", { retailer: "shop" }],
    ["min price", { minPrice: 0 }],
    ["max price", { maxPrice: 100 }],
    ["discount", { minDiscount: 10 }],
    ["stock", { inStock: true }],
  ])("is true for a %s", (_, change) => {
    expect(hasCriteria({ ...empty, ...change })).toBe(true);
  });

  it("ignores sort and page", () => {
    expect(hasCriteria({ ...empty, sort: "discount", page: 2 })).toBe(false);
  });
});

describe("searchHref", () => {
  it("is the bare path for default filters", () => {
    expect(searchHref(empty)).toBe("/search");
  });

  it("round-trips through parseSearchParams", () => {
    const filters = parseSearchParams({
      q: "oak & ash",
      category: "home",
      retailer: "shop",
      min: "9.99",
      max: "50",
      discount: "20",
      stock: "1",
      sort: "saving",
      page: "2",
    });
    const href = searchHref(filters);
    expect(href).toBe(
      "/search?q=oak+%26+ash&category=home&retailer=shop&min=9.99&max=50&discount=20&stock=1&sort=saving&page=2",
    );
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseSearchParams(params)).toEqual(filters);
  });

  it("applies changes and omits the default sort for the query", () => {
    const filters = parseSearchParams({ q: "kettle", page: "4" });
    expect(searchHref(filters, { page: 1 })).toBe("/search?q=kettle");
    expect(searchHref(filters, { sort: "newest", page: 1 })).toBe("/search?q=kettle&sort=newest");
    expect(searchHref(empty, { sort: "newest" })).toBe("/search");
  });
});

describe("allowsTypoMatching", () => {
  it.each([
    ["headphones", true],
    ["sony ex-100", true],
    ["orange kettle", true],
    ["", false],
    ['"noise cancelling"', false],
    ["headphones -pro", false],
    ["-pro", false],
    ["kettle or toaster", false],
    ["kettle OR", false],
  ])("%j → %s", (q, expected) => {
    expect(allowsTypoMatching(q)).toBe(expected);
  });
});

describe("queryTerms", () => {
  it("splits, lower-cases and de-duplicates words", () => {
    expect(queryTerms(" Sony  WH-1000XM5 sony ")).toEqual(["sony", "wh-1000xm5"]);
    expect(queryTerms("")).toEqual([]);
  });

  it("keeps at most a handful of words", () => {
    const many = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    expect(queryTerms(many)).toHaveLength(MAX_QUERY_TERMS);
  });
});
