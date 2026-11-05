import "server-only";
import { createVoteRepository, type VoteValue } from "@/server/db/repositories/vote.repository";
import type { DbClient } from "@/server/db/types";
import type { RateLimiter } from "@/server/rate-limit/rate-limiter";
import type { PointsAwards } from "@/server/services/points/points.service";

export type { VoteValue };

export type VoteState = { score: number; myVote: VoteValue };
export type VoteResult =
  ({ ok: true } & VoteState) | { ok: false; error: "NOT_FOUND" | "RATE_LIMITED" };

/** "Hot" / "cold" votes on public deals, one per signed-in user per deal. */
export function createVotesService(
  client: DbClient,
  deps: { rateLimiter: RateLimiter; points?: Pick<PointsAwards, "forVote"> },
) {
  const votes = createVoteRepository(client);

  return {
    async vote(params: {
      userId: string;
      slug: string;
      value: VoteValue;
      now: Date;
    }): Promise<VoteResult> {
      const limit = await deps.rateLimiter.consume(`vote:${params.userId}`, params.now);
      if (!limit.allowed) return { ok: false, error: "RATE_LIMITED" };
      const deal = await votes.findPublicDeal(params.slug);
      if (!deal) return { ok: false, error: "NOT_FOUND" };
      const score = await votes.setVote(params.userId, deal.id, params.value);
      if (params.value !== 0) await deps.points?.forVote(params.userId, deal.id, params.now);
      return { ok: true, score, myVote: params.value };
    },

    /** The live score and, signed in, the user's own vote; null when the deal isn't public. */
    async state(slug: string, userId: string | null): Promise<VoteState | null> {
      const deal = await votes.findPublicDeal(slug);
      if (!deal) return null;
      return {
        score: deal.voteScore,
        myVote: userId ? await votes.myVote(userId, deal.id) : 0,
      };
    },
  };
}

export type VotesService = ReturnType<typeof createVotesService>;
