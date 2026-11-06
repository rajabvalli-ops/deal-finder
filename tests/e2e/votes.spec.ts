import { expect, test, type Page } from "@playwright/test";
import { createDealFixture, signInAs, type DealFixture } from "./helpers";

async function publish(page: Page, fixture: DealFixture) {
  await page.goto(`/admin/deals/${fixture.dealId}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal approved.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal published.");
}

test("signed-in users vote deals hot or cold; visitors are asked to sign in", async ({
  page,
  browser,
}) => {
  const fixture = createDealFixture();
  await signInAs(page, "EDITOR");
  await publish(page, fixture);

  await page.goto(`/deals/${fixture.slug}`);
  const hot = page.getByRole("button", { name: "Vote hot" });
  const cold = page.getByRole("button", { name: "Vote cold" });
  await expect(page.getByLabel("Score 0°")).toBeVisible();

  await hot.click();
  await expect(page.getByLabel("Score 1°")).toBeVisible();
  await expect(hot).toHaveAttribute("aria-pressed", "true");

  await cold.click();
  await expect(page.getByLabel("Score -1°")).toBeVisible();
  await expect(cold).toHaveAttribute("aria-pressed", "true");

  await cold.click(); // take it back
  await expect(page.getByLabel("Score 0°")).toBeVisible();
  await expect(cold).toHaveAttribute("aria-pressed", "false");

  await hot.click();
  await page.reload();
  await expect(page.getByLabel("Score 1°")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vote hot" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/deals/${fixture.slug}`);
  await visitor.getByRole("button", { name: "Vote hot" }).click();
  await expect(visitor.getByRole("link", { name: "Sign in to vote" })).toHaveAttribute(
    "href",
    `/sign-in?next=${encodeURIComponent(`/deals/${fixture.slug}`)}`,
  );

  await visitor.goto("/deals?sort=hot");
  await expect(visitor.getByRole("link", { name: "🔥 Hot" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});
