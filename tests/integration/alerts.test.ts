import { beforeEach, describe, expect, it } from "vitest";
import { alertFormSchema, MAX_ALERTS_PER_USER } from "@/lib/validation/alerts";
import { runJob } from "@/server/jobs/jobs";
import { createAlertMatchingService } from "@/server/services/alerts/alert-matching.service";
import { createAlertsService } from "@/server/services/alerts/alerts.service";
import { createLiveDeal, createPendingDeal, createUser } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 5, 1, 12));
const DAY = 86_400_000;
const service = createAlertsService(testDb);
const matching = createAlertMatchingService(testDb);
const match = (since = new Date(NOW.getTime() - DAY)) => matching.matchDeals({ now: NOW, since });

let user: { id: string };
beforeEach(async () => {
  user = await createUser("shopper@example.test");
});

/** Creates an alert through the service, dated a day before NOW so new deals can match it. */
async function alert(input: Record<string, string>, owner = user) {
  const result = await service.create(owner.id, alertFormSchema.parse(input));
  expect(result).toEqual({ ok: true });
  const created = await testDb.alert.findFirstOrThrow({
    where: { userId: owner.id },
    orderBy: { createdAt: "desc" },
  });
  return testDb.alert.update({
    where: { id: created.id },
    data: { createdAt: new Date(NOW.getTime() - DAY) },
  });
}

const notifiedTitles = async (owner = user) =>
  (await service.notifications(owner.id)).items.map((n) => n.subject.replace("Price alert: ", ""));

describe("creating alerts", () => {
  it("stores keyword, category, retailer and price criteria", async () => {
    const kitchen = await testDb.category.create({ data: { slug: "kitchen", name: "Kitchen" } });
    const deal = await createLiveDeal(NOW, "Glass Kettle");
    const created = await alert({
      keyword: "kettle",
      category: "kitchen",
      retailer: deal.retailer.slug,
      max: "50",
      discount: "20",
    });
    expect(created).toMatchObject({
      keyword: "kettle",
      categoryId: kitchen.id,
      retailerId: deal.retailer.id,
      productId: null,
      maxPrice: 5000,
      minDiscountBps: 2000,
      isActive: true,
    });
    expect(await service.list(user.id)).toEqual([
      expect.objectContaining({
        watching: `“kettle” in Kitchen at ${deal.retailer.name}`,
        condition: "£50.00 or less, 20% off or more",
      }),
    ]);
  });

  it("watches the product behind a live deal", async () => {
    const deal = await createLiveDeal(NOW, "Glass Kettle");
    expect(await service.dealForAlert(deal.deal.slug)).toEqual({
      productTitle: "Glass Kettle",
      dealPrice: 8000,
    });
    const created = await alert({ deal: deal.deal.slug, max: "75" });
    expect(created).toMatchObject({ productId: deal.product.id, keyword: null, maxPrice: 7500 });
  });

  it("rejects unknown or unavailable targets", async () => {
    const pending = await createPendingDeal(NOW, { externalId: "pending" });
    await testDb.retailer.update({
      where: { id: pending.retailer.id },
      data: { status: "PAUSED" },
    });
    const create = (input: Record<string, string>) =>
      service.create(user.id, alertFormSchema.parse(input));

    expect(await create({ keyword: "the" })).toEqual({ ok: false, error: "VAGUE_KEYWORD" });
    expect(await create({ keyword: "%_" })).toEqual({ ok: false, error: "VAGUE_KEYWORD" });
    expect(await create({ category: "nope" })).toEqual({ ok: false, error: "UNKNOWN_CATEGORY" });
    expect(await create({ keyword: "kettle", retailer: pending.retailer.slug })).toEqual({
      ok: false,
      error: "UNKNOWN_RETAILER",
    });
    expect(await create({ deal: pending.deal.slug })).toEqual({
      ok: false,
      error: "UNKNOWN_DEAL",
    });
    expect(await testDb.alert.count()).toBe(0);
  });

  it(`limits each account to ${MAX_ALERTS_PER_USER} alerts`, async () => {
    await testDb.alert.createMany({
      data: Array.from({ length: MAX_ALERTS_PER_USER }, (_, i) => ({
        userId: user.id,
        keyword: `kettle ${i}`,
      })),
    });
    expect(await service.create(user.id, alertFormSchema.parse({ keyword: "toaster" }))).toEqual({
      ok: false,
      error: "LIMIT_REACHED",
    });
  });
});

describe("ownership", () => {
  it("only lets the owner see, pause, resume and delete an alert", async () => {
    const other = await createUser("other@example.test");
    const mine = await alert({ keyword: "kettle" });

    expect(await service.list(other.id)).toEqual([]);
    expect(await service.setActive(other.id, mine.id, false)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await service.delete(other.id, mine.id)).toEqual({ ok: false, error: "NOT_FOUND" });

    expect(await service.setActive(user.id, mine.id, false)).toEqual({ ok: true });
    expect((await service.list(user.id))[0]?.isActive).toBe(false);
    expect(await service.setActive(user.id, mine.id, true)).toEqual({ ok: true });
    expect(await service.delete(user.id, mine.id)).toEqual({ ok: true });
    expect(await testDb.alert.count()).toBe(0);
  });

  it("only lets the owner read their notifications", async () => {
    const other = await createUser("other@example.test");
    await alert({ keyword: "kettle" });
    await createLiveDeal(NOW, "Glass Kettle");
    await match();
    const [notification] = (await service.notifications(user.id)).items;

    expect(await service.markRead(other.id, NOW, notification!.id)).toBe(0);
    expect((await service.notifications(user.id)).unread).toBe(1);
    expect(await service.markRead(user.id, NOW, notification!.id)).toBe(1);
    expect(await service.notifications(user.id)).toMatchObject({
      unread: 0,
      items: [{ read: true }],
    });
  });
});

describe("matching", () => {
  it("matches keywords against the product text, not typos", async () => {
    await alert({ keyword: "kettles" });
    await createLiveDeal(NOW, "Glass Kettle");
    await createLiveDeal(NOW, "Kettel Descaler", { publishedMinutesAgo: 1 });
    await createLiveDeal(NOW, "Toaster", {
      description: "Matches any kettle",
      publishedMinutesAgo: 2,
    });
    expect(await match()).toEqual({ notified: 2, alerts: 1, more: false, pushed: 0 });
    expect((await notifiedTitles()).sort()).toEqual(["Glass Kettle", "Toaster"]);
  });

  it("matches a category and its subcategories", async () => {
    const home = await testDb.category.create({ data: { slug: "home", name: "Home" } });
    const kitchen = await testDb.category.create({
      data: { slug: "kitchen", name: "Kitchen", parentId: home.id },
    });
    const kettles = await testDb.category.create({
      data: { slug: "kettles", name: "Kettles", parentId: kitchen.id },
    });
    const audio = await testDb.category.create({ data: { slug: "audio", name: "Audio" } });
    await alert({ category: "home" });
    await createLiveDeal(NOW, "Glass Kettle", { categoryId: kettles.id });
    await createLiveDeal(NOW, "Speaker", { categoryId: audio.id });
    await createLiveDeal(NOW, "Uncategorised Thing");
    await match();
    expect(await notifiedTitles()).toEqual(["Glass Kettle"]);
  });

  it("applies retailer, maximum price and minimum discount", async () => {
    const cheap = await createLiveDeal(NOW, "Cheap Kettle", { price: 2000, discount: 10 });
    await createLiveDeal(NOW, "Posh Kettle", { price: 9000, discount: 40 });
    await createLiveDeal(NOW, "Mid Kettle", { price: 4000, discount: 30 });
    const priced = await createUser("priced@example.test");
    const discounted = await createUser("discounted@example.test");
    const atShop = await createUser("shop@example.test");
    await alert({ keyword: "kettle", max: "40" }, priced);
    await alert({ keyword: "kettle", discount: "30" }, discounted);
    await alert({ keyword: "kettle", retailer: cheap.retailer.slug }, atShop);
    await match();
    expect((await notifiedTitles(priced)).sort()).toEqual(["Cheap Kettle", "Mid Kettle"]);
    expect((await notifiedTitles(discounted)).sort()).toEqual(["Mid Kettle", "Posh Kettle"]);
    expect(await notifiedTitles(atShop)).toEqual(["Cheap Kettle"]);
  });

  it("matches a product alert only on that product's next deal", async () => {
    const first = await createLiveDeal(NOW, "Glass Kettle", { publishedMinutesAgo: 60 * 30 });
    const watching = await alert({ deal: first.deal.slug });
    expect(watching.productId).toBe(first.product.id);
    await createLiveDeal(NOW, "Other Kettle");
    // The deal the alert was created from was already on the site, so it doesn't fire.
    await match(new Date(NOW.getTime() - 2 * DAY));
    expect(await notifiedTitles()).toEqual([]);

    // Stand-in for the product's next deal: one published after the alert was created.
    await testDb.deal.update({ where: { id: first.deal.id }, data: { publishedAt: NOW } });
    await match();
    expect(await notifiedTitles()).toEqual(["Glass Kettle"]);
  });

  it("notifies once per alert and deal, and records when an alert fired", async () => {
    const kettle = await alert({ keyword: "kettle" });
    await createLiveDeal(NOW, "Glass Kettle");
    expect(await match()).toMatchObject({ notified: 1, alerts: 1 });
    expect(await match()).toMatchObject({ notified: 0, alerts: 0 });
    expect(await testDb.notification.findMany()).toEqual([
      expect.objectContaining({
        userId: user.id,
        alertId: kettle.id,
        channel: "IN_APP",
        status: "SENT",
        sentAt: NOW,
        readAt: null,
        body: expect.stringMatching(/^Glass Kettle is £80\.00 at Test Retailer \d+, 20% below/),
      }),
    ]);
    expect(
      (await testDb.alert.findUniqueOrThrow({ where: { id: kettle.id } })).lastTriggeredAt,
    ).toEqual(NOW);
  });

  it("ignores paused alerts, alerts newer than the deal and deals that aren't public", async () => {
    const paused = await alert({ keyword: "kettle" });
    await service.setActive(user.id, paused.id, false);
    const late = await createUser("late@example.test");
    await service.create(late.id, alertFormSchema.parse({ keyword: "kettle" })); // created now
    const watcher = await createUser("watcher@example.test");
    await alert({ keyword: "kettle" }, watcher);

    await createLiveDeal(NOW, "Live Kettle");
    await createPendingDeal(NOW, { title: "Pending Kettle", externalId: "pending" });
    const delisted = await createLiveDeal(NOW, "Delisted Kettle");
    await testDb.product.update({ where: { id: delisted.product.id }, data: { isActive: false } });
    const pausedShop = await createLiveDeal(NOW, "Paused Shop Kettle");
    await testDb.retailer.update({
      where: { id: pausedShop.retailer.id },
      data: { status: "PAUSED" },
    });
    await createLiveDeal(NOW, "Old Kettle", { publishedMinutesAgo: 60 * 48 });

    await match();
    expect(await notifiedTitles(user)).toEqual([]);
    expect(await notifiedTitles(late)).toEqual([]);
    expect(await notifiedTitles(watcher)).toEqual(["Live Kettle"]);
  });

  it("can match only the deals it is given, in batches", async () => {
    await alert({ keyword: "kettle" });
    const a = await createLiveDeal(NOW, "Kettle A");
    await createLiveDeal(NOW, "Kettle B");
    await createLiveDeal(NOW, "Kettle C");
    expect(
      await matching.matchDeals({ now: NOW, since: new Date(0), dealIds: [a.deal.id] }),
    ).toMatchObject({ notified: 1 });

    const small = createAlertMatchingService(testDb, { batchSize: 1 });
    expect(await small.matchDeals({ now: NOW, since: new Date(0) })).toEqual({
      notified: 1,
      alerts: 1,
      more: true,
      pushed: 0,
    });
    expect(await small.matchDeals({ now: NOW, since: new Date(0) })).toMatchObject({ notified: 1 });
    expect(await small.matchDeals({ now: NOW, since: new Date(0) })).toEqual({
      notified: 0,
      alerts: 0,
      more: false,
      pushed: 0,
    });
  });

  it("stops linking a notification once its deal ends", async () => {
    await alert({ keyword: "kettle" });
    const live = await createLiveDeal(NOW, "Glass Kettle");
    await match();
    expect((await service.notifications(user.id)).items[0]?.dealSlug).toBe(live.deal.slug);
    await testDb.deal.update({ where: { id: live.deal.id }, data: { status: "EXPIRED" } });
    expect((await service.notifications(user.id)).items[0]?.dealSlug).toBeNull();
  });
});

describe("process-alerts job", () => {
  it("notifies matches for deals published in the last day", async () => {
    await alert({ keyword: "kettle" });
    await createLiveDeal(NOW, "Glass Kettle");
    const report = await runJob("process-alerts", { client: testDb, now: NOW, env: {} });
    expect(report).toEqual({
      job: "process-alerts",
      status: "completed",
      alerts: { notified: 1, alerts: 1, more: false, pushed: 0 },
    });
    expect(await service.markRead(user.id, NOW)).toBe(1);
  });
});
