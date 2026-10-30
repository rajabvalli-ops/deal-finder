import { expect, test } from "@playwright/test";
import { seedReferenceData, signInAs } from "./helpers";

// Amazon UK as an admin sees it before any credentials are set: nothing here calls Amazon.

test("an admin chooses which Amazon products and searches to track", async ({ page }) => {
  const amazon = seedReferenceData();
  await signInAs(page, "ADMIN");
  await page.goto("/admin/retailers");
  await page
    .getByRole("row", { name: /Amazon UK/ })
    .getByRole("link", { name: "What to track →" })
    .click();
  await expect(page).toHaveURL(`/admin/retailers/${amazon.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Amazon UK: what to track" }),
  ).toBeVisible();
  await expect(page.getByText("Not connected yet.")).toBeVisible();
  await expect(page.getByText("AMAZON_ASSOCIATE_TAG")).toBeVisible();

  const products = page.getByLabel("Products to track");
  await products.fill("B0E2ETEST1\nnot-an-asin");
  await page.getByRole("button", { name: "Save products" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Nothing was saved" })).toBeVisible();

  await products.fill(
    "B0E2ETEST1\nhttps://www.amazon.co.uk/Some-Kettle/dp/B0E2ETEST2/ref=sr_1_1?keywords=kettle",
  );
  await page.getByRole("button", { name: "Save products" }).click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await expect(page.getByRole("heading", { name: "Products (2)" })).toBeVisible();
  await expect(products).toHaveValue("B0E2ETEST1\nB0E2ETEST2");

  await page.getByLabel("Keywords").fill("air fryer");
  await page.getByLabel("Department").selectOption("HomeAndKitchen");
  await page.getByLabel("Min. Amazon discount %").fill("30");
  await page.getByRole("button", { name: "Add search" }).click();
  await expect(page.getByText("“air fryer” in Home & Kitchen, 30%+ off · 1 page")).toBeVisible();
  await page.getByRole("button", { name: "Remove search air fryer" }).click();
  await expect(page.getByRole("heading", { name: "Searches (0)" })).toBeVisible();

  // Leave the shared retailer as the seed made it.
  await products.fill("");
  await page.getByRole("button", { name: "Save products" }).click();
  await expect(page.getByRole("heading", { name: "Products (0)" })).toBeVisible();
});

test("editors can see the tracking list but not change it", async ({ page }) => {
  const amazon = seedReferenceData();
  await signInAs(page, "EDITOR");
  await page.goto(`/admin/retailers/${amazon.id}`);
  await expect(page.getByRole("heading", { name: /Products \(\d+\)/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save products" })).toHaveCount(0);
});
