import "server-only";
import { db } from "@/server/db/client";
import { createMemoryRateLimiter } from "@/server/rate-limit/rate-limiter";
import { createCommentsService } from "./comments.service";

export type { CommentView, PostCommentResult } from "./comments.service";

/** Per-instance: 5 comments per person per 10 minutes. */
export const comments = createCommentsService(db, {
  rateLimiter: createMemoryRateLimiter({ limit: 5, windowMs: 10 * 60_000 }),
});
