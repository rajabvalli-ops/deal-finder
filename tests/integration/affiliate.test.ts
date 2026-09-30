import { describe, expect, it, vi } from "vitest";
import { runSeed } from "../../prisma/seed/run-seed";
import { createAdminRepository } from "@/server/db/repositories/admin.repository";
import { createMemoryRateLimiter } from "@/server/rate-limit/rate-limiter";
import { createMockRetailerAdapter } from "@/server/retailers/adapters/mock";
import {
  AffiliateLinkError,
  createAffiliateLinkService,
} from "@/server/services/affiliate/affiliate-links.service";
import {
  createOutboundService,
  type ClickRequest,
} from "@/server/services/affiliate/outbound.service";
import { createIngestionService } from "@/server/services/ingestion/ingestion.service";
import { createPublicCatalogueService } from "@/server/services/public/public-catalogue.service";
import { createPendingDeal, createRetailer } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 5, 1, 12));
const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** Adapter stand-in for link tests: the mock adapter's link rules on a test host. */
const shopAdapter = {
  key: "mock",
  allowedHosts: ["retailer.invalid"],
  buildAffiliateUrl: (url: string) => `${url}?ref=test`,
};

async function importedMockCatalogue(productCount = 3) {
  await runSeed(testDb, { includeDevelopmentData: true });
  const retailer = await testDb.retailer.findUniqueOrThrow({ where: { slug: "mock-retailer" } });
  const adapter = createMockRetailerAdapter({ productCount }, { now: () => NOW, env: {} });
  const result = await createIngestionService(testDb).importCatalogue({
    retailerId: retailer.id,
    adapter,
    now: NOW,
  });
  expect(result.status).toBe("SUCCEEDED");
  return retailer;
}

function outboundService(
  options: { limit?: number; logger?: Pick<Console, "warn" | "error"> } = {},
) {
  return createOutboundService(testDb, {
    hashSecret: "integration-test-hash-secret",
    rateLimiter: createMemoryRateLimiter({ limit: options.limit ?? 100, windowMs: 60_000 }),
    env: {},
    logger: options.logger ?? { warn: vi.fn(), error: vi.fn() },
  });
}

const click = (overrides: Partial<ClickRequest> = {}): ClickRequest => ({
  ip: "203.0.113.7",
  userAgent: BROWSER,
  referrer: "https://deals.example/deals/some-deal?utm_source=x",
  placement: "deal-page",
  dealSlug: null,
  ...overrides,
});

describe("affiliate link sync", () => {
  it("creates one link per product and keeps its code stable", async () => {
    const { product, retailer } = await createPendingDeal(NOW);
    const links = createAffiliateLinkService(testDb);
    const params = {
      retailerId: retailer.id,
      productId: product.id,
      productUrl: product.productUrl,
      adapter: shopAdapter,
    };

    const created = await links.syncProductLink(params);
    expect(created.change).toBe("created");
    expect(await links.syncProductLink(params)).toEqual({
      code: created.code,
      change: "unchanged",
    });

    const row = await testDb.affiliateLink.findUniqueOrThrow({ where: { code: created.code } });
    expect(row).toMatchObject({
      productId: product.id,
      retailerId: retailer.id,
      dealId: null,
      destinationUrl: "https://retailer.invalid/p/sku-1?ref=test",
      network: "mock",
      isActive: true,
    });
    expect(await testDb.affiliateLink.count()).toBe(1);
  });

  it("updates the destination and reactivates without changing the code", async () => {
    const { product, retailer } = await createPendingDeal(NOW);
    const links = createAffiliateLinkService(testDb);
    const base = { retailerId: retailer.id, productId: product.id, adapter: shopAdapter };
    const { code } = await links.syncProductLink({ ...base, productUrl: product.productUrl });

    const moved = await links.syncProductLink({
      ...base,
      productUrl: "https://retailer.invalid/p/new",
    });
    expect(moved).toEqual({ code, change: "updated" });

    await testDb.affiliateLink.update({ where: { code }, data: { isActive: false } });
    expect(
      await links.syncProductLink({ ...base, productUrl: "https://retailer.invalid/p/new" }),
    ).toEqual({ code, change: "updated" });
    expect(await testDb.affiliateLink.findUniqueOrThrow({ where: { code } })).toMatchObject({
      destinationUrl: "https://retailer.invalid/p/new?ref=test",
      isActive: true,
    });
  });

  it("refuses URLs outside the adapter's allowed hosts", async () => {
    const { product, retailer } = await createPendingDeal(NOW);
    const links = createAffiliateLinkService(testDb);
    const sync = (buildAffiliateUrl: (url: string) => string) =>
      links.syncProductLink({
        retailerId: retailer.id,
        productId: product.id,
        productUrl: product.productUrl,
        adapter: { ...shopAdapter, buildAffiliateUrl },
      });

    await expect(sync(() => "https://evil.example/steal")).rejects.toThrow(AffiliateLinkError);
    await expect(sync(() => "http://retailer.invalid/p/sku-1")).rejects.toThrow(
      /host is not allowed/,
    );
    expect(await testDb.affiliateLink.count()).toBe(0);
  });

  it("retries when a generated code is already taken", async () => {
    const first = await createPendingDeal(NOW, { externalId: "A" });
    const second = await createPendingDeal(NOW, { externalId: "B" });
    const codes = ["TakenCode1", "TakenCode1", "FreshCode2"];
    const links = createAffiliateLinkService(testDb, { generateCode: () => codes.shift()! });
    const sync = (created: typeof first) =>
      links.syncProductLink({
        retailerId: created.retailer.id,
        productId: created.product.id,
        productUrl: created.product.productUrl,
        adapter: shopAdapter,
      });

    expect(await sync(first)).toEqual({ code: "TakenCode1", change: "created" });
    expect(await sync(second)).toEqual({ code: "FreshCode2", change: "created" });
  });

  it("gives up after repeated collisions", async () => {
    const first = await createPendingDeal(NOW, { externalId: "A" });
    const second = await createPendingDeal(NOW, { externalId: "B" });
    const links = createAffiliateLinkService(testDb, { generateCode: () => "SameCode01" });
    const sync = (created: typeof first) =>
      links.syncProductLink({
        retailerId: created.retailer.id,
        productId: created.product.id,
        productUrl: created.product.productUrl,
        adapter: shopAdapter,
      });

    await sync(first);
    await expect(sync(second)).rejects.toThrow(/unique link code/);
  });

  it("is enforced by the database: https only, valid codes, one product link", async () => {
    const { product, retailer } = await createPendingDeal(NOW);
    const row = (code: string, destinationUrl = "https://retailer.invalid/p/1") => ({
      code,
      retailerId: retailer.id,
      productId: product.id,
      destinationUrl,
    });
    await expect(
      testDb.affiliateLink.create({ data: row("Valid00001", "http://retailer.invalid/p/1") }),
    ).rejects.toThrow();
    await expect(testDb.affiliateLink.create({ data: row("bad code!") })).rejects.toThrow();
    await testDb.affiliateLink.create({ data: row("Valid00001") });
    await expect(testDb.affiliateLink.create({ data: row("Valid00002") })).rejects.toThrow();
  });
});

describe("ingestion creates outbound links", () => {
  it("gives every imported product one active link and keeps codes across imports", async () => {
    const retailer = await importedMockCatalogue(3);
    const before = await testDb.affiliateLink.findMany({ orderBy: { code: "asc" } });
    expect(before).toHaveLength(3);
    for (const link of before) {
      expect(link.retailerId).toBe(retailer.id);
      expect(link.isActive).toBe(true);
      expect(link.destinationUrl).toMatch(
        /^https:\/\/mock-retailer\.invalid\/.+ref=mock-affiliate/,
      );
    }

    const adapter = createMockRetailerAdapter({ productCount: 3 }, { now: () => NOW, env: {} });
    await createIngestionService(testDb).importCatalogue({
      retailerId: retailer.id,
      adapter,
      now: new Date(NOW.getTime() + 86_400_000),
    });
    const after = await testDb.affiliateLink.findMany({ orderBy: { code: "asc" } });
    expect(after.map((l) => l.code)).toEqual(before.map((l) => l.code));
  });
});

describe("outbound redirects", () => {
  async function mockLink() {
    await importedMockCatalogue(1);
    return testDb.affiliateLink.findFirstOrThrow({ include: { product: true } });
  }

  it("redirects an active code to its retailer URL", async () => {
    const link = await mockLink();
    const result = await outboundService().resolve(link.code, { ip: "203.0.113.7" }, NOW);
    expect(result).toEqual({
      kind: "redirect",
      target: { linkId: link.id, productId: link.productId, destinationUrl: link.destinationUrl },
      ipHash: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
  });

  it("404s for malformed, unknown and inactive links", async () => {
    const link = await mockLink();
    const service = outboundService();
    const resolve = (code: string) => service.resolve(code, { ip: null }, NOW);

    expect(await resolve("../../etc")).toEqual({ kind: "not-found" });
    expect(await resolve("Unknown123")).toEqual({ kind: "not-found" });

    await testDb.affiliateLink.update({ where: { id: link.id }, data: { isActive: false } });
    expect(await resolve(link.code)).toEqual({ kind: "not-found" });
    await testDb.affiliateLink.update({ where: { id: link.id }, data: { isActive: true } });

    await testDb.product.update({ where: { id: link.productId! }, data: { isActive: false } });
    expect(await resolve(link.code)).toEqual({ kind: "not-found" });
    await testDb.product.update({ where: { id: link.productId! }, data: { isActive: true } });

    await testDb.retailer.update({ where: { id: link.retailerId }, data: { status: "PAUSED" } });
    expect(await resolve(link.code)).toEqual({ kind: "not-found" });
  });

  it("never redirects outside the retailer's allowed hosts", async () => {
    const link = await mockLink();
    const logger = { warn: vi.fn(), error: vi.fn() };
    await testDb.affiliateLink.update({
      where: { id: link.id },
      data: { destinationUrl: "https://evil.example/phish" },
    });
    expect(await outboundService({ logger }).resolve(link.code, { ip: null }, NOW)).toEqual({
      kind: "not-found",
    });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("404s when the retailer's adapter is not registered", async () => {
    const link = await mockLink();
    const logger = { warn: vi.fn(), error: vi.fn() };
    await testDb.retailer.update({
      where: { id: link.retailerId },
      data: { adapterKey: "removed-adapter" },
    });
    expect(await outboundService({ logger }).resolve(link.code, { ip: null }, NOW)).toEqual({
      kind: "not-found",
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("rate-limits per client before touching the database", async () => {
    const link = await mockLink();
    const service = outboundService({ limit: 2 });
    const resolve = (ip: string) => service.resolve(link.code, { ip }, NOW);
    expect((await resolve("203.0.113.7")).kind).toBe("redirect");
    expect((await resolve("203.0.113.7")).kind).toBe("redirect");
    expect(await resolve("203.0.113.7")).toEqual({ kind: "rate-limited", retryAfterSeconds: 60 });
    expect((await resolve("198.51.100.2")).kind).toBe("redirect");
  });
});

describe("click recording", () => {
  async function linkedDeal() {
    const created = await createPendingDeal(NOW);
    const { code } = await createAffiliateLinkService(testDb).syncProductLink({
      retailerId: created.retailer.id,
      productId: created.product.id,
      productUrl: created.product.productUrl,
      adapter: shopAdapter,
    });
    const link = await testDb.affiliateLink.findUniqueOrThrow({ where: { code } });
    const target = {
      linkId: link.id,
      productId: link.productId,
      destinationUrl: link.destinationUrl,
    };
    return { ...created, link, target };
  }

  it("stores a hashed IP, cleaned referrer and the deal it came from", async () => {
    const { target, deal, product } = await linkedDeal();
    const service = outboundService();
    const ipHash = "a".repeat(32);
    expect(await service.recordClick(target, ipHash, click({ dealSlug: deal.slug }), NOW)).toBe(
      true,
    );

    const row = await testDb.click.findFirstOrThrow();
    expect(row).toMatchObject({
      affiliateLinkId: target.linkId,
      dealId: deal.id,
      productId: product.id,
      ipHash,
      userAgent: BROWSER,
      referrer: "https://deals.example/deals/some-deal",
      placement: "deal-page",
      isBot: false,
      createdAt: NOW,
    });
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
  });

  it("ignores deals that don't belong to the link and unknown placements, and flags bots", async () => {
    const { target } = await linkedDeal();
    const other = await createPendingDeal(NOW, { externalId: "OTHER" });
    const service = outboundService();
    await service.recordClick(
      target,
      null,
      click({ dealSlug: other.deal.slug, placement: "header", userAgent: "curl/8.5" }),
      NOW,
    );
    expect(await testDb.click.findFirstOrThrow()).toMatchObject({
      dealId: null,
      placement: null,
      isBot: true,
    });
  });

  it("swallows and logs recording failures", async () => {
    const { target } = await linkedDeal();
    const logger = { warn: vi.fn(), error: vi.fn() };
    const ok = await outboundService({ logger }).recordClick(
      { ...target, linkId: "missing-link" },
      null,
      click(),
      NOW,
    );
    expect(ok).toBe(false);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(await testDb.click.count()).toBe(0);
  });
});

describe("links on public pages and in admin reports", () => {
  it("gives published deals their product's active link code, never the URL", async () => {
    const { deal, link } = await (async () => {
      const created = await createPendingDeal(NOW);
      await testDb.deal.update({
        where: { id: created.deal.id },
        data: { status: "PUBLISHED", publishedAt: NOW },
      });
      const { code } = await createAffiliateLinkService(testDb).syncProductLink({
        retailerId: created.retailer.id,
        productId: created.product.id,
        productUrl: created.product.productUrl,
        adapter: shopAdapter,
      });
      return { deal: created.deal, link: { code } };
    })();
    const catalogue = createPublicCatalogueService(testDb);

    const detail = await catalogue.dealBySlug(deal.slug, NOW);
    expect(detail?.linkCode).toBe(link.code);
    expect(JSON.stringify(detail)).not.toContain("retailer.invalid");

    await testDb.affiliateLink.update({ where: { code: link.code }, data: { isActive: false } });
    expect((await catalogue.dealBySlug(deal.slug, NOW))?.linkCode).toBeNull();
  });

  it("reports clicks by people separately from bots", async () => {
    const created = await createPendingDeal(NOW);
    const retailer = await createRetailer();
    const link = await testDb.affiliateLink.create({
      data: {
        code: "Report0001",
        retailerId: retailer.id,
        productId: created.product.id,
        destinationUrl: "https://retailer.invalid/p/1",
      },
    });
    const base = { affiliateLinkId: link.id, productId: created.product.id };
    await testDb.click.createMany({
      data: [
        { ...base, dealId: created.deal.id, createdAt: NOW },
        { ...base, dealId: created.deal.id, createdAt: NOW },
        { ...base, dealId: created.deal.id, isBot: true, createdAt: NOW },
        { ...base, createdAt: NOW },
        { ...base, dealId: created.deal.id, createdAt: new Date(NOW.getTime() - 30 * 86_400_000) },
      ],
    });
    const admin = createAdminRepository(testDb);
    const since = new Date(NOW.getTime() - 7 * 86_400_000);

    expect(await admin.clickSummary(since)).toEqual({
      people: 3,
      bots: 1,
      topDeals: [{ dealId: created.deal.id, title: created.deal.title, clicks: 2 }],
    });
    expect((await admin.listClicks({ skip: 0, take: 10 })).total).toBe(4);
    expect((await admin.listClicks({ includeBots: true, skip: 0, take: 10 })).total).toBe(5);
  });
});
