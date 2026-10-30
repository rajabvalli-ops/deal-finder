import { expect, test, type Page } from "@playwright/test";
import { createDealFixture, signInAs, type DealFixture } from "./helpers";

async function publishViaAdmin(page: Page, fixture: DealFixture) {
  await page.goto(`/admin/deals/${fixture.dealId}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal approved.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal published.");
}

test("a deal is hidden until published, then appears across the site", async ({
  page,
  browser,
}) => {
  const fixture = createDealFixture();

  // Not yet published: no public page.
  const visitor = await (await browser.newContext()).newPage();
  expect((await visitor.goto(`/deals/${fixture.slug}`))?.status()).toBe(404);

  await signInAs(page, "EDITOR");
  await publishViaAdmin(page, fixture);

  // Publishing refreshes the cached pages, so a signed-out visitor sees it straight away.
  await visitor.goto("/");
  await expect(visitor.getByRole("link", { name: fixture.title }).first()).toBeVisible();

  await visitor.goto(`/deals/${fixture.slug}`);
  await expect(visitor.getByRole("heading", { level: 1, name: fixture.title })).toBeVisible();
  await expect(visitor.getByText("£39.99").first()).toBeVisible();
  await expect(visitor.getByText(/below its 30-day average price of £59\.9\d/)).toBeVisible();
  await expect(visitor.getByText(/^Price checked /)).toBeVisible();
  await expect(visitor.getByRole("img", { name: /Price history for/ })).toBeVisible();
  await expect(visitor.getByText("Lowest recorded")).toBeVisible();
  await expect(visitor.getByRole("complementary", { name: "Affiliate disclosure" })).toBeVisible();
  await expect(
    visitor
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: /E2E Category/ }),
  ).toBeVisible();

  await visitor.goto(`/categories/${fixture.categorySlug}`);
  await expect(visitor.getByRole("link", { name: fixture.title })).toBeVisible();

  await visitor.goto(`/retailers/${fixture.retailerSlug}`);
  await expect(
    visitor.getByRole("heading", { level: 1, name: /E2E Retailer .* deals/ }),
  ).toBeVisible();
  await expect(visitor.getByRole("link", { name: fixture.title })).toBeVisible();

  await visitor.goto("/deals?sort=discount");
  await expect(visitor.getByRole("link", { name: "Biggest discount" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(visitor.getByRole("link", { name: fixture.title })).toBeVisible();
});

test("an expired deal's page disappears", async ({ page, browser }) => {
  const fixture = createDealFixture();
  await signInAs(page, "EDITOR");
  await publishViaAdmin(page, fixture);
  await page.getByRole("button", { name: "Expire" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal expired.");

  const visitor = await (await browser.newContext()).newPage();
  expect((await visitor.goto(`/deals/${fixture.slug}`))?.status()).toBe(404);
});

test("unknown categories and retailers are 404s", async ({ page }) => {
  expect((await page.goto("/categories/no-such-category"))?.status()).toBe(404);
  expect((await page.goto("/retailers/no-such-retailer"))?.status()).toBe(404);
});

test("every page shows the affiliate disclosure", async ({ page }) => {
  await page.goto("/deals");
  await expect(page.getByRole("contentinfo").getByText(/may earn a commission/)).toBeVisible();
});
