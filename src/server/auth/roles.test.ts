import { describe, expect, it } from "vitest";
import { Role as PrismaRole } from "@/generated/prisma/enums";
import { hasRole, isRole, ROLES } from "./roles";

describe("roles", () => {
  it("match the database enum", () => {
    expect([...ROLES].sort()).toEqual(Object.values(PrismaRole).sort());
  });

  it.each([
    ["USER", "USER", true],
    ["USER", "EDITOR", false],
    ["USER", "ADMIN", false],
    ["EDITOR", "USER", true],
    ["EDITOR", "EDITOR", true],
    ["EDITOR", "ADMIN", false],
    ["ADMIN", "ADMIN", true],
    ["ADMIN", "EDITOR", true],
    ["admin", "USER", false],
    ["", "USER", false],
  ] as const)("%s has %s → %s", (role, required, expected) => {
    expect(hasRole(role, required)).toBe(expected);
  });

  it("recognises valid roles only", () => {
    expect(isRole("EDITOR")).toBe(true);
    expect(isRole("editor")).toBe(false);
  });
});
