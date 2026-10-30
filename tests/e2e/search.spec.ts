import { expect, test, type Page } from "@playwright/test";
import { createDealFixture, signInAs, type DealFixture } from "./helpers";

async function publishViaAdmin(page: Page, fixture: DealFixture) {
  await page.goto(`/admin/deals/${fixture.dealId}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal approved.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal published.");
}

/** The fixture's unique suffix, e.g. "de453fa3" from "E2E Test Kettle de453fa3". */
const uniqueWord = (fixture: DealFixture) => fixture.title.split(" ").at(-1)!;

test("search finds a published deal by keyword and filters", async ({ page, browser }) => {
  const fixture = createDealFixture();
  const word = uniqueWord(fixture);
  await signInAs(page, "EDITOR");
  await publishViaAdmin(page, fixture);

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/");
  await visitor.getByRole("searchbox", { name: "Search deals" }).fill(`kettle ${word}`);
  await visitor.getByRole("button", { name: "Search" }).click();

  await expect(visitor).toHaveURL(new RegExp(`/search\\?q=kettle\\+${word}`));
  await expect(visitor.getByRole("heading", { level: 2 })).toHaveText(
    `1 deal for “kettle ${word}”`,
  );
  await expect(visitor.getByRole("link", { name: fixture.title })).toBeVisible();
  // Result pages are kept out of search engines.
  await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  // Filters are kept in the URL and in the form.
  await visitor.getByLabel("Retailer").selectOption({ label: `E2E Retailer ${word}` });
  await visitor.getByLabel("Max price (£)").fill("50");
  await visitor.getByLabel("In stock only").check();
  await visitor.getByRole("button", { name: "Search" }).click();
  await expect(visitor).toHaveURL(/stock=1/);
  // A plain HTML form also sends the empty fields; only the filled ones matter.
  const url = new URL(visitor.url());
  expect(url.searchParams.get("retailer")).toBe(fixture.retailerSlug);
  expect(url.searchParams.get("max")).toBe("50");
  expect(url.searchParams.get("stock")).toBe("1");
  await expect(visitor.getByLabel("Max price (£)")).toHaveValue("50");
  await expect(visitor.getByRole("link", { name: fixture.title })).toBeVisible();

  // The deal is £39.99, so a £30 ceiling excludes it.
  await visitor.getByLabel("Max price (£)").fill("30");
  await visitor.getByRole("button", { name: "Search" }).click();
  await expect(visitor.getByRole("heading", { level: 2 })).toHaveText("No deals found");
  await expect(visitor.getByRole("link", { name: "Clear search" })).toBeVisible();
});

test("unpublished deals never appear in search", async ({ page }) => {
  const fixture = createDealFixture();
  await page.goto(`/search?q=${uniqueWord(fixture)}`);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("No deals found");
});

test("bad search parameters are ignored rather than failing", async ({ page }) => {
  const response = await page.goto(
    "/search?min=cheap&discount=7&sort=random&page=-1&category=../admin&q=%27%3B%20drop",
  );
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Search deals" })).toBeVisible();
  await expect(page.getByLabel("Min price (£)")).toHaveValue("");
});
