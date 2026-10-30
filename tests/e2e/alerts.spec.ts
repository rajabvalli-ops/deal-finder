import { expect, test, type Page } from "@playwright/test";
import { createDealFixture, signInAs, signUp, uniqueEmail, type DealFixture } from "./helpers";

async function publishViaAdmin(page: Page, fixture: DealFixture) {
  await page.goto(`/admin/deals/${fixture.dealId}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal approved.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal published.");
}

test("signed-out visitors are asked to sign in", async ({ page }) => {
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { level: 1, name: "Price alerts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).last()).toHaveAttribute(
    "href",
    "/sign-in?next=%2Falerts",
  );
});

test("a keyword alert notifies the user when a matching deal is published", async ({
  page,
  browser,
}) => {
  const fixture = createDealFixture();
  await signInAs(page, "USER");
  await page.goto("/alerts");
  await page.getByLabel("Keyword").fill(fixture.title);
  await page.getByLabel("Max price (£)").fill("45");
  await page.getByRole("button", { name: "Create alert" }).click();
  await expect(page.getByRole("status")).toHaveText(/Alert created/);
  await expect(page.getByText(`“${fixture.title}”`)).toBeVisible();
  await expect(page.getByText("£45.00 or less")).toBeVisible();

  const editor = await (await browser.newContext()).newPage();
  await signInAs(editor, "EDITOR");
  await publishViaAdmin(editor, fixture);

  // Matching runs just after the publish response, so allow it a moment.
  const notification = page.getByRole("link", { name: `Price alert: ${fixture.title}` });
  await expect(async () => {
    await page.reload();
    await expect(notification).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Notifications (1 new)" })).toBeVisible();
  await expect(page.getByText(/is £39\.99 at E2E Retailer/)).toBeVisible();

  await page.getByRole("button", { name: `Mark as read: Price alert: ${fixture.title}` }).click();
  await expect(page.getByRole("status")).toHaveText("Marked as read.");
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();

  await notification.click();
  await expect(page).toHaveURL(`/deals/${fixture.slug}`);
});

test("a visitor sets up a product alert from a deal page", async ({ page, browser }) => {
  const fixture = createDealFixture();
  const editor = await (await browser.newContext()).newPage();
  await signInAs(editor, "EDITOR");
  await publishViaAdmin(editor, fixture);

  await page.goto(`/deals/${fixture.slug}`);
  await page.getByRole("link", { name: "Get a price alert for this product" }).click();
  await expect(page).toHaveURL(`/alerts?deal=${fixture.slug}`);
  await page.getByRole("link", { name: "Create an account" }).click();
  await signUp(page, uniqueEmail(), `/alerts?deal=${fixture.slug}`);
  await expect(page).toHaveURL(`/alerts?deal=${fixture.slug}`);

  await expect(page.getByText(`Watching ${fixture.title}, now £39.99.`)).toBeVisible();
  await expect(page.getByLabel("Max price (£)")).toHaveValue("39.99");
  await page.getByLabel("Max price (£)").fill("35");
  await page.getByRole("button", { name: "Create alert" }).click();
  await expect(page.getByRole("status")).toHaveText(/Alert created/);
  await expect(page.getByText("£35.00 or less")).toBeVisible();
  // The deal it was created from was already live, so nothing fires.
  await expect(page.getByText("No notifications yet.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: `Pause alert: ${fixture.title}` }).click();
  await expect(page.getByRole("status")).toHaveText("Alert paused.");
  await expect(page.getByText("£35.00 or less · Paused")).toBeVisible();
  await page.getByRole("button", { name: `Resume alert: ${fixture.title}` }).click();
  await expect(page.getByRole("status")).toHaveText("Alert resumed.");
  await page.getByRole("button", { name: `Delete alert: ${fixture.title}` }).click();
  await expect(page.getByRole("status")).toHaveText("Alert deleted.");
  await expect(page.getByText("You haven't set up any alerts yet.")).toBeVisible();
});

test("a search can be turned into an alert", async ({ page }) => {
  await page.goto("/search?q=kettle&discount=20");
  await page.getByRole("link", { name: "Get alerts for new deals like these" }).click();
  await expect(page).toHaveURL("/alerts?q=kettle&discount=20");
  await signInAs(page, "USER");
  await page.goto("/alerts?q=kettle&discount=20");
  await expect(page.getByLabel("Keyword")).toHaveValue("kettle");
  await expect(page.getByLabel("Discount")).toHaveValue("20");
});
