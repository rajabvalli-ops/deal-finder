import { expect, test } from "@playwright/test";
import { createDealFixture, signInAs, signUp, uniqueEmail } from "./helpers";

test("an editor reviews, approves and publishes a detected deal", async ({ page }) => {
  const fixture = createDealFixture();
  await signInAs(page, "EDITOR");

  await page.goto(`/admin/deals?status=PENDING_REVIEW&q=${encodeURIComponent(fixture.title)}`);
  await page.getByRole("link", { name: fixture.title }).click();
  await expect(page.getByRole("heading", { level: 1, name: fixture.title })).toBeVisible();
  await expect(page.getByText("Pending review", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /Price history for/ })).toBeVisible();
  await expect(page.getByText(/below the 30-day average/).first()).toBeVisible();

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal approved.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal published.");
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(page.getByText(/deal\.publish by/)).toBeVisible();
});

test("an editor rejects a deal with a reason and edits another", async ({ page }) => {
  const rejected = createDealFixture();
  const edited = createDealFixture();
  await signInAs(page, "EDITOR");

  await page.goto(`/admin/deals/${rejected.dealId}`);
  await page.getByLabel("Rejection reason").fill("Duplicate listing");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal rejected.");
  await expect(page.getByText("Rejection reason: Duplicate listing")).toBeVisible();

  await page.goto(`/admin/deals/${edited.dealId}`);
  await page.getByLabel("Title").fill(`${edited.title} (edited)`);
  await page.getByLabel("Featured on the homepage").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await expect(
    page.getByRole("heading", { level: 1, name: `${edited.title} (edited)` }),
  ).toBeVisible();
});

test("an editor can inspect a product's price history", async ({ page }) => {
  const fixture = createDealFixture();
  await signInAs(page, "EDITOR");
  await page.goto(`/admin/products/${fixture.productId}`);
  await expect(page.getByRole("heading", { level: 1, name: fixture.title })).toBeVisible();
  await page.getByText(/^All \d+ observations$/).click();
  await expect(page.getByRole("cell", { name: "£39.99" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "£59.99" }).first()).toBeVisible();
});

test("editors can't manage users or change retailers", async ({ page }) => {
  await signInAs(page, "EDITOR");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Users" }),
  ).toHaveCount(0);
  expect((await page.goto("/admin/users"))?.status()).toBe(404);

  await page.goto("/admin/retailers");
  await expect(page.getByText("Only admins can change retailer settings.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
});

test("an admin changes another user's role", async ({ page, browser }) => {
  const other = uniqueEmail();
  const otherContext = await browser.newContext();
  await signUp(await otherContext.newPage(), other);
  await otherContext.close();

  await signInAs(page, "ADMIN");
  await page.goto(`/admin/users?q=${encodeURIComponent(other)}`);
  await page.getByLabel(`Role for ${other}`).selectOption("EDITOR");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await expect(page.getByLabel(`Role for ${other}`)).toHaveValue("EDITOR");
});
