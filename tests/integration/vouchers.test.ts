import { describe, expect, it } from "vitest";
import { voucherFormSchema } from "@/lib/validation/vouchers";
import { createMemoryRateLimiter } from "@/server/rate-limit/rate-limiter";
import { createReportsService } from "@/server/services/reports/reports.service";
import { createVouchersService } from "@/server/services/vouchers/vouchers.service";
import { createLiveDeal, createPendingDeal, createRetailer, createUser } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 10, 5, 12));
const DAY = 86_400_000;
const service = createVouchersService(testDb);
const reportsService = (limit = 100) =>
  createReportsService(testDb, {
    hashSecret: "test-secret-0123456789abcdef0123456789",
    rateLimiter: createMemoryRateLimiter({ limit, windowMs: 60_000 }),
  });

async function editor() {
  const user = await createUser(`editor-${Math.random()}@example.test`, "EDITOR");
  return { id: user.id, role: user.role };
}

async function addVoucher(retailerId: string, fields: Record<string, string> = {}) {
  const actor = await editor();
  const result = await service.create({
    actor,
    input: voucherFormSchema.parse({ retailerId, title: "10% off", code: "save10", ...fields }),
    now: NOW,
  });
  expect(result).toEqual({ ok: true, value: undefined });
  return testDb.coupon.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
}

describe("vouchers", () => {
  it("lists live vouchers only, ending soonest first", async () => {
    const shop = await createRetailer();
    const soon = await addVoucher(shop.id, { code: "SOON", validUntil: "2026-11-06T12:00" });
    const later = await addVoucher(shop.id, { code: "LATER", validUntil: "2026-12-01T12:00" });
    const open = await addVoucher(shop.id, { code: "", title: "Free delivery" });
    await addVoucher(shop.id, { code: "GONE", validUntil: "2026-11-01T12:00" });
    const off = await addVoucher(shop.id, { code: "OFF" });
    await testDb.coupon.update({ where: { id: off.id }, data: { isActive: false } });
    const future = await addVoucher(shop.id, { code: "FUTURE" });
    await testDb.coupon.update({
      where: { id: future.id },
      data: { validFrom: new Date(NOW.getTime() + DAY) },
    });
    const paused = await createRetailer();
    await testDb.retailer.update({ where: { id: paused.id }, data: { status: "PAUSED" } });
    await addVoucher(paused.id, { code: "PAUSED" });

    const live = await service.listLive(NOW);
    expect(live.map((v) => v.code)).toEqual(["SOON", "LATER", null]);
    expect(live[2]).toMatchObject({ id: open.id, title: "Free delivery", dealSlug: null });
    expect(live[0]).toMatchObject({ id: soon.id, retailer: { slug: shop.slug } });
    expect(later.code).toBe("LATER");
  });

  it("ties a voucher to a deal at the same retailer, and shows it while the deal is live", async () => {
    const live = await createLiveDeal(NOW, "Glass Kettle");
    const voucher = await addVoucher(live.retailer.id, { deal: live.deal.slug });
    expect(await service.forDeal(live.deal.id, NOW)).toEqual([
      expect.objectContaining({ id: voucher.id, dealSlug: live.deal.slug }),
    ]);
    await testDb.deal.update({ where: { id: live.deal.id }, data: { status: "EXPIRED" } });
    expect((await service.listLive(NOW))[0]?.dealSlug).toBeNull();

    const other = await createRetailer();
    expect(
      await service.create({
        actor: await editor(),
        input: voucherFormSchema.parse({
          retailerId: other.id,
          title: "Nope",
          deal: live.deal.slug,
        }),
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "WRONG_DEAL" });
    expect(
      await service.create({
        actor: await editor(),
        input: voucherFormSchema.parse({ retailerId: "missing", title: "Nope" }),
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("switches vouchers off and on, deletes them, audits, and needs an editor", async () => {
    const shop = await createRetailer();
    const voucher = await addVoucher(shop.id);
    const actor = await editor();
    expect(
      await service.change({ actor, couponId: voucher.id, action: "deactivate", now: NOW }),
    ).toMatchObject({ ok: true });
    expect(await service.listLive(NOW)).toEqual([]);
    expect(
      await service.change({ actor, couponId: voucher.id, action: "activate", now: NOW }),
    ).toMatchObject({ ok: true });
    expect(await service.listLive(NOW)).toHaveLength(1);
    expect(
      await service.change({ actor, couponId: voucher.id, action: "delete", now: NOW }),
    ).toMatchObject({ ok: true });
    expect(await testDb.coupon.count()).toBe(0);
    expect(
      await testDb.auditLog.findMany({
        where: { entityId: voucher.id },
        select: { action: true },
        orderBy: { createdAt: "asc" },
      }),
    ).toEqual(
      expect.arrayContaining([
        { action: "coupon.create" },
        { action: "coupon.deactivate" },
        { action: "coupon.activate" },
        { action: "coupon.delete" },
      ]),
    );
    expect(
      await service.change({ actor, couponId: voucher.id, action: "delete", now: NOW }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });

    const user = await createUser("shopper@example.test");
    const asUser = { id: user.id, role: user.role };
    expect(
      await service.change({ actor: asUser, couponId: "x", action: "delete", now: NOW }),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(
      await service.create({
        actor: asUser,
        input: voucherFormSchema.parse({ retailerId: shop.id, title: "Hack" }),
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
  });
});

describe("reports", () => {
  it("takes one report per person per deal and queues it for editors without hiding the deal", async () => {
    const { deal } = await createLiveDeal(NOW, "Glass Kettle");
    const reports = reportsService();
    const report = (ip: string, reason = "EXPIRED" as const) =>
      reports.submit({
        input: { target: "deal", id: deal.id, reason, note: null },
        userId: null,
        ip,
        now: NOW,
      });

    expect(await report("1.1.1.1")).toEqual({ ok: true, hidden: false });
    expect(await report("1.1.1.1", "OTHER" as never)).toEqual({ ok: true, hidden: false }); // repeat: ignored
    for (const ip of ["2.2.2.2", "3.3.3.3", "4.4.4.4"]) await report(ip);
    expect(await testDb.report.count()).toBe(4);
    expect((await testDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe(
      "PUBLISHED",
    );

    const [group] = await reports.openGroups();
    expect(group).toMatchObject({
      target: "DEAL",
      targetId: deal.id,
      label: "Glass Kettle",
      href: `/admin/deals/${deal.id}`,
      live: true,
      count: 4,
      reasons: { EXPIRED: 4 },
    });
    expect(await reports.countOpen()).toBe(4);
    // Raw IPs are never stored.
    expect((await testDb.report.findFirstOrThrow()).reporterKey).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it("hides a voucher after three people say it ended or doesn't work", async () => {
    const shop = await createRetailer();
    const voucher = await addVoucher(shop.id);
    const reports = reportsService();
    const user = await createUser("reporter@example.test");
    const report = (
      who: { ip?: string; userId?: string },
      reason: "CODE_NOT_WORKING" | "OTHER" | "EXPIRED",
    ) =>
      reports.submit({
        input: { target: "coupon", id: voucher.id, reason, note: "tried at checkout" },
        userId: who.userId ?? null,
        ip: who.ip ?? null,
        now: NOW,
      });

    expect(await report({ ip: "1.1.1.1" }, "CODE_NOT_WORKING")).toEqual({
      ok: true,
      hidden: false,
    });
    expect(await report({ ip: "2.2.2.2" }, "OTHER")).toEqual({ ok: true, hidden: false });
    expect(await report({ userId: user.id }, "EXPIRED")).toEqual({ ok: true, hidden: false });
    expect(await report({ ip: "3.3.3.3" }, "CODE_NOT_WORKING")).toEqual({ ok: true, hidden: true });

    expect((await testDb.coupon.findUniqueOrThrow({ where: { id: voucher.id } })).isActive).toBe(
      false,
    );
    expect(await testDb.report.count({ where: { status: "OPEN" } })).toBe(0);
    expect(
      await testDb.auditLog.findFirst({ where: { action: "coupon.auto-deactivate" } }),
    ).toMatchObject({ actorId: null });
    // Hidden: further reports find nothing to report.
    expect(await report({ ip: "4.4.4.4" }, "EXPIRED")).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("refuses reports on things that aren't live, and rate-limits each reporter", async () => {
    const pending = await createPendingDeal(NOW, { externalId: "p" });
    const reports = reportsService(2);
    const submit = (id: string, target: "deal" | "coupon" = "deal") =>
      reports.submit({
        input: { target, id, reason: "EXPIRED", note: null },
        userId: null,
        ip: "9.9.9.9",
        now: NOW,
      });
    expect(await submit(pending.deal.id)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await submit("missing", "coupon")).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await submit("anything")).toEqual({ ok: false, error: "RATE_LIMITED" });
  });

  it("lets editors close or dismiss reports, and switching a voucher off closes its reports", async () => {
    const { deal } = await createLiveDeal(NOW, "Glass Kettle");
    const shop = await createRetailer();
    const voucher = await addVoucher(shop.id, { code: "BROKEN" });
    const reports = reportsService();
    await reports.submit({
      input: { target: "deal", id: deal.id, reason: "WRONG_PRICE", note: "£90 now" },
      userId: null,
      ip: "1.1.1.1",
      now: NOW,
    });
    await reports.submit({
      input: { target: "coupon", id: voucher.id, reason: "CODE_NOT_WORKING", note: null },
      userId: null,
      ip: "1.1.1.1",
      now: NOW,
    });

    const groups = await reports.openGroups();
    expect(groups.map((g) => g.label).sort()).toEqual([`BROKEN (${shop.name})`, "Glass Kettle"]);
    expect(groups.find((g) => g.target === "DEAL")?.notes).toEqual(["£90 now"]);

    const actor = await editor();
    expect(
      await reports.close({ actor, targetId: deal.id, outcome: "DISMISSED", now: NOW }),
    ).toEqual({ ok: true, value: undefined });
    expect(
      await reports.close({ actor, targetId: deal.id, outcome: "DISMISSED", now: NOW }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    await service.change({ actor, couponId: voucher.id, action: "deactivate", now: NOW });
    expect(await reports.countOpen()).toBe(0);
    expect(await testDb.report.findFirst({ where: { targetId: deal.id } })).toMatchObject({
      status: "DISMISSED",
      resolvedById: actor.id,
      resolvedAt: NOW,
    });

    const user = await createUser("viewer@example.test");
    expect(
      await reports.close({
        actor: { id: user.id, role: user.role },
        targetId: deal.id,
        outcome: "RESOLVED",
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("enforces one target per report in the database", async () => {
    const { deal } = await createLiveDeal(NOW, "Glass Kettle");
    await expect(
      testDb.report.create({
        data: {
          target: "COUPON",
          targetId: deal.id,
          dealId: deal.id,
          reason: "OTHER",
          reporterKey: "x",
        },
      }),
    ).rejects.toThrow(/Report_one_target/);
  });
});
