import { describe, expect, it } from "vitest";
import { runSeed } from "../../prisma/seed/run-seed";
import { createAdminRepository } from "@/server/db/repositories/admin.repository";
import { getDealDetail, getProductDetail } from "@/server/services/admin";
import { createAdminCatalogueService } from "@/server/services/admin/admin-catalogue.service";
import { createAdminDealsService } from "@/server/services/admin/admin-deals.service";
import { createAdminUsersService } from "@/server/services/admin/admin-users.service";
import { createPendingDeal, createUser } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 5, 1, 12));
const deals = createAdminDealsService(testDb);
const catalogue = createAdminCatalogueService(testDb);
const users = createAdminUsersService(testDb);
const reads = createAdminRepository(testDb);

async function editor() {
  const user = await createUser(`editor-${Math.random()}@example.test`, "EDITOR");
  return { id: user.id, role: user.role };
}

describe("deal actions", () => {
  it("approves then publishes, recording who did it", async () => {
    const { deal } = await createPendingDeal(NOW);
    const actor = await editor();

    expect(
      await deals.applyAction({ actor, dealId: deal.id, action: "approve", now: NOW }),
    ).toEqual({
      ok: true,
      value: { status: "APPROVED" },
    });
    const later = new Date(NOW.getTime() + 60_000);
    expect(
      await deals.applyAction({ actor, dealId: deal.id, action: "publish", now: later }),
    ).toMatchObject({ ok: true });

    const saved = await testDb.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(saved).toMatchObject({
      status: "PUBLISHED",
      reviewedById: actor.id,
      reviewedAt: NOW,
      publishedAt: later,
    });
    const audit = await testDb.auditLog.findMany({
      where: { entityId: deal.id, actorId: actor.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => [a.action, a.diff])).toEqual([
      ["deal.approve", { from: "PENDING_REVIEW", to: "APPROVED" }],
      ["deal.publish", { from: "APPROVED", to: "PUBLISHED" }],
    ]);
  });

  it("requires a reason to reject, and stores it", async () => {
    const { deal } = await createPendingDeal(NOW);
    const actor = await editor();
    expect(
      await deals.applyAction({ actor, dealId: deal.id, action: "reject", reason: "  ", now: NOW }),
    ).toEqual({
      ok: false,
      error: "REASON_REQUIRED",
    });
    expect(
      await deals.applyAction({
        actor,
        dealId: deal.id,
        action: "reject",
        reason: "Price error",
        now: NOW,
      }),
    ).toMatchObject({ ok: true });
    expect(await testDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Price error",
    });
  });

  it("refuses transitions the workflow doesn't allow", async () => {
    const { deal } = await createPendingDeal(NOW);
    expect(
      await deals.applyAction({
        actor: await editor(),
        dealId: deal.id,
        action: "publish",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "INVALID_TRANSITION",
    });
  });

  it("refuses non-editors and unknown deals", async () => {
    const { deal } = await createPendingDeal(NOW);
    const user = await createUser("plain@example.test");
    expect(
      await deals.applyAction({
        actor: { id: user.id, role: "USER" },
        dealId: deal.id,
        action: "approve",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
    expect(
      await deals.applyAction({
        actor: await editor(),
        dealId: "missing",
        action: "approve",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect((await testDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe(
      "PENDING_REVIEW",
    );
  });

  it("lets only one of two simultaneous approvals through", async () => {
    const { deal } = await createPendingDeal(NOW);
    const [a, b] = [await editor(), await editor()];
    const results = await Promise.all([
      deals.applyAction({ actor: a, dealId: deal.id, action: "approve", now: NOW }),
      deals.applyAction({ actor: b, dealId: deal.id, action: "approve", now: NOW }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      await testDb.auditLog.count({ where: { entityId: deal.id, action: "deal.approve" } }),
    ).toBe(1);
  });
});

describe("deal content", () => {
  const content = {
    title: "Great headphones deal",
    summary: "Lowest price yet",
    description: null,
    isFeatured: true,
    expiresAt: new Date("2026-07-01T00:00:00Z"),
  };

  it("saves edits and audits only the changed fields", async () => {
    const { deal } = await createPendingDeal(NOW);
    const actor = await editor();
    expect(await deals.updateContent({ actor, dealId: deal.id, content, now: NOW })).toEqual({
      ok: true,
      value: undefined,
    });

    expect(await testDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject(content);
    const edit = await testDb.auditLog.findFirstOrThrow({
      where: { entityId: deal.id, action: "deal.edit" },
    });
    expect(Object.keys(edit.diff as object).sort()).toEqual([
      "expiresAt",
      "isFeatured",
      "summary",
      "title",
    ]);
    expect((edit.diff as Record<string, unknown>).expiresAt).toEqual({
      from: null,
      to: "2026-07-01T00:00:00.000Z",
    });

    await deals.updateContent({ actor, dealId: deal.id, content, now: NOW });
    expect(await testDb.auditLog.count({ where: { entityId: deal.id, action: "deal.edit" } })).toBe(
      1,
    );
  });

  it("refuses edits to finished deals and from non-editors", async () => {
    const { deal } = await createPendingDeal(NOW);
    await testDb.deal.update({ where: { id: deal.id }, data: { status: "EXPIRED" } });
    expect(
      await deals.updateContent({ actor: await editor(), dealId: deal.id, content, now: NOW }),
    ).toEqual({
      ok: false,
      error: "NOT_EDITABLE",
    });
    expect(
      await deals.updateContent({
        actor: { id: "x", role: "USER" },
        dealId: deal.id,
        content,
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
  });
});

describe("retailers and categories", () => {
  it("lets admins change a retailer's status and trust score", async () => {
    await runSeed(testDb, { includeDevelopmentData: true });
    const retailer = await testDb.retailer.findUniqueOrThrow({ where: { slug: "mock-retailer" } });
    const admin = await createUser("admin@example.test", "ADMIN");

    expect(
      await catalogue.updateRetailer({
        actor: await editor(),
        retailerId: retailer.id,
        status: "PAUSED",
        trustScore: 10,
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(
      await catalogue.updateRetailer({
        actor: { id: admin.id, role: "ADMIN" },
        retailerId: retailer.id,
        status: "PAUSED",
        trustScore: 80,
        now: NOW,
      }),
    ).toMatchObject({ ok: true });
    expect(await testDb.retailer.findUniqueOrThrow({ where: { id: retailer.id } })).toMatchObject({
      status: "PAUSED",
      trustScore: 80,
    });
    expect(
      await testDb.auditLog.findFirst({ where: { action: "retailer.update", actorId: admin.id } }),
    ).not.toBeNull();
  });

  it("creates categories with a slug, rejects duplicates, and keeps slugs on rename", async () => {
    const admin = await createUser("admin@example.test", "ADMIN");
    const actor = { id: admin.id, role: "ADMIN" };
    const created = await catalogue.createCategory({
      actor,
      input: { name: "Garden & Outdoor", parentId: null, sortOrder: 1 },
      now: NOW,
    });
    expect(created).toEqual({ ok: true, value: { slug: "garden-and-outdoor" } });
    expect(
      await catalogue.createCategory({
        actor,
        input: { name: "garden and outdoor", parentId: null, sortOrder: 1 },
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "DUPLICATE",
    });
    expect(
      await catalogue.createCategory({
        actor,
        input: { name: "Tools", parentId: "missing", sortOrder: 0 },
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "INVALID_PARENT",
    });

    const garden = await testDb.category.findUniqueOrThrow({
      where: { slug: "garden-and-outdoor" },
    });
    await catalogue.updateCategory({
      actor,
      categoryId: garden.id,
      input: { name: "Garden", parentId: null, sortOrder: 2 },
      now: NOW,
    });
    expect(await testDb.category.findUniqueOrThrow({ where: { id: garden.id } })).toMatchObject({
      name: "Garden",
      slug: "garden-and-outdoor",
    });
  });

  it("prevents category cycles", async () => {
    const admin = await createUser("admin@example.test", "ADMIN");
    const actor = { id: admin.id, role: "ADMIN" };
    await catalogue.createCategory({
      actor,
      input: { name: "Parent", parentId: null, sortOrder: 0 },
      now: NOW,
    });
    const parent = await testDb.category.findUniqueOrThrow({ where: { slug: "parent" } });
    await catalogue.createCategory({
      actor,
      input: { name: "Child", parentId: parent.id, sortOrder: 0 },
      now: NOW,
    });
    const child = await testDb.category.findUniqueOrThrow({ where: { slug: "child" } });

    expect(
      await catalogue.updateCategory({
        actor,
        categoryId: parent.id,
        input: { name: "Parent", parentId: child.id, sortOrder: 0 },
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "INVALID_PARENT",
    });
    expect(
      await catalogue.updateCategory({
        actor,
        categoryId: parent.id,
        input: { name: "Parent", parentId: parent.id, sortOrder: 0 },
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "INVALID_PARENT",
    });
  });

  it("stops editors changing categories", async () => {
    expect(
      await catalogue.createCategory({
        actor: await editor(),
        input: { name: "Nope", parentId: null, sortOrder: 0 },
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
  });
});

describe("user roles", () => {
  it("lets an admin change another user's role, with an audit entry", async () => {
    const admin = await createUser("admin@example.test", "ADMIN");
    const target = await createUser("someone@example.test");
    expect(
      await users.setRole({
        actor: { id: admin.id, role: "ADMIN" },
        userId: target.id,
        role: "EDITOR",
        now: NOW,
      }),
    ).toMatchObject({ ok: true });
    expect((await testDb.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe("EDITOR");
    expect(
      await testDb.auditLog.findFirstOrThrow({ where: { entityId: target.id } }),
    ).toMatchObject({
      action: "user.set-role",
      actorId: admin.id,
      diff: { from: "USER", to: "EDITOR" },
    });
  });

  it("refuses self-changes, non-admins and demoting the last admin", async () => {
    const admin = await createUser("admin@example.test", "ADMIN");
    const other = await createUser("other@example.test");
    expect(
      await users.setRole({
        actor: { id: admin.id, role: "ADMIN" },
        userId: admin.id,
        role: "USER",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "SELF_CHANGE",
    });
    expect(
      await users.setRole({ actor: await editor(), userId: other.id, role: "ADMIN", now: NOW }),
    ).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
    // A stale session still claiming ADMIN must not be able to remove the only real admin.
    const demoted = await createUser("was-admin@example.test", "USER");
    expect(
      await users.setRole({
        actor: { id: demoted.id, role: "ADMIN" },
        userId: admin.id,
        role: "USER",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      error: "LAST_ADMIN",
    });
    expect((await testDb.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("ADMIN");
  });
});

describe("admin read queries", () => {
  it("filters, searches and pages deals", async () => {
    await createPendingDeal(NOW, { title: "Alpha Speaker", externalId: "A" });
    const { deal } = await createPendingDeal(NOW, { title: "Beta Kettle", externalId: "B" });
    await testDb.deal.update({ where: { id: deal.id }, data: { status: "PUBLISHED" } });

    expect((await reads.listDeals({ skip: 0, take: 10 })).total).toBe(2);
    expect(
      (await reads.listDeals({ statuses: ["PUBLISHED"], skip: 0, take: 10 })).items.map(
        (d) => d.title,
      ),
    ).toEqual(["Beta Kettle"]);
    expect(
      (await reads.listDeals({ q: "alpha", skip: 0, take: 10 })).items.map((d) => d.title),
    ).toEqual(["Alpha Speaker"]);
    const firstPage = await reads.listDeals({ skip: 0, take: 1 });
    expect(firstPage).toMatchObject({ total: 2 });
    expect(firstPage.items).toHaveLength(1);
  });

  it("summarises the platform for the overview", async () => {
    await createPendingDeal(NOW);
    const o = await reads.overview(new Date(0));
    expect(o.dealsByStatus).toEqual([{ status: "PENDING_REVIEW", _count: { _all: 1 } }]);
    expect(o.activeProducts).toBe(1);
    expect(o.recentAudit[0]).toMatchObject({ action: "deal.detect", actor: null });
  });

  it("builds deal and product detail views with price history", async () => {
    const { deal, product } = await createPendingDeal(NOW);
    const dealDetail = await getDealDetail(deal.id, NOW);
    expect(dealDetail?.observations).toHaveLength(31);
    expect(dealDetail?.stats.current).toBe(8000);
    expect(dealDetail?.audit.map((a) => a.action)).toEqual(["deal.detect"]);

    const productDetail = await getProductDetail(product.id, NOW);
    expect(productDetail?.product.deals).toHaveLength(1);
    expect(productDetail?.history?.stats.lowest).toBe(8000);

    expect(await getDealDetail("missing", NOW)).toBeNull();
    expect(await getProductDetail("missing", NOW)).toBeNull();
  });
});
