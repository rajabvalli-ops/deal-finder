import { describe, expect, it } from "vitest";
import { pageRequest, toPage } from "./pagination";

describe("pageRequest", () => {
  it.each([
    [undefined, 1],
    ["1", 1],
    ["3", 3],
    [["2", "9"], 2],
    ["0", 1],
    ["-2", 1],
    ["abc", 1],
    ["1.5", 1],
    ["9999999", 1],
  ] as const)("%j → page %i", (raw, page) => {
    expect(pageRequest(raw as string | string[] | undefined).page).toBe(page);
  });

  it("computes skip and take", () => {
    expect(pageRequest("3", 10)).toEqual({ page: 3, skip: 20, take: 10 });
  });
});

describe("toPage", () => {
  it("counts pages, with at least one", () => {
    expect(toPage([1, 2], 51, pageRequest("1", 25))).toMatchObject({ total: 51, pageCount: 3 });
    expect(toPage([], 0, pageRequest("1", 25)).pageCount).toBe(1);
  });
});
