"use server";

import { commentModerationSchema } from "@/lib/validation/comments";
import { requireRole } from "@/server/auth";
import { comments } from "@/server/services/comments";
import { backTo, formObject } from "../_lib/redirect";

export async function moderateComment(formData: FormData): Promise<void> {
  const actor = await requireRole("EDITOR", "/admin/comments");
  const parsed = commentModerationSchema.safeParse(formObject(formData));
  if (!parsed.success) backTo(null, "/admin/comments", { error: "INVALID_INPUT" });
  const result = await comments.moderate({ actor, ...parsed.data, now: new Date() });
  // Comments load in the browser, so no cached page needs refreshing.
  backTo(null, "/admin/comments", result.ok ? { notice: "saved" } : { error: result.error });
}
