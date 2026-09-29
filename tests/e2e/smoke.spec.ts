import { expect, test } from "@playwright/test";

const shells = [
  { path: "/", heading: "Deal Finder" },
  { path: "/deals", heading: "Latest deals" },
  { path: "/search", heading: "Search" },
  { path: "/alerts", heading: "Price alerts" },
];

for (const { path, heading } of shells) {
  test(`${path} renders`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });
}

for (const path of ["/deals/anything", "/categories/anything", "/retailers/anything"]) {
  test(`${path} is a 404 until data exists`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
}

test("main navigation links work", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Price alerts" })
    .click();
  await expect(page).toHaveURL(/\/alerts$/);
});

test("health endpoint responds", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
