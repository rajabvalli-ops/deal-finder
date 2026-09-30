import { describe, expect, it } from "vitest";
import { pageRequest } from "@/lib/pagination";
import { createPublicCatalogueService } from "@/server/services/public/public-catalogue.service";
import { createPendingDeal } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 5, 1, 12));
const catalogue = createPublicCatalogueService(testDb);
const firstPage = pageRequest("1", 24);

async function publishedDeal(
  overrides: { title?: string; externalId?: string } = {},
  publishedAt = NOW,
) {
  const created = await createPendingDeal(NOW, overrides);
  await testDb.deal.update({
    where: { id: created.deal.id },
    data: { status: "PUBLISHED", publishedAt },
  });
  return created;
}

async function category(slug: string, parentId: string | null = null) {
  return testDb.category.create({ data: { slug, name: slug.replace(/-/g, " "), parentId } });
}

describe("public deal listings", () => {
  it("only shows published deals on active listings at active retailers", async () => {
    const live = await publishedDeal({ title: "Live Deal", externalId: "A" });
    await createPendingDeal(NOW, { title: "Pending Deal", externalId: "B" });
    const delisted = await publishedDeal({ title: "Delisted Deal", externalId: "C" });
    await testDb.product.update({ where: { id: delisted.product.id }, data: { isActive: false } });
    const paused = await publishedDeal({ title: "Paused Retailer Deal", externalId: "D" });
    await testDb.retailer.update({ where: { id: paused.retailer.id }, data: { status: "PAUSED" } });

    const page = await catalogue.listDeals({ sort: "newest", page: firstPage });
    expect(page.items.map((d) => d.title)).toEqual(["Live Deal"]);
    expect(page.items[0]).toMatchObject({
      slug: live.deal.slug,
      dealPrice: 8000,
      referenceType: "AVG_30",
      retailer: { slug: live.retailer.slug },
      priceCheckedAt: expect.any(Date),
    });
    // Internal fields never reach the public shape.
    expect(Object.keys(page.items[0]!)).not.toEqual(
      expect.arrayContaining(["score", "scoreBreakdown", "reviewedById"]),
    );
  });

  it("sorts by recency, discount and saving", async () => {
    const older = await publishedDeal(
      { title: "Older", externalId: "A" },
      new Date(NOW.getTime() - 60_000),
    );
    const newer = await publishedDeal({ title: "Newer", externalId: "B" });
    await testDb.deal.update({
      where: { id: older.deal.id },
      data: { discountBps: 4000, savingAmount: 1000, dealPrice: 9000, referencePrice: 10000 },
    });

    const titles = async (sort: "newest" | "discount" | "saving") =>
      (await catalogue.listDeals({ sort, page: firstPage })).items.map((d) => d.title);
    expect(await titles("newest")).toEqual(["Newer", "Older"]);
    expect(await titles("discount")).toEqual(["Older", "Newer"]);
    expect(await titles("saving")).toEqual(["Newer", "Older"]);
    expect(newer).toBeDefined();
  });

  it("includes subcategories in a category's deals", async () => {
    const parent = await category("audio");
    const child = await category("headphones", parent.id);
    const other = await category("kitchen");
    const inChild = await publishedDeal({ title: "Headphones", externalId: "A" });
    const inOther = await publishedDeal({ title: "Kettle", externalId: "B" });
    await testDb.product.update({
      where: { id: inChild.product.id },
      data: { categoryId: child.id },
    });
    await testDb.product.update({
      where: { id: inOther.product.id },
      data: { categoryId: other.id },
    });

    const audio = await catalogue.categoryBySlug("audio");
    expect(audio?.children.map((c) => c.slug)).toEqual(["headphones"]);
    const deals = await catalogue.listDeals({
      sort: "newest",
      page: firstPage,
      categoryIds: audio!.categoryIds,
    });
    expect(deals.items.map((d) => d.title)).toEqual(["Headphones"]);
    expect(deals.items[0]?.category).toEqual({ slug: "headphones", name: "headphones" });
    expect(await catalogue.categoryBySlug("missing")).toBeNull();
  });

  it("filters by retailer and hides disabled retailers", async () => {
    const a = await publishedDeal({ externalId: "A" });
    await publishedDeal({ externalId: "B" });
    const deals = await catalogue.listDeals({
      sort: "newest",
      page: firstPage,
      retailerId: a.retailer.id,
    });
    expect(deals.total).toBe(1);

    expect(await catalogue.retailerBySlug(a.retailer.slug)).toMatchObject({
      name: a.retailer.name,
    });
    await testDb.retailer.update({ where: { id: a.retailer.id }, data: { status: "DISABLED" } });
    expect(await catalogue.retailerBySlug(a.retailer.slug)).toBeNull();
  });
});

describe("public deal page", () => {
  it("returns price history and stats for published deals only", async () => {
    const { deal } = await publishedDeal();
    const detail = await catalogue.dealBySlug(deal.slug, NOW);
    expect(detail).toMatchObject({
      title: deal.title,
      dealPrice: 8000,
      stats: { current: 8000, lowest: 8000, highest: 10000 },
    });
    expect(detail?.history).toHaveLength(31);
    expect(detail?.product.rating).toBeNull();

    const pending = await createPendingDeal(NOW, { externalId: "P" });
    expect(await catalogue.dealBySlug(pending.deal.slug, NOW)).toBeNull();
    expect(await catalogue.dealBySlug("missing", NOW)).toBeNull();
  });

  it("finds related deals in the same category, or from the same retailer", async () => {
    const audio = await category("audio");
    const main = await publishedDeal({ title: "Main", externalId: "A" });
    const sibling = await publishedDeal({ title: "Sibling", externalId: "B" });
    await publishedDeal({ title: "Elsewhere", externalId: "C" });
    for (const p of [main.product, sibling.product]) {
      await testDb.product.update({ where: { id: p.id }, data: { categoryId: audio.id } });
    }
    expect((await catalogue.relatedDeals(main.deal.slug)).map((d) => d.title)).toEqual(["Sibling"]);

    const loner = await publishedDeal({ title: "Loner", externalId: "D" });
    expect(await catalogue.relatedDeals(loner.deal.slug)).toEqual([]); // its retailer has no other deals
    expect(await catalogue.relatedDeals("missing")).toEqual([]);
  });
});

describe("homepage", () => {
  it("builds featured, latest and near-low sections", async () => {
    const featured = await publishedDeal({ title: "Featured", externalId: "A" });
    await testDb.deal.update({ where: { id: featured.deal.id }, data: { isFeatured: true } });
    const aboveLow = await publishedDeal({ title: "Above low", externalId: "B" });
    await testDb.deal.update({ where: { id: aboveLow.deal.id }, data: { historicalLow: 5000 } });

    const home = await catalogue.homepage();
    expect(home.featured.map((d) => d.title)).toEqual(["Featured"]);
    expect(home.latest).toHaveLength(2);
    expect(home.nearLows.map((d) => d.title)).toEqual(["Featured"]);
  });

  it("lists categories and retailers with live deals, falling back to top-level categories", async () => {
    const parent = await category("audio");
    await category("headphones", parent.id);
    await category("kitchen");
    expect((await catalogue.popularCategories(8)).map((c) => [c.slug, c.dealCount])).toEqual([
      ["audio", 0],
      ["kitchen", 0],
    ]);
    expect(await catalogue.popularRetailers(8)).toEqual([]);

    const deal = await publishedDeal();
    await testDb.product.update({
      where: { id: deal.product.id },
      data: { categoryId: parent.id },
    });
    expect(await catalogue.popularCategories(8)).toEqual([
      { slug: "audio", name: "audio", dealCount: 1 },
    ]);
    expect(await catalogue.popularRetailers(8)).toEqual([
      { slug: deal.retailer.slug, name: deal.retailer.name, dealCount: 1 },
    ]);
  });
});
