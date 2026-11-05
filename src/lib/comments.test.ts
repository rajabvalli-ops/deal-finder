import { describe, expect, it } from "vitest";
import { commenterName } from "./comments";
import { commentFormSchema, commentModerationSchema } from "./validation/comments";

describe("commenterName", () => {
  it("shows only the first name", () => {
    expect(commenterName("Sam Smith")).toBe("Sam");
    expect(commenterName("  Priya  ")).toBe("Priya");
    expect(commenterName("")).toBe("Member");
    expect(commenterName("   ")).toBe("Member");
    expect(commenterName("x".repeat(50))).toHaveLength(30);
  });
});

describe("commentFormSchema", () => {
  it("tidies whitespace", () => {
    expect(
      commentFormSchema.parse({
        slug: "glass-kettle",
        body: "  Great price!  \r\n\r\n\r\n\r\nGot one.  ",
      }),
    ).toEqual({ slug: "glass-kettle", body: "Great price!\n\nGot one." });
  });

  it("rejects empty, overlong and badly addressed comments", () => {
    expect(commentFormSchema.safeParse({ slug: "kettle", body: " \n " }).success).toBe(false);
    expect(commentFormSchema.safeParse({ slug: "kettle", body: "x".repeat(1001) }).success).toBe(
      false,
    );
    expect(commentFormSchema.safeParse({ slug: "../x", body: "hi" }).success).toBe(false);
  });

  it("reads moderation actions", () => {
    expect(commentModerationSchema.parse({ commentId: "c1", action: "hide" }).action).toBe("hide");
    expect(commentModerationSchema.safeParse({ commentId: "c1", action: "nuke" }).success).toBe(
      false,
    );
  });
});
