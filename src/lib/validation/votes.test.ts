import { describe, expect, it } from "vitest";
import { voteSchema, voteStateSchema } from "./votes";

describe("voteSchema", () => {
  it("accepts hot, cold and taking a vote back", () => {
    for (const value of [1, 0, -1]) {
      expect(voteSchema.parse({ slug: "glass-kettle-1", value })).toEqual({
        slug: "glass-kettle-1",
        value,
      });
    }
  });

  it("rejects other values and bad slugs", () => {
    expect(voteSchema.safeParse({ slug: "kettle", value: 2 }).success).toBe(false);
    expect(voteSchema.safeParse({ slug: "kettle", value: "1" }).success).toBe(false);
    expect(voteSchema.safeParse({ slug: "../admin", value: 1 }).success).toBe(false);
    expect(voteStateSchema.safeParse({ slug: "Bad Slug" }).success).toBe(false);
  });
});
