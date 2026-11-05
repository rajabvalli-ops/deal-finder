import { describe, expect, it } from "vitest";
import { alertFormSchema } from "@/lib/validation/alerts";
import { createPriceHistoryRepository } from "@/server/db/repositories/price-history.repository";
import { runJob } from "@/server/jobs/jobs";
import { createAlertsService } from "@/server/services/alerts/alerts.service";
import { createDealDetectionService } from "@/server/services/deals/deal-detection.service";
import { createPublicCatalogueService } from "@/server/services/public/public-catalogue.service";
import { createPendingDeal, createUser } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 9, 1, 12));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const alerts = createAlertsService(testDb);
const ctx = (now = NOW) => ({ client: testDb, now, env: {} });

/** An alert created a day before NOW. */
async function alertFor(userId: string, input: Record<string, string>) {
  expect(await alerts.create(userId, alertFormSchema.parse(input))).toEqual({ ok: true });
  await testDb.alert.updateMany({
    where: { userId },
    data: { createdAt: new Date(NOW.getTime() - DAY) },
  });
}

const subjects = async (userId: string) =>
  (await alerts.notifications(userId)).items.map((n) => n.subject);

describe("deal levels", () => {
  it.each([
    [8000, "NORMAL"],
    [6000, "BIG_DROP"],
    [2500, "PRICE_ERROR"],
  ] as const)("a drop from £100 to %dp is %s", async (dropTo, level) => {
    const { deal } = await createPendingDeal(NOW, { dropTo });
    expect(deal).toMatchObject({ level, status: "PENDING_REVIEW", levelRaisedAt: null });
  });

  it("records when a deal's level rises", async () => {
    const { deal, variant, product } = await createPendingDeal(NOW, { dropTo: 8000 });
    const later = new Date(NOW.getTime() + HOUR);
    await createPriceHistoryRepository(testDb).record({
      variantId: variant.id,
      price: 2000,
      currency: "GBP",
      availability: "IN_STOCK",
      observedAt: later,
    });
    await testDb.product.update({ where: { id: product.id }, data: { priceUpdatedAt: later } });
    await createDealDetectionService(testDb).detectChanged({ now: later, since: later });
    expect(await testDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({
      dealPrice: 2000,
      level: "PRICE_ERROR",
      levelRaisedAt: later,
    });
  });
});

describe("auto-publish", () => {
  it("publishes new deals straight away for auto-publish retailers, audited", async () => {
    const { deal } = await createPendingDeal(NOW, { autoPublish: true });
    expect(deal).toMatchObject({ status: "PUBLISHED", publishedAt: NOW });
    expect(
      await testDb.auditLog.findFirst({
        where: { entityId: deal.id, action: "deal.auto-publish" },
      }),
    ).toMatchObject({ actorId: null });
  });

  it("leaves other retailers' deals for review", async () => {
    const { deal } = await createPendingDeal(NOW);
    expect(deal.status).toBe("PENDING_REVIEW");
  });
});

describe("alerts on big drops and price errors", () => {
  it("notifies level alerts only for deals at that level or above, with the job", async () => {
    const hunter = await createUser("hunter@example.test");
    const bigDrops = await createUser("big@example.test");
    await alertFor(hunter.id, { level: "price-error" });
    await alertFor(bigDrops.id, { level: "big-drop" });

    await createPendingDeal(NOW, {
      title: "Normal Kettle",
      externalId: "n",
      dropTo: 8000,
      autoPublish: true,
    });
    await createPendingDeal(NOW, {
      title: "Big Kettle",
      externalId: "b",
      dropTo: 6000,
      autoPublish: true,
    });
    await createPendingDeal(NOW, {
      title: "Glitch Kettle",
      externalId: "g",
      dropTo: 900,
      autoPublish: true,
    });

    const report = await runJob("detect-deals", ctx());
    expect(report).toMatchObject({ status: "completed", alerts: { notified: 3 } });
    expect(await subjects(hunter.id)).toEqual(["Possible price error: Glitch Kettle"]);
    expect((await subjects(bigDrops.id)).sort()).toEqual([
      "Big price drop: Big Kettle",
      "Possible price error: Glitch Kettle",
    ]);
    const [error] = (await alerts.notifications(hunter.id)).items;
    expect(error?.body).toMatch(/This may be a pricing mistake/);
  });

  it("notifies again when a live deal drops into a higher level", async () => {
    const watcher = await createUser("watcher@example.test");
    await alertFor(watcher.id, { keyword: "kettle" });
    const { deal, variant, product } = await createPendingDeal(NOW, {
      title: "Glass Kettle",
      dropTo: 8000,
      autoPublish: true,
    });
    await runJob("process-alerts", ctx());
    expect(await subjects(watcher.id)).toEqual(["Price alert: Glass Kettle"]);

    const later = new Date(NOW.getTime() + HOUR);
    await createPriceHistoryRepository(testDb).record({
      variantId: variant.id,
      price: 2500,
      currency: "GBP",
      availability: "IN_STOCK",
      observedAt: later,
    });
    await testDb.product.update({ where: { id: product.id }, data: { priceUpdatedAt: later } });
    await runJob("detect-deals", ctx(later));
    expect(await subjects(watcher.id)).toEqual([
      "Possible price error: Glass Kettle",
      "Price alert: Glass Kettle",
    ]);
    expect(await testDb.notification.count({ where: { dealId: deal.id } })).toBe(2);

    // Nothing new on the next runs.
    await runJob("process-alerts", ctx(later));
    expect(await testDb.notification.count()).toBe(2);
  });

  it("describes level alerts on the alerts page", async () => {
    const user = await createUser("viewer@example.test");
    await alertFor(user.id, { level: "big-drop", max: "50" });
    expect(await alerts.list(user.id)).toEqual([
      expect.objectContaining({
        watching: "Everything",
        condition: "Big drops and price errors only, £50.00 or less",
      }),
    ]);
  });
});

describe("price drops page", () => {
  it("lists only live big drops and price errors", async () => {
    await createPendingDeal(NOW, {
      title: "Normal",
      externalId: "n",
      dropTo: 8000,
      autoPublish: true,
    });
    await createPendingDeal(NOW, {
      title: "Big",
      externalId: "b",
      dropTo: 6000,
      autoPublish: true,
    });
    await createPendingDeal(NOW, { title: "Pending Big", externalId: "p", dropTo: 6000 });
    const page = await createPublicCatalogueService(testDb).listDeals({
      sort: "newest",
      bigDropsOnly: true,
      page: { page: 1, skip: 0, take: 24 },
    });
    expect(page.items.map((d) => [d.title, d.level])).toEqual([["Big", "BIG_DROP"]]);
  });
});
