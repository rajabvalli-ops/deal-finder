import { describe, expect, it } from "vitest";
import { pageRequest } from "@/lib/pagination";
import { createCommentsService } from "@/server/services/comments/comments.service";
import { createPublicCatalogueService } from "@/server/services/public/public-catalogue.service";
import { createVotesService } from "@/server/services/votes/votes.service";
import { createMemoryRateLimiter } from "@/server/rate-limit/rate-limiter";
import { createLiveDeal, createUser } from "./factories";
import { testDb } from "./setup";

const catalogue = createPublicCatalogueService(testDb);
const createCategory = (slug: string) => testDb.category.create({ data: { slug, name: slug } });
const limiter = () => createMemoryRateLimiter({ limit: 1000, windowMs: 60_000 });

describe("deal cards", () => {
  it("carry the outbound link code, the comment count and early access", async () => {
    // Summaries are computed against the real clock, so publish "now".
    const now = new Date();
    const { deal, product } = await createLiveDeal(now, "Card Kettle");
    await testDb.deal.update({ where: { id: deal.id }, data: { level: "PRICE_ERROR" } });
    const user = await createUser("card@example.test");
    const comments = createCommentsService(testDb, { rateLimiter: limiter() });
    await comments.post({ userId: user.id, slug: deal.slug, body: "nice", now });
    await comments.post({ userId: user.id, slug: deal.slug, body: "hidden", now });
    await testDb.comment.updateMany({ where: { body: "hidden" }, data: { status: "HIDDEN" } });

    const [card] = (await catalogue.listDeals({ sort: "newest", page: pageRequest(undefined, 5) }))
      .items;
    const link = await testDb.affiliateLink.findFirst({ where: { productId: product.id } });
    expect(card).toMatchObject({
      slug: deal.slug,
      linkCode: link?.code ?? null,
      commentCount: 1,
      earlyAccess: true, // a price error, published just now, held back from X for 30 minutes
    });

    await testDb.deal.update({
      where: { id: deal.id },
      data: { publishedAt: new Date(now.getTime() - 31 * 60_000) },
    });
    expect((await catalogue.dealBySlug(deal.slug, now))?.earlyAccess).toBe(false);
  });

  it("counts live deals and reports the latest price check", async () => {
    const now = new Date(Date.UTC(2026, 10, 5, 12));
    const a = await createLiveDeal(now, "Live A");
    await createLiveDeal(now, "Live B");
    const checked = new Date(Date.UTC(2026, 10, 5, 11, 55));
    await testDb.product.update({ where: { id: a.product.id }, data: { priceUpdatedAt: checked } });
    expect(await catalogue.liveStats()).toEqual({ count: 2, lastCheckedAt: checked });
  });
});

describe("for you", () => {
  it("picks hot deals from the categories a user voted on, falling back to everything", async () => {
    const now = new Date(Date.UTC(2026, 10, 5, 12));
    const kitchen = await createCategory("kitchen");
    const garden = await createCategory("garden");
    const kettle = await createLiveDeal(now, "Kettle", { categoryId: kitchen.id });
    const toaster = await createLiveDeal(now, "Toaster", { categoryId: kitchen.id });
    const hose = await createLiveDeal(now, "Hose", { categoryId: garden.id });
    const user = await createUser("fan@example.test");

    const empty = await catalogue.forYou(user.id, now);
    expect(empty.personal).toBe(false);
    expect(empty.deals).toHaveLength(3);

    const votes = createVotesService(testDb, { rateLimiter: limiter() });
    await votes.vote({ userId: user.id, slug: kettle.deal.slug, value: 1, now });
    const mine = await catalogue.forYou(user.id, now);
    expect(mine.personal).toBe(true);
    expect(mine.deals.map((d) => d.slug).sort()).toEqual(
      [kettle.deal.slug, toaster.deal.slug].sort(),
    );
    expect(mine.deals.map((d) => d.slug)).not.toContain(hose.deal.slug);
  });

  it("uses the retailers and categories of the user's alerts", async () => {
    const now = new Date(Date.UTC(2026, 10, 5, 12));
    const shop = await createLiveDeal(now, "Shop Kettle");
    await createLiveDeal(now, "Other Kettle");
    const user = await createUser("alerted@example.test");
    await testDb.alert.create({
      data: { userId: user.id, keyword: "kettle", retailerId: shop.retailer.id },
    });
    const { personal, deals } = await catalogue.forYou(user.id, now);
    expect(personal).toBe(true);
    expect(deals.map((d) => d.slug)).toEqual([shop.deal.slug]);
  });
});
