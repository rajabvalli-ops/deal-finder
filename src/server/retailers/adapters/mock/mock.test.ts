import { describe, expect, it } from "vitest";
import { describeAdapterContract } from "../../contract.test-kit";
import { mockPriceAt, mockProductSpecs, stableHash, toNormalisedProduct } from "./catalogue";
import { createMockRetailerAdapter } from "./index";

const NOW = new Date(Date.UTC(2026, 3, 10, 12));
const DAY = 86_400_000;

describeAdapterContract("mock", (context) => createMockRetailerAdapter({}, context), { now: NOW });
describeAdapterContract(
  "mock (large, odd page size)",
  (c) => createMockRetailerAdapter({ productCount: 101 }, c),
  {
    now: NOW,
    pageSize: 7,
  },
);

const context = { now: () => NOW, env: {} };

describe("mock adapter", () => {
  it("defaults to 24 products", async () => {
    const page = await createMockRetailerAdapter({}, context).fetchCatalogue({
      cursor: null,
      limit: 100,
    });
    expect(page.items).toHaveLength(24);
    expect(page.nextCursor).toBeNull();
  });

  it.each([{ productCount: 0 }, { productCount: 1.5 }, { productCount: "10" }, null])(
    "rejects invalid config %j",
    (config) => {
      expect(() => createMockRetailerAdapter(config, context)).toThrow();
    },
  );

  it.each(["-1", "abc"])("rejects the cursor %j", async (cursor) => {
    const adapter = createMockRetailerAdapter({}, context);
    await expect(adapter.fetchCatalogue({ cursor, limit: 5 })).rejects.toThrow("Invalid cursor");
  });

  it("adds an affiliate reference without losing the product URL", () => {
    const adapter = createMockRetailerAdapter({}, context);
    expect(adapter.buildAffiliateUrl("https://mock-retailer.invalid/p/mock-0001")).toBe(
      "https://mock-retailer.invalid/p/mock-0001?ref=mock-affiliate",
    );
  });

  it("uses the injected clock for prices", async () => {
    let now = NOW;
    const adapter = createMockRetailerAdapter({}, { now: () => now, env: {} });
    const seen = new Set<number>();
    for (let d = 0; d < 40; d++) {
      now = new Date(NOW.getTime() + d * DAY);
      const [update] = await adapter.fetchPrices(["MOCK-0001"]);
      seen.add(update!.variants[0]!.price!);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("mock catalogue", () => {
  it("hashes deterministically (FNV-1a)", () => {
    expect(stableHash("")).toBe(0x811c9dc5);
    expect(stableHash("a")).toBe(0xe40c292c);
  });

  it("produces clearly fictional products", () => {
    const product = toNormalisedProduct(mockProductSpecs(1)[0]!, NOW);
    expect(product).toMatchObject({
      externalId: "MOCK-0001",
      title: "Mockline Wireless Over-Ear Headphones ML-101",
      brand: "Mockline",
      imageUrl: null,
      productUrl: "https://mock-retailer.invalid/p/mock-0001",
      categoryHint: "headphones-audio",
      currency: "GBP",
    });
    expect(product.variants.map((v) => [v.externalId, v.name, v.isDefault])).toEqual([
      ["MOCK-0001-1", "Black", true],
      ["MOCK-0001-2", "Silver", false],
    ]);
  });

  it("gives single-option products one 'Standard' variant without attributes", () => {
    const product = toNormalisedProduct(mockProductSpecs(2)[1]!, NOW);
    expect(product.variants).toEqual([
      expect.objectContaining({
        externalId: "MOCK-0002-1",
        name: "Standard",
        attributes: undefined,
      }),
    ]);
  });

  it("applies price uplifts to larger variants", () => {
    const laptop = toNormalisedProduct(mockProductSpecs(6)[5]!, NOW);
    expect(laptop.variants[1]!.price! - laptop.variants[0]!.price!).toBe(10000);
  });

  it("runs sales of 10–25% and occasional stock-outs over a year", () => {
    const base = 14999;
    const prices = new Set<number>();
    let outOfStockDays = 0;
    for (let d = 0; d < 365; d++) {
      const point = mockPriceAt("MOCK-0001", base, new Date(NOW.getTime() + d * DAY));
      prices.add(point.price);
      if (point.availability === "OUT_OF_STOCK") outOfStockDays++;
    }
    const sale = Math.min(...prices);
    expect(prices.size).toBe(2); // base price and one sale price
    expect(sale).toBeLessThan(base);
    expect((base - sale) / base).toBeGreaterThanOrEqual(0.09);
    expect((base - sale) / base).toBeLessThanOrEqual(0.26);
    expect(outOfStockDays).toBeGreaterThanOrEqual(8);
    expect(outOfStockDays).toBeLessThanOrEqual(9);
  });

  it("never prices below 99p", () => {
    expect(mockPriceAt("x", 50, NOW).price).toBeGreaterThanOrEqual(50);
    for (let d = 0; d < 60; d++) {
      expect(
        mockPriceAt("cheap", 100, new Date(NOW.getTime() + d * DAY)).price,
      ).toBeGreaterThanOrEqual(99);
    }
  });
});
