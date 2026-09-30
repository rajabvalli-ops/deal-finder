import { expect, test, type Page } from "@playwright/test";
import { createDealFixture, signInAs, type DealFixture } from "./helpers";

// The mock retailer's host (.invalid) never resolves, so the browser is answered locally
// once the redirect reaches it.
const MOCK_RETAILER = /^https:\/\/mock-retailer\.invalid\//;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

async function publishViaAdmin(page: Page, fixture: DealFixture) {
  await page.goto(`/admin/deals/${fixture.dealId}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal approved.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal published.");
}

test("the deal page links out through /go and the click is recorded", async ({ page, browser }) => {
  const fixture = createDealFixture();
  await signInAs(page, "EDITOR");
  await publishViaAdmin(page, fixture);

  // A regular browser user agent: headless ones are (rightly) flagged as bots.
  const visitor = await (await browser.newContext({ userAgent: BROWSER_UA })).newPage();
  await visitor.route(MOCK_RETAILER, (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Mock retailer</h1>" }),
  );
  await visitor.goto(`/deals/${fixture.slug}`);

  const button = visitor.getByRole("link", { name: /^Go to E2E Retailer/ });
  await expect(button).toHaveAttribute(
    "href",
    `/go/${fixture.linkCode}?p=deal-page&deal=${fixture.slug}`,
  );
  await expect(button).toHaveAttribute("rel", "sponsored nofollow noopener");
  // The retailer URL itself never appears in the page.
  expect(await visitor.content()).not.toContain("mock-retailer.invalid");

  await button.click();
  await expect(visitor).toHaveURL(/^https:\/\/mock-retailer\.invalid\/p\/e2e-.*ref=mock-affiliate/);
  await expect(visitor.getByRole("heading", { name: "Mock retailer" })).toBeVisible();

  // Recorded after the redirect is sent, so allow a moment for it to land.
  await expect(async () => {
    await page.goto("/admin/clicks");
    const row = page.getByRole("row").filter({ hasText: fixture.title });
    await expect(row).toContainText("deal-page");
    await expect(row).toContainText("No");
  }).toPass({ timeout: 15_000 });
});

test("/go answers with a plain redirect and refuses unknown codes", async ({ request }) => {
  const fixture = createDealFixture();

  const response = await request.get(`/go/${fixture.linkCode}`, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toMatch(MOCK_RETAILER);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");

  for (const code of ["NoSuchCode1", "bad%20code", "..%2F..%2Fadmin"]) {
    const missing = await request.get(`/go/${code}`, { maxRedirects: 0 });
    expect(missing.status(), code).toBe(404);
    expect(missing.headers()["location"]).toBeUndefined();
  }
});

test("robots.txt keeps crawlers out of /go", async ({ request }) => {
  const body = await (await request.get("/robots.txt")).text();
  expect(body).toMatch(/Disallow: \/go\//);
  expect(body).toMatch(/Disallow: \/admin/);
});
