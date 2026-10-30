import { describe, expect, it } from "vitest";
import { parseSearchParams } from "@/lib/validation/search";
import { createSearchService } from "@/server/services/public/search.service";
import { createPendingDeal } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 5, 1, 12));
const search = createSearchService(testDb);
const run = async (params: Record<string, string>) =>
  (await search.search(parseSearchParams(params))).results;
const titles = async (params: Record<string, string>) =>
  (await run(params)).items.map((d) => d.title);

/** A published deal; `price` and `discount` (percent) adjust the snapshot consistently. */
async function liveDeal(
  title: string,
  options: {
    description?: string;
    brand?: string;
    price?: number;
    discount?: number;
    publishedMinutesAgo?: number;
    categoryId?: string;
  } = {},
) {
  const created = await createPendingDeal(NOW, { title, externalId: title });
  const price = options.price ?? 8000;
  const discountBps = (options.discount ?? 20) * 100;
  const reference = Math.round((price * 10000) / (10000 - discountBps));
  await testDb.product.update({
    where: { id: created.product.id },
    data: {
      description: options.description ?? null,
      brand: options.brand ?? null,
      categoryId: options.categoryId ?? null,
      // Outside the detection window, so the next factory call's deal detection leaves this
      // deal's adjusted price snapshot alone.
      priceUpdatedAt: new Date(NOW.getTime() - 3 * 86_400_000),
    },
  });
  await testDb.deal.update({
    where: { id: created.deal.id },
    data: {
      title,
      status: "PUBLISHED",
      publishedAt: new Date(NOW.getTime() - (options.publishedMinutesAgo ?? 0) * 60_000),
      dealPrice: price,
      referencePrice: reference,
      savingAmount: reference - price,
      discountBps,
    },
  });
  return created;
}

describe("keyword search", () => {
  it("matches words in the title, with stemming", async () => {
    await liveDeal("Wireless Noise Cancelling Headphones");
    await liveDeal("Electric Kettle 1.7L");
    expect(await titles({ q: "headphone" })).toEqual(["Wireless Noise Cancelling Headphones"]);
    expect(await titles({ q: "kettles" })).toEqual(["Electric Kettle 1.7L"]);
  });

  it("matches brand, model and description", async () => {
    await liveDeal("Over-ear Headphones", { brand: "Sonora", description: "Forty hour battery" });
    await liveDeal("Electric Kettle");
    expect(await titles({ q: "sonora" })).toEqual(["Over-ear Headphones"]);
    expect(await titles({ q: "battery" })).toEqual(["Over-ear Headphones"]);
    // Every factory product has model EX-100.
    expect(await titles({ q: "EX-100" })).toHaveLength(2);
  });

  it("tolerates small typos in the title", async () => {
    await liveDeal("Wireless Headphones");
    await liveDeal("Electric Kettle");
    expect(await titles({ q: "hedphones" })).toEqual(["Wireless Headphones"]);
    expect(await titles({ q: "ketle" })).toEqual(["Electric Kettle"]);
    expect(await titles({ q: "toaster" })).toEqual([]);
  });

  it("requires every word to match, forgiving typos word by word", async () => {
    await liveDeal("Electric Kettle Pro");
    await liveDeal("Glass Kettle", { publishedMinutesAgo: 1 });
    expect(await titles({ q: "kettle pro" })).toEqual(["Electric Kettle Pro"]);
    expect(await titles({ q: "ketle pro" })).toEqual(["Electric Kettle Pro"]);
    expect(await titles({ q: "kettle zebra" })).toEqual([]);
    expect(await titles({ q: "the" })).toEqual([]);
    // Stop words don't have to match.
    expect(await titles({ q: "the kettle", sort: "newest" })).toEqual([
      "Electric Kettle Pro",
      "Glass Kettle",
    ]);
  });

  it("understands quoted phrases and exclusions", async () => {
    await liveDeal("Noise Cancelling Headphones");
    await liveDeal("Cancelling Noise Headphones Pro");
    expect(await titles({ q: '"noise cancelling"' })).toEqual(["Noise Cancelling Headphones"]);
    expect(await titles({ q: "headphones -pro" })).toEqual(["Noise Cancelling Headphones"]);
  });

  it("treats hostile input as plain text", async () => {
    await liveDeal("Electric Kettle");
    expect(await titles({ q: `'); DROP TABLE "Deal"; --` })).toEqual([]);
    expect(await titles({ q: "%_\\" })).toEqual([]);
    expect(await testDb.deal.count()).toBe(1);
  });

  it("ranks title matches above description-only matches", async () => {
    await liveDeal("Desk Lamp", {
      description: "Pairs well with a kettle",
      publishedMinutesAgo: 0,
    });
    await liveDeal("Glass Kettle", { publishedMinutesAgo: 60 });
    expect(await titles({ q: "kettle" })).toEqual(["Glass Kettle", "Desk Lamp"]);
  });
});

describe("visibility", () => {
  it("only returns published deals on active listings at active retailers", async () => {
    await liveDeal("Live Kettle");
    await createPendingDeal(NOW, { title: "Pending Kettle", externalId: "pending" });
    const delisted = await liveDeal("Delisted Kettle");
    await testDb.product.update({ where: { id: delisted.product.id }, data: { isActive: false } });
    const paused = await liveDeal("Paused Kettle");
    await testDb.retailer.update({ where: { id: paused.retailer.id }, data: { status: "PAUSED" } });

    expect(await titles({ q: "kettle" })).toEqual(["Live Kettle"]);
    expect((await run({})).total).toBe(1);
  });
});

describe("filters", () => {
  it("filters by category, including subcategories", async () => {
    const audio = await testDb.category.create({ data: { slug: "audio", name: "Audio" } });
    const headphones = await testDb.category.create({
      data: { slug: "headphones", name: "Headphones", parentId: audio.id },
    });
    const kitchen = await testDb.category.create({ data: { slug: "kitchen", name: "Kitchen" } });
    await liveDeal("Speaker", { categoryId: audio.id });
    await liveDeal("Earbuds", { categoryId: headphones.id, publishedMinutesAgo: 1 });
    await liveDeal("Kettle", { categoryId: kitchen.id });

    expect(await titles({ category: "audio" })).toEqual(["Speaker", "Earbuds"]);
    expect(await titles({ category: "headphones" })).toEqual(["Earbuds"]);
  });

  it("filters by retailer and drops unknown or paused ones", async () => {
    const a = await liveDeal("Kettle A");
    await liveDeal("Kettle B", { publishedMinutesAgo: 1 });
    expect(await titles({ retailer: a.retailer.slug })).toEqual(["Kettle A"]);

    const unknown = await search.search(
      parseSearchParams({ retailer: "no-such-shop", category: "nope" }),
    );
    expect(unknown.filters.retailer).toBeNull();
    expect(unknown.filters.category).toBeNull();
    expect(unknown.results.total).toBe(2);

    await testDb.retailer.update({ where: { id: a.retailer.id }, data: { status: "PAUSED" } });
    expect(
      (await search.search(parseSearchParams({ retailer: a.retailer.slug }))).filters.retailer,
    ).toBeNull();
  });

  it("filters by price range, minimum discount and stock", async () => {
    await liveDeal("Cheap Kettle", { price: 1500, discount: 10 });
    await liveDeal("Mid Kettle", { price: 5000, discount: 30, publishedMinutesAgo: 1 });
    const pricey = await liveDeal("Posh Kettle", {
      price: 20000,
      discount: 50,
      publishedMinutesAgo: 2,
    });
    await testDb.product.update({
      where: { id: pricey.product.id },
      data: { availability: "OUT_OF_STOCK" },
    });

    expect(await titles({ min: "20", max: "100" })).toEqual(["Mid Kettle"]);
    expect(await titles({ max: "15" })).toEqual(["Cheap Kettle"]);
    expect(await titles({ discount: "30" })).toEqual(["Mid Kettle", "Posh Kettle"]);
    expect(await titles({ discount: "30", stock: "1" })).toEqual(["Mid Kettle"]);
  });
});

describe("sorting and paging", () => {
  async function three() {
    await liveDeal("Kettle One", { price: 3000, discount: 10, publishedMinutesAgo: 0 });
    await liveDeal("Kettle Two", { price: 1000, discount: 50, publishedMinutesAgo: 10 });
    await liveDeal("Kettle Three", { price: 9000, discount: 20, publishedMinutesAgo: 20 });
  }

  it("sorts by newest, discount, saving and price", async () => {
    await three();
    expect(await titles({ sort: "newest" })).toEqual(["Kettle One", "Kettle Two", "Kettle Three"]);
    expect(await titles({ sort: "discount" })).toEqual([
      "Kettle Two",
      "Kettle Three",
      "Kettle One",
    ]);
    expect(await titles({ sort: "saving" })).toEqual(["Kettle Three", "Kettle Two", "Kettle One"]);
    expect(await titles({ sort: "price-asc" })).toEqual([
      "Kettle Two",
      "Kettle One",
      "Kettle Three",
    ]);
    expect(await titles({ sort: "price-desc" })).toEqual([
      "Kettle Three",
      "Kettle One",
      "Kettle Two",
    ]);
  });

  it("pages through results with a stable total", async () => {
    await three();
    const small = createSearchService(testDb, { pageSize: 2 });
    const page1 = await small.search(parseSearchParams({ q: "kettle", sort: "newest" }));
    const page2 = await small.search(parseSearchParams({ q: "kettle", sort: "newest", page: "2" }));
    expect(page1.results).toMatchObject({ total: 3, page: 1, pageCount: 2 });
    expect(page1.results.items.map((d) => d.title)).toEqual(["Kettle One", "Kettle Two"]);
    expect(page2.results.items.map((d) => d.title)).toEqual(["Kettle Three"]);
    const beyond = await small.search(parseSearchParams({ q: "kettle", page: "9" }));
    expect(beyond.results.items).toEqual([]);
  });

  it("returns public summaries only", async () => {
    await liveDeal("Kettle");
    const [item] = (await run({ q: "kettle" })).items;
    expect(item).toMatchObject({ title: "Kettle", dealPrice: 8000, retailer: expect.any(Object) });
    expect(Object.keys(item!)).not.toEqual(expect.arrayContaining(["score", "reviewedById"]));
  });
});

describe("search options", () => {
  it("lists categories as a tree and only retailers with live deals", async () => {
    const audio = await testDb.category.create({
      data: { slug: "audio", name: "Audio", sortOrder: 1 },
    });
    await testDb.category.create({ data: { slug: "kitchen", name: "Kitchen", sortOrder: 2 } });
    await testDb.category.create({
      data: { slug: "headphones", name: "Headphones", parentId: audio.id },
    });
    const live = await liveDeal("Kettle");
    await createPendingDeal(NOW, { title: "Pending", externalId: "pending" });

    const options = await search.options();
    expect(options.categories).toEqual([
      { slug: "audio", name: "Audio", depth: 0 },
      { slug: "headphones", name: "Headphones", depth: 1 },
      { slug: "kitchen", name: "Kitchen", depth: 0 },
    ]);
    expect(options.retailers).toEqual([{ slug: live.retailer.slug, name: live.retailer.name }]);
  });
});
