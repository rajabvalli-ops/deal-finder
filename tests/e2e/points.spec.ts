import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

test("signed-in users check in daily for points", async ({ page }) => {
  await signInAs(page, "USER");
  await page.goto("/");
  await page.getByRole("link", { name: "⭐ Points" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your points" })).toBeVisible();
  await expect(page.getByText("0", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Check in for today" }).click();
  await expect(page.getByText("Checked in: +10 points.")).toBeVisible();
  await expect(page.getByText("✅ Checked in today")).toBeVisible();
  await expect(page.getByText("🔥 1 day", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Daily check-in" })).toContainText(
    "+10",
  );
});

test("visitors are asked to sign in for points", async ({ page }) => {
  await page.goto("/points");
  await expect(page.getByRole("link", { name: "Sign in" }).last()).toHaveAttribute(
    "href",
    "/sign-in?next=%2Fpoints",
  );
  await expect(page.getByText(/no cash value/)).toBeVisible();
});
