import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema } from "./auth";

describe("auth form validation", () => {
  it("normalises email addresses", () => {
    expect(signInSchema.parse({ email: "  Jo@Example.COM ", password: "x" }).email).toBe(
      "jo@example.com",
    );
  });

  it.each(["not-an-email", "", "a@b"])("rejects the email %j", (email) => {
    expect(signInSchema.safeParse({ email, password: "x" }).success).toBe(false);
  });

  it("requires a 12–128 character password to sign up", () => {
    const base = { email: "jo@example.com", name: "Jo" };
    expect(signUpSchema.safeParse({ ...base, password: "a".repeat(11) }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, password: "a".repeat(12) }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...base, password: "a".repeat(129) }).success).toBe(false);
  });

  it("defaults the display name to empty", () => {
    expect(signUpSchema.parse({ email: "jo@example.com", password: "a".repeat(12) }).name).toBe("");
  });
});
