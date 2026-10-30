import { describe, expect, it } from "vitest";
import { createPriceHistoryRepository } from "@/server/db/repositories/price-history.repository";
import { createProductRepository } from "@/server/db/repositories/product.repository";
import { createDealDetectionService } from "@/server/services/deals/deal-detection.service";
import { createRetailer, listingInput } from "./factories";
import { testDb } from "./setup";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(Date.UTC(2026, 5, 1, 12));
const at = (msAfterNow: number) => new Date(NOW.getTime() + msAfterNow);

const detection = createDealDetectionService(testDb);
const history = createPriceHistoryRepository(testDb);

/** A product with 30 days at £100. */
async function productWithHistory() {
  const retailer = await createRetailer();
  const product = await createProductRepository(testDb).upsertListing(listingInput(retailer.id));
  const variant = product.variants[0]!;
  for (let d = 30; d >= 1; d--) {
    await observe(variant.id, 10000, at(-d * DAY));
  }
  return { retailer, product, variant };
}

async function observe(
  variantId: string,
  price: number,
  when: Date,
  availability = "IN_STOCK" as const,
) {
  await history.record({ variantId, price, currency: "GBP", availability, observedAt: when });
  const variant = await testDb.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  await testDb.product.update({ where: { id: variant.productId }, data: { priceUpdatedAt: when } });
}

const detectAt = (now: Date) =>
  detection.detectChanged({ now, since: new Date(now.getTime() - 26 * HOUR) });

describe("deal detection", () => {
  it("creates a PENDING_REVIEW deal with the engine's snapshot and an audit entry", async () => {
    const { product, variant } = await productWithHistory();
    await observe(variant.id, 8000, at(-HOUR));

    const summary = await detectAt(NOW);
    expect(summary).toMatchObject({ created: 1, failed: 0 });

    const deal = await testDb.deal.findFirstOrThrow();
    expect(deal).toMatchObject({
      productId: product.id,
      variantId: variant.id,
      status: "PENDING_REVIEW",
      source: "ENGINE",
      title: product.title,
      dealPrice: 8000,
      referenceType: "AVG_30",
      engineVersion: "deal-engine@1",
      detectedAt: NOW,
    });
    expect(deal.slug).toMatch(/^example-wireless-headphones-[0-9a-f]{6}$/);
    expect(deal.summary).toMatch(/below the 30-day average/);

    const audit = await testDb.auditLog.findMany({ where: { entityId: deal.id } });
    expect(audit).toEqual([
      expect.objectContaining({ action: "deal.detect", actorId: null, entityType: "Deal" }),
    ]);
  });

  it("is idempotent", async () => {
    const { variant } = await productWithHistory();
    await observe(variant.id, 8000, at(-HOUR));
    await detectAt(NOW);
    expect(await detectAt(NOW)).toMatchObject({ created: 0, unchanged: 1 });
    expect(await testDb.deal.count()).toBe(1);
  });

  it("refreshes an active deal when the price moves again", async () => {
    const { variant } = await productWithHistory();
    await observe(variant.id, 8000, at(-HOUR));
    await detectAt(NOW);

    await observe(variant.id, 7000, at(2 * HOUR));
    expect(await detectAt(at(3 * HOUR))).toMatchObject({ updated: 1 });

    const deal = await testDb.deal.findFirstOrThrow();
    expect(deal.dealPrice).toBe(7000);
    const actions = (await testDb.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(["deal.detect", "deal.update"]);
  });

  it("expires a deal once the price returns to normal", async () => {
    const { variant } = await productWithHistory();
    await observe(variant.id, 8000, at(-HOUR));
    await detectAt(NOW);

    await observe(variant.id, 10000, at(DAY));
    expect(await detectAt(at(DAY + HOUR))).toMatchObject({ expired: 1 });

    const deal = await testDb.deal.findFirstOrThrow();
    expect(deal).toMatchObject({ status: "EXPIRED", expiredAt: at(DAY + HOUR) });
    const expiry = await testDb.auditLog.findFirstOrThrow({ where: { action: "deal.expire" } });
    expect(expiry.diff).toMatchObject({ rejections: ["NO_DISCOUNT"] });
  });

  it("detects a fresh deal after an earlier one expired", async () => {
    const { variant } = await productWithHistory();
    await observe(variant.id, 8000, at(-HOUR));
    await detectAt(NOW);
    await observe(variant.id, 10000, at(DAY));
    await detectAt(at(DAY + HOUR));
    for (let d = 2; d <= 20; d++) await observe(variant.id, 10000, at(d * DAY));
    await observe(variant.id, 7500, at(21 * DAY));

    expect(await detectAt(at(21 * DAY + HOUR))).toMatchObject({ created: 1 });
    expect(
      await testDb.deal.groupBy({ by: ["status"], _count: true, orderBy: { status: "asc" } }),
    ).toEqual([
      { status: "PENDING_REVIEW", _count: 1 },
      { status: "EXPIRED", _count: 1 },
    ]);
  });

  it("ignores listings not priced within the window", async () => {
    const { variant } = await productWithHistory();
    await observe(variant.id, 8000, at(-2 * DAY));
    expect(await detectAt(NOW)).toMatchObject({ created: 0, none: 0, unchanged: 0 });
  });

  it("does nothing for a listing that is not a deal", async () => {
    await productWithHistory();
    expect(await detection.detectChanged({ now: NOW, since: at(-2 * DAY) })).toMatchObject({
      none: 1,
    });
    expect(await testDb.deal.count()).toBe(0);
  });
});

describe("verifying active deals", () => {
  async function activeDeal() {
    const setup = await productWithHistory();
    await observe(setup.variant.id, 8000, at(-HOUR));
    await detectAt(NOW);
    return { ...setup, deal: await testDb.deal.findFirstOrThrow() };
  }

  it("keeps a still-valid deal and never creates new ones", async () => {
    await activeDeal();
    const other = await productWithHistory();
    await observe(other.variant.id, 8000, at(-HOUR)); // a deal nobody has detected yet

    expect(await detection.verifyActive({ now: at(HOUR) })).toMatchObject({
      unchanged: 1,
      created: 0,
    });
    expect(await testDb.deal.count()).toBe(1);
  });

  it("expires a published deal whose product was delisted", async () => {
    const { product, deal } = await activeDeal();
    await testDb.deal.update({ where: { id: deal.id }, data: { status: "PUBLISHED" } });
    await testDb.product.update({ where: { id: product.id }, data: { isActive: false } });

    expect(await detection.verifyActive({ now: at(HOUR) })).toMatchObject({ expired: 1 });
    const audit = await testDb.auditLog.findFirstOrThrow({ where: { action: "deal.expire" } });
    expect(audit.diff).toMatchObject({ reason: "Product is no longer listed" });
  });

  it("expires a deal whose end date has passed", async () => {
    const { deal } = await activeDeal();
    await testDb.deal.update({ where: { id: deal.id }, data: { expiresAt: at(HOUR) } });
    expect(await detection.verifyActive({ now: at(30 * 60_000) })).toMatchObject({ unchanged: 1 });
    expect(await detection.verifyActive({ now: at(HOUR) })).toMatchObject({ expired: 1 });
  });

  it("tolerates up to 48 hours without a price check before expiring", async () => {
    await activeDeal(); // last observation one hour before NOW
    expect(await detection.verifyActive({ now: at(46 * HOUR) })).toMatchObject({ unchanged: 1 });
    expect(await detection.verifyActive({ now: at(48 * HOUR) })).toMatchObject({ expired: 1 });
  });

  it("expires a deal left on a variant that is no longer the default", async () => {
    const { product, deal } = await activeDeal();
    await testDb.productVariant.update({
      where: { id: deal.variantId },
      data: { isDefault: false },
    });
    await testDb.productVariant.create({
      data: {
        productId: product.id,
        externalId: "NEW",
        name: "New",
        isDefault: true,
        availability: "IN_STOCK",
      },
    });
    expect(await detection.verifyActive({ now: at(HOUR) })).toMatchObject({ expired: 1 });
    expect((await testDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe(
      "EXPIRED",
    );
  });
});
