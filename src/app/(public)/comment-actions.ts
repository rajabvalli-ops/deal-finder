"use server";

import {
  commentDeleteSchema,
  commentFormSchema,
  commentListSchema,
} from "@/lib/validation/comments";
import { getCurrentUser } from "@/server/auth";
import { comments, type CommentView } from "@/server/services/comments";

// Comments on the deal page. They load in the browser, so the cached deal page stays the same
// for everyone and new comments show at once.

export type CommentList = { items: CommentView[]; total: number; signedIn: boolean };

export async function listComments(input: unknown): Promise<CommentList | null> {
  const parsed = commentListSchema.safeParse(input);
  if (!parsed.success) return null;
  const user = await getCurrentUser();
  const list = await comments.forDeal(parsed.data.slug, user?.id ?? null);
  return list ? { ...list, signedIn: user !== null } : null;
}

export async function postComment(
  input: unknown,
): Promise<
  { ok: true } | { ok: false; error: "SIGNED_OUT" | "INVALID" | "NOT_FOUND" | "RATE_LIMITED" }
> {
  const parsed = commentFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "SIGNED_OUT" };
  return comments.post({ userId: user.id, ...parsed.data, now: new Date() });
}

export async function deleteComment(input: unknown): Promise<{ ok: boolean }> {
  const parsed = commentDeleteSchema.safeParse(input);
  const user = await getCurrentUser();
  if (!parsed.success || !user) return { ok: false };
  return { ok: await comments.delete(user.id, parsed.data.commentId) };
}
