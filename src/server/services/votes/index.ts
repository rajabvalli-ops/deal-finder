import "server-only";
import { db } from "@/server/db/client";
import { createMemoryRateLimiter } from "@/server/rate-limit/rate-limiter";
import { createVotesService } from "./votes.service";

export type { VoteResult, VoteState, VoteValue } from "./votes.service";

/** Per-instance: 60 votes per person per 10 minutes is far more than browsing needs. */
export const votes = createVotesService(db, {
  rateLimiter: createMemoryRateLimiter({ limit: 60, windowMs: 10 * 60_000 }),
});
