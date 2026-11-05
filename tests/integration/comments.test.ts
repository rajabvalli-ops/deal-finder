import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "@/server/rate-limit/rate-limiter";
import { createCommentsService } from "@/server/services/comments/comments.service";
import { createLiveDeal, createUser } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 10, 5, 12));
const service = (limit = 100) =>
  createCommentsService(testDb, {
    rateLimiter: createMemoryRateLimiter({ limit, windowMs: 60_000 }),
  });

describe("comments", () => {
  it("shows visible comments newest first with first names only, and lets authors delete theirs", async () => {
    const comments = service();
    const { deal } = await createLiveDeal(NOW, "Talked Kettle");
    const sam = await testDb.user.create({
      data: { email: "sam@example.test", name: "Sam Smith" },
    });
    const anon = await createUser("anon@example.test");

    await comments.post({ userId: sam.id, slug: deal.slug, body: "Got one!", now: NOW });
    await comments.post({
      userId: anon.id,
      slug: deal.slug,
      body: "Price went up",
      now: new Date(NOW.getTime() + 60_000),
    });

    const forSam = await comments.forDeal(deal.slug, sam.id);
    expect(forSam).toEqual({
      total: 2,
      items: [
        expect.objectContaining({ author: "Member", body: "Price went up", mine: false }),
        expect.objectContaining({ author: "Sam", body: "Got one!", mine: true }),
      ],
    });
    // The author's email or user id is never part of what's shown.
    expect(JSON.stringify(forSam)).not.toMatch(/example\.test|Smith/);
    expect((await comments.forDeal(deal.slug, null))?.items.every((c) => !c.mine)).toBe(true);

    const samsComment = forSam!.items[1]!.id;
    expect(await comments.delete(anon.id, samsComment)).toBe(false);
    expect(await comments.delete(sam.id, samsComment)).toBe(true);
    expect((await comments.forDeal(deal.slug, null))?.total).toBe(1);
  });

  it("only takes comments on public deals, and rate-limits", async () => {
    const { deal } = await createLiveDeal(NOW, "Closed Kettle");
    const user = await createUser("chatty@example.test");
    const comments = service(1);
    expect(
      await comments.post({ userId: user.id, slug: deal.slug, body: "one", now: NOW }),
    ).toEqual({
      ok: true,
    });
    expect(
      await comments.post({ userId: user.id, slug: deal.slug, body: "two", now: NOW }),
    ).toEqual({
      ok: false,
      error: "RATE_LIMITED",
    });
    await testDb.deal.update({ where: { id: deal.id }, data: { status: "EXPIRED" } });
    expect(
      await service().post({ userId: user.id, slug: deal.slug, body: "three", now: NOW }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await service().forDeal(deal.slug, user.id)).toBeNull();
  });

  it("lets editors hide and show comments, and audits it", async () => {
    const comments = service();
    const { deal } = await createLiveDeal(NOW, "Moderated Kettle");
    const user = await createUser("rude@example.test");
    const editor = await createUser("mod@example.test", "EDITOR");
    await comments.post({ userId: user.id, slug: deal.slug, body: "spam", now: NOW });
    const [comment] = await comments.listForAdmin();

    expect(
      await comments.moderate({
        actor: { id: user.id, role: "USER" },
        commentId: comment!.id,
        action: "hide",
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "FORBIDDEN" });
    const actor = { id: editor.id, role: editor.role };
    expect(
      await comments.moderate({ actor, commentId: comment!.id, action: "hide", now: NOW }),
    ).toEqual({ ok: true, value: undefined });
    expect((await comments.forDeal(deal.slug, null))?.total).toBe(0);
    expect(await testDb.comment.findUnique({ where: { id: comment!.id } })).toMatchObject({
      status: "HIDDEN",
      hiddenById: editor.id,
      hiddenAt: NOW,
    });

    await comments.moderate({ actor, commentId: comment!.id, action: "show", now: NOW });
    expect((await comments.forDeal(deal.slug, null))?.total).toBe(1);
    expect(await testDb.auditLog.count({ where: { entityType: "Comment" } })).toBe(2);
    expect(
      await comments.moderate({ actor, commentId: "missing", action: "hide", now: NOW }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("limits comment length in the database", async () => {
    const { deal } = await createLiveDeal(NOW, "Long Kettle");
    const user = await createUser("long@example.test");
    await expect(
      testDb.comment.create({ data: { dealId: deal.id, userId: user.id, body: "x".repeat(1001) } }),
    ).rejects.toThrow();
  });
});
