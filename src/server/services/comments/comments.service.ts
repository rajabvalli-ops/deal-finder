import "server-only";
import { commenterName } from "@/lib/comments";
import { hasRole } from "@/server/auth/roles";
import { createAuditLogRepository } from "@/server/db/repositories/audit-log.repository";
import { createCommentRepository } from "@/server/db/repositories/comment.repository";
import { PUBLIC_DEAL_WHERE } from "@/server/db/repositories/public.repository";
import { inTransaction } from "@/server/db/transaction";
import type { DbClient } from "@/server/db/types";
import type { RateLimiter } from "@/server/rate-limit/rate-limiter";
import { fail, ok, type Actor, type AdminResult } from "@/server/services/admin/result";

/** Comments shown on a deal page. */
const COMMENT_LIST_SIZE = 100;

export type CommentView = {
  id: string;
  author: string;
  body: string;
  createdAt: Date;
  /** Written by the viewer, who may delete it. */
  mine: boolean;
};

export type PostCommentResult = { ok: true } | { ok: false; error: "NOT_FOUND" | "RATE_LIMITED" };

/** Comments on public deals by signed-in users; editors can hide them. */
export function createCommentsService(client: DbClient, deps: { rateLimiter: RateLimiter }) {
  const comments = createCommentRepository(client);

  const findPublicDeal = (slug: string) =>
    client.deal.findFirst({ where: { ...PUBLIC_DEAL_WHERE, slug }, select: { id: true } });

  return {
    async post(params: {
      userId: string;
      slug: string;
      body: string;
      now: Date;
    }): Promise<PostCommentResult> {
      const limit = await deps.rateLimiter.consume(`comment:${params.userId}`, params.now);
      if (!limit.allowed) return { ok: false, error: "RATE_LIMITED" };
      const deal = await findPublicDeal(params.slug);
      if (!deal) return { ok: false, error: "NOT_FOUND" };
      await comments.create({
        dealId: deal.id,
        userId: params.userId,
        body: params.body,
        createdAt: params.now,
      });
      return { ok: true };
    },

    /** A public deal's visible comments, newest first; null when the deal isn't public. */
    async forDeal(
      slug: string,
      viewerId: string | null,
    ): Promise<{ items: CommentView[]; total: number } | null> {
      const deal = await findPublicDeal(slug);
      if (!deal) return null;
      const [rows, total] = await Promise.all([
        comments.listVisibleForDeal(deal.id, COMMENT_LIST_SIZE),
        comments.countVisibleForDeal(deal.id),
      ]);
      return {
        items: rows.map((c) => ({
          id: c.id,
          author: commenterName(c.user.name),
          body: c.body,
          createdAt: c.createdAt,
          mine: viewerId !== null && c.userId === viewerId,
        })),
        total,
      };
    },

    /** Deletes the user's own comment. */
    delete(userId: string, commentId: string): Promise<boolean> {
      return comments.deleteOwned(userId, commentId);
    },

    listForAdmin() {
      return comments.listForAdmin(200);
    },

    /** Hides or shows a comment. EDITOR+; audited. */
    moderate(params: {
      actor: Actor;
      commentId: string;
      action: "hide" | "show";
      now: Date;
    }): Promise<AdminResult> {
      const { actor, commentId, action, now } = params;
      if (!hasRole(actor.role, "EDITOR")) return Promise.resolve(fail("FORBIDDEN"));
      return inTransaction(client, async (tx) => {
        const repo = createCommentRepository(tx);
        const comment = await repo.findById(commentId);
        if (!comment) return fail("NOT_FOUND");
        await repo.setStatus(comment.id, action === "hide" ? "HIDDEN" : "VISIBLE", actor.id, now);
        await createAuditLogRepository(tx).record({
          actorId: actor.id,
          action: `comment.${action}`,
          entityType: "Comment",
          entityId: comment.id,
          diff: { dealId: comment.dealId },
          createdAt: now,
        });
        return ok(undefined);
      });
    },
  };
}

export type CommentsService = ReturnType<typeof createCommentsService>;
