import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "a long enough password";
export const uniqueEmail = () => `e2e-${randomUUID()}@example.test`;

function tsx(script: string, ...args: string[]): string {
  return execFileSync("npx", ["tsx", "--conditions=react-server", script, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

export function setRole(email: string, role: "USER" | "EDITOR" | "ADMIN") {
  tsx("scripts/set-role.ts", email, role);
}

export type DealFixture = {
  dealId: string;
  productId: string;
  title: string;
  slug: string;
  retailerSlug: string;
  categorySlug: string;
  linkCode: string;
};

export function createDealFixture(): DealFixture {
  const output = tsx("tests/e2e/fixtures/create-deal.ts").trim().split("\n").at(-1)!;
  return JSON.parse(output);
}

export async function signUp(page: Page, email: string, next = "/") {
  await page.goto(`/sign-up?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).not.toHaveURL(/\/sign-up/);
}

/** Signs up a fresh account with the given role and leaves the browser signed in. */
export async function signInAs(page: Page, role: "USER" | "EDITOR" | "ADMIN") {
  const email = uniqueEmail();
  await signUp(page, email);
  if (role !== "USER") setRole(email, role);
  return email;
}
