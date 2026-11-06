import { expect, test, type Page } from "@playwright/test";
import { createDealFixture, signInAs, type DealFixture } from "./helpers";

async function publish(page: Page, fixture: DealFixture) {
  await page.goto(`/admin/deals/${fixture.dealId}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal approved.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal published.");
}

test("deal cards show when the price was checked, a buy button and comments", async ({ page }) => {
  const fixture = createDealFixture();
  await signInAs(page, "EDITOR");
  await publish(page, fixture);

  await page.goto("/deals");
  await expect(page.getByText(/^\d+ live/)).toBeVisible();
  const card = page.getByRole("article").filter({ hasText: fixture.title });
  await expect(card.getByText(/✓ Checked/)).toBeVisible();
  await expect(card.getByText("💬 0 comments")).toBeVisible();
  const buy = card.getByRole("link", { name: /^Get deal at / });
  await expect(buy).toHaveAttribute("href", /^\/go\/[^?]+\?p=deal-card&deal=/);
  await expect(buy).toHaveAttribute("rel", "sponsored nofollow noopener");
});

test("For you asks visitors to sign in and shows signed-in users a list", async ({ page }) => {
  await page.goto("/deals");
  await page.getByRole("link", { name: "✨ For you" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "✨ Deals for you" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).last()).toHaveAttribute(
    "href",
    "/sign-in?next=%2Ffor-you",
  );

  await signInAs(page, "USER");
  await page.goto("/for-you");
  await expect(page.getByText(/Nothing to go on yet|Hot deals from the categories/)).toBeVisible();
});
