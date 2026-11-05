import { expect, test, type Page } from "@playwright/test";
import { createDealFixture, signInAs, type DealFixture } from "./helpers";

async function publish(page: Page, fixture: DealFixture) {
  await page.goto(`/admin/deals/${fixture.dealId}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal approved.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal published.");
}

test("an editor adds a voucher for a deal; visitors copy it and can report it", async ({
  page,
  browser,
  context,
}) => {
  const fixture = createDealFixture();
  const code = `E2E${fixture.dealId.slice(-6).toUpperCase()}`;
  await signInAs(page, "EDITOR");
  await publish(page, fixture);

  await page.goto("/admin/vouchers");
  await page
    .getByLabel("Retailer")
    .selectOption({ label: `E2E Retailer ${fixture.retailerSlug.split("-").at(-1)}` });
  await page.getByLabel("Code (leave empty if none is needed)").fill(code.toLowerCase());
  await page.getByLabel("Headline").fill("Extra 10% off this kettle");
  await page.getByLabel("Only for this deal (slug, optional)").fill(fixture.slug);
  await page.getByLabel("Discount (e.g. £5 or 10%, optional)").fill("10%");
  await page.getByRole("button", { name: "Add voucher" }).click();
  await expect(page.getByRole("status")).toHaveText("Created.");
  await expect(page.getByText(code, { exact: true })).toBeVisible();

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const visitor = await (
    await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })
  ).newPage();
  await visitor.goto("/vouchers");
  await expect(visitor.getByRole("heading", { level: 1, name: "Voucher codes" })).toBeVisible();
  const card = visitor.getByRole("article").filter({ hasText: code });
  await expect(card.getByText("Extra 10% off this kettle")).toBeVisible();
  await expect(card.getByText("10% off", { exact: true })).toBeVisible();
  await expect(card.getByText(/✓ Checked (just now|1 minute ago)/)).toBeVisible();
  await card.getByRole("button", { name: `Copy code ${code}` }).click();
  await expect(card.getByRole("button", { name: `Copy code ${code}` })).toHaveText("Copied ✓");
  expect(await visitor.evaluate(() => navigator.clipboard.readText())).toBe(code);

  // The code also shows on the deal page, which has its own "Report a problem".
  await card.getByRole("link", { name: "See the deal →" }).click();
  await expect(visitor).toHaveURL(`/deals/${fixture.slug}`);
  await expect(visitor.getByRole("heading", { name: "Save more with this code" })).toBeVisible();
  await expect(visitor.getByText(new RegExp(`^£[\\d.,]+ with code ${code}$`))).toBeVisible();

  const dealReport = visitor.locator("details").filter({ hasText: "Report a problem" }).last();
  await dealReport.getByText("Report a problem").click();
  await dealReport.getByLabel("The price is different").check();
  await dealReport.getByPlaceholder("Anything else? (optional)").fill("It's £45 now");
  await dealReport.getByRole("button", { name: "Send report" }).click();
  await expect(visitor.getByText("Thanks — we'll check it.")).toBeVisible();

  await page.goto("/admin/reports");
  const report = page.getByRole("listitem").filter({ hasText: fixture.title });
  await expect(report.getByText(/1 report — Wrong price ×1/)).toBeVisible();
  await expect(report.getByText("It's £45 now")).toBeVisible();
  await report.getByRole("button", { name: "Dismiss (nothing wrong)" }).click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await expect(page.getByRole("listitem").filter({ hasText: fixture.title })).toHaveCount(0);

  // Switch the voucher off: it leaves the public page.
  await page.goto("/admin/vouchers");
  await page
    .getByRole("row", { name: new RegExp(code) })
    .getByRole("button", { name: "Switch off" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await visitor.goto("/vouchers");
  await expect(visitor.getByText(code)).toHaveCount(0);
});

test("the vouchers page is in the main menu", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Vouchers" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Voucher codes" })).toBeVisible();
});
