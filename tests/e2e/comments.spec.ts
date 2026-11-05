import { expect, test, type Page } from "@playwright/test";
import { createDealFixture, signInAs, type DealFixture } from "./helpers";

async function publish(page: Page, fixture: DealFixture) {
  await page.goto(`/admin/deals/${fixture.dealId}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal approved.");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toHaveText("Deal published.");
}

test("signed-in users comment on deals; editors can hide comments", async ({ page, browser }) => {
  const fixture = createDealFixture();
  const text = `Got one at this price ${fixture.dealId.slice(-6)}`;
  await signInAs(page, "EDITOR");
  await publish(page, fixture);

  await page.goto(`/deals/${fixture.slug}`);
  await page.getByLabel("Add a comment").fill(text);
  await page.getByRole("button", { name: "Post comment" }).click();
  const comments = page.getByRole("region", { name: /Comments/ });
  await expect(comments.getByText(text)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comments (1)" })).toBeVisible();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/deals/${fixture.slug}`);
  await expect(visitor.getByText(text)).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Sign in to comment" })).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Delete" })).toHaveCount(0);

  await page.goto("/admin/comments");
  await page
    .getByRole("listitem")
    .filter({ hasText: text })
    .getByRole("button", { name: "Hide" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await visitor.reload();
  await expect(visitor.getByText("No comments yet.")).toBeVisible();
  await expect(visitor.getByText(text)).toHaveCount(0);

  await page.goto("/admin/comments");
  await page
    .getByRole("listitem")
    .filter({ hasText: text })
    .getByRole("button", { name: "Show" })
    .click();
  await page.goto(`/deals/${fixture.slug}`);
  await comments.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No comments yet.")).toBeVisible();
});
