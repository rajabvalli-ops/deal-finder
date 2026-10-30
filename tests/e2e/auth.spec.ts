import { expect, test } from "@playwright/test";
import { PASSWORD, setRole, signUp, uniqueEmail } from "./helpers";

test("sends signed-out visitors from /admin to sign in", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("hides the admin area from ordinary users", async ({ page }) => {
  await signUp(page, uniqueEmail());
  await expect(page).toHaveURL(/\/$/);
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
});

test("lets an editor into the admin area, then signs out", async ({ page }) => {
  const email = uniqueEmail();
  await signUp(page, email);
  await expect(page).toHaveURL(/\/$/);
  setRole(email, "EDITOR");

  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("returns to the requested page after signing in", async ({ page, context }) => {
  const email = uniqueEmail();
  await signUp(page, email);
  setRole(email, "ADMIN");
  await context.clearCookies();

  await page.goto("/admin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("shows a generic error for a wrong password", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password").fill("definitely wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Scoped to the form: Next.js adds its own (empty) role="alert" route announcer.
  await expect(page.locator("form").getByRole("alert")).toHaveText("Incorrect email or password.");
});

test("ignores off-site redirect targets", async ({ page }) => {
  await signUp(page, uniqueEmail(), "//evil.example/steal");
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
});

test("sends security headers", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-powered-by"]).toBeUndefined();
});
