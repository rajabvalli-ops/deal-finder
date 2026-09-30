import { describe, expect, it } from "vitest";
import { runSeed } from "../../prisma/seed/run-seed";
import { createMockRetailerAdapter } from "@/server/retailers/adapters/mock";
import type { NormalisedProduct, RetailerAdapter } from "@/server/retailers";
import { createIngestionService } from "@/server/services/ingestion/ingestion.service";
import { testDb } from "./setup";

const DAY = 86_400_000;
const T0 = new Date(Date.UTC(2026, 3, 1, 6));
const day = (n: number) => new Date(T0.getTime() + n * DAY);

async function seededRetailer() {
  await runSeed(testDb, { includeDevelopmentData: true });
  return testDb.retailer.findUniqueOrThrow({ where: { slug: "mock-retailer" } });
}

function mockAt(date: Date, productCount = 24) {
  return createMockRetailerAdapter({ productCount }, { now: () => date, env: {} });
}

const ingestion = createIngestionService(testDb);

/** A hand-written adapter for failure cases. */
function stubAdapter(
  pages: NormalisedProduct[][],
  overrides: Partial<RetailerAdapter> = {},
): RetailerAdapter {
  return {
    key: "stub",
    allowedHosts: ["shop.example"],
    capabilities: { catalogue: true, priceLookup: true },
    async fetchCatalogue({ cursor }) {
      const index = cursor === null ? 0 : Number(cursor);
      return {
        items: pages[index] ?? [],
        nextCursor: index + 1 < pages.length ? String(index + 1) : null,
      };
    },
    async fetchPrices() {
      return [];
    },
    buildAffiliateUrl: (url) => url,
    healthCheck: async () => ({ ok: true }),
    ...overrides,
  };
}

function product(
  externalId: string,
  overrides: Partial<NormalisedProduct> = {},
): NormalisedProduct {
  return {
    externalId,
    title: `Product ${externalId}`,
    productUrl: `https://shop.example/p/${externalId}`,
    currency: "GBP",
    availability: "IN_STOCK",
    variants: [
      { externalId, name: "Default", isDefault: true, price: 1000, availability: "IN_STOCK" },
    ],
    ...overrides,
  };
}

describe("catalogue import", () => {
  it("imports the whole mock catalogue across pages", async () => {
    const retailer = await seededRetailer();
    const result = await ingestion.importCatalogue({
      retailerId: retailer.id,
      adapter: mockAt(T0),
      now: T0,
      pageSize: 10,
    });

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      itemsSeen: 24,
      itemsUpserted: 24,
      itemsFailed: 0,
      nextCursor: null,
      errors: [],
    });
    expect(await testDb.product.count()).toBe(24);
    const variantCount = await testDb.productVariant.count();
    expect(variantCount).toBeGreaterThan(24); // some products have options
    expect(await testDb.priceHistory.count()).toBe(variantCount);

    const run = await testDb.importRun.findUniqueOrThrow({ where: { id: result.importRunId } });
    expect(run).toMatchObject({
      status: "SUCCEEDED",
      jobType: "CATALOGUE_IMPORT",
      itemsSeen: 24,
      finishedAt: T0,
    });
  });

  it("maps category hints, stores snapshots and links history to the run", async () => {
    const retailer = await seededRetailer();
    const result = await ingestion.importCatalogue({
      retailerId: retailer.id,
      adapter: mockAt(T0),
      now: T0,
    });

    const headphones = await testDb.product.findFirstOrThrow({
      where: { externalId: "MOCK-0001" },
      include: { category: true, variants: true, priceHistory: true },
    });
    expect(headphones.category?.slug).toBe("headphones-audio");
    expect(headphones.currentPrice).toBe(
      headphones.variants.find((v) => v.isDefault)!.currentPrice,
    );
    expect(headphones.priceUpdatedAt).toEqual(T0);
    expect(headphones.lastSeenAt).toEqual(T0);
    expect(headphones.priceHistory.every((h) => h.importRunId === result.importRunId)).toBe(true);
  });

  it("is idempotent for the same moment and writes a heartbeat the next day", async () => {
    const retailer = await seededRetailer();
    await ingestion.importCatalogue({ retailerId: retailer.id, adapter: mockAt(T0), now: T0 });
    const afterFirst = await testDb.priceHistory.count();

    await ingestion.importCatalogue({ retailerId: retailer.id, adapter: mockAt(T0), now: T0 });
    expect(await testDb.product.count()).toBe(24);
    expect(await testDb.priceHistory.count()).toBe(afterFirst);

    await ingestion.importCatalogue({
      retailerId: retailer.id,
      adapter: mockAt(day(1)),
      now: day(1),
    });
    expect(await testDb.priceHistory.count()).toBe(afterFirst * 2);
  });

  it("stops at maxPages and resumes from the returned cursor", async () => {
    const retailer = await seededRetailer();
    const first = await ingestion.importCatalogue({
      retailerId: retailer.id,
      adapter: mockAt(T0),
      now: T0,
      pageSize: 10,
      maxPages: 1,
    });
    expect(first).toMatchObject({ itemsSeen: 10, nextCursor: "10" });
    expect(
      (await testDb.importRun.findUniqueOrThrow({ where: { id: first.importRunId } })).cursor,
    ).toBe("10");

    const rest = await ingestion.importCatalogue({
      retailerId: retailer.id,
      adapter: mockAt(T0),
      now: T0,
      pageSize: 10,
      cursor: first.nextCursor,
    });
    expect(rest).toMatchObject({ itemsSeen: 14, nextCursor: null });
    expect(await testDb.product.count()).toBe(24);
  });

  it("builds price history that the pricing engine can use", async () => {
    const retailer = await seededRetailer();
    for (let d = 0; d < 60; d++) {
      await ingestion.importCatalogue({
        retailerId: retailer.id,
        adapter: mockAt(day(d), 4),
        now: day(d),
      });
    }
    const products = await testDb.product.findMany();
    expect(products).toHaveLength(4);
    for (const p of products) {
      expect(p.avg30Price).not.toBeNull();
      expect(p.lowestPrice).toBeLessThan(p.highestPrice!); // every mock product has had a sale
    }
    // Write-on-change + daily heartbeat: exactly one observation per variant per day here.
    const variants = await testDb.productVariant.count();
    expect(await testDb.priceHistory.count()).toBe(variants * 60);
  });

  it("isolates bad items and records a PARTIAL run", async () => {
    const retailer = await seededRetailer();
    const adapter = stubAdapter([
      [
        product("GOOD-1"),
        product("BAD-URL", { productUrl: "http://shop.example/p/bad" }),
        product("OTHER-HOST", { productUrl: "https://elsewhere.example/p/1" }),
        product("NO-DEFAULT", {
          variants: [
            { externalId: "V", name: "V", isDefault: false, price: 1, availability: "IN_STOCK" },
          ],
        }),
        product("GOOD-2", { categoryHint: "Not A Real Category" }),
      ],
    ]);
    const result = await ingestion.importCatalogue({ retailerId: retailer.id, adapter, now: T0 });

    expect(result).toMatchObject({
      status: "PARTIAL",
      itemsSeen: 5,
      itemsUpserted: 2,
      itemsFailed: 3,
    });
    expect(result.errors.map((e) => e.externalId)).toEqual(["BAD-URL", "OTHER-HOST", "NO-DEFAULT"]);
    expect(result.errors[1]?.message).toBe(
      "Product URL host is not allowed: https://elsewhere.example/p/1",
    );
    expect(result.errors[2]?.message).toContain("exactly one default variant");

    const saved = await testDb.product.findMany({ orderBy: { externalId: "asc" } });
    expect(saved.map((p) => [p.externalId, p.categoryId])).toEqual([
      ["GOOD-1", null],
      ["GOOD-2", null],
    ]);
    const run = await testDb.importRun.findUniqueOrThrow({ where: { id: result.importRunId } });
    expect(run.status).toBe("PARTIAL");
    expect(run.errorSample).toHaveLength(3);
  });

  it("marks a run FAILED when every item fails", async () => {
    const retailer = await seededRetailer();
    const adapter = stubAdapter([[product("X", { currency: "pounds" })]]);
    const result = await ingestion.importCatalogue({ retailerId: retailer.id, adapter, now: T0 });
    expect(result.status).toBe("FAILED");
  });

  it("keeps earlier pages when the adapter fails part-way", async () => {
    const retailer = await seededRetailer();
    const pages = [[product("P1")], [product("P2")]];
    const adapter = stubAdapter(pages, {
      async fetchCatalogue({ cursor }) {
        if (cursor !== null) throw new Error("feed unavailable");
        return { items: pages[0]!, nextCursor: "1" };
      },
    });
    const result = await ingestion.importCatalogue({ retailerId: retailer.id, adapter, now: T0 });

    expect(result).toMatchObject({ status: "FAILED", itemsUpserted: 1, nextCursor: "1" });
    expect(result.errors).toEqual([{ externalId: null, message: "Run aborted: feed unavailable" }]);
    expect(await testDb.product.count()).toBe(1);
    const run = await testDb.importRun.findUniqueOrThrow({ where: { id: result.importRunId } });
    expect(run).toMatchObject({ status: "FAILED", cursor: "1" });
  });
});

describe("price refresh", () => {
  async function importedAt(date: Date) {
    const retailer = await seededRetailer();
    await ingestion.importCatalogue({
      retailerId: retailer.id,
      adapter: mockAt(date, 4),
      now: date,
    });
    return retailer;
  }

  it("updates variant prices, availability, history and snapshots", async () => {
    const retailer = await importedAt(T0);
    const before = await testDb.priceHistory.count();

    // Find a day on which MOCK-0001's price differs from day 0.
    const original = (await testDb.product.findFirstOrThrow({ where: { externalId: "MOCK-0001" } }))
      .currentPrice;
    let d = 1;
    while ((await mockAt(day(d), 4).fetchPrices(["MOCK-0001"]))[0]!.variants[0]!.price === original)
      d++;

    const result = await ingestion.importPrices({
      retailerId: retailer.id,
      adapter: mockAt(day(d), 4),
      now: day(d),
      productExternalIds: ["MOCK-0001"],
    });
    expect(result).toMatchObject({ status: "SUCCEEDED", itemsUpserted: 1 });

    const updated = await testDb.product.findFirstOrThrow({
      where: { externalId: "MOCK-0001" },
      include: { variants: true },
    });
    expect(updated.currentPrice).not.toBe(original);
    expect(updated.variants.find((v) => v.isDefault)!.currentPrice).toBe(updated.currentPrice);
    expect(updated.priceUpdatedAt).toEqual(day(d));
    expect(await testDb.priceHistory.count()).toBe(before + updated.variants.length);
    expect(
      (await testDb.importRun.findUniqueOrThrow({ where: { id: result.importRunId } })).jobType,
    ).toBe("PRICE_REFRESH");
  });

  it("rejects updates for unknown products and variants", async () => {
    const retailer = await importedAt(T0);
    const adapter = stubAdapter([], {
      async fetchPrices() {
        return [
          {
            productExternalId: "NOPE",
            currency: "GBP",
            variants: [{ externalId: "NOPE", price: 1, availability: "IN_STOCK" }],
          },
          {
            productExternalId: "MOCK-0002",
            currency: "GBP",
            variants: [{ externalId: "WRONG", price: 1, availability: "IN_STOCK" }],
          },
          { productExternalId: "MOCK-0003", currency: "GBP", variants: [] },
        ];
      },
    });
    const result = await ingestion.importPrices({
      retailerId: retailer.id,
      adapter,
      now: day(1),
      productExternalIds: ["MOCK-0002", "MOCK-0003"],
    });
    expect(result).toMatchObject({ status: "FAILED", itemsFailed: 3 });
    expect(result.errors.map((e) => e.message)).toEqual([
      "Unknown product NOPE",
      "Unknown variant WRONG",
      "Invalid price update",
    ]);
  });
});
