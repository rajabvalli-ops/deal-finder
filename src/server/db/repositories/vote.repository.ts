import { inTransaction } from "../transaction";
import type { DbClient } from "../types";
import { PUBLIC_DEAL_WHERE } from "./public.repository";

export type VoteValue = -1 | 0 | 1;

export function createVoteRepository(client: DbClient) {
  return {
    findPublicDeal(slug: string) {
      return client.deal.findFirst({
        where: { ...PUBLIC_DEAL_WHERE, slug },
        select: { id: true, voteScore: true },
      });
    },

    async myVote(userId: string, dealId: string): Promise<VoteValue> {
      const vote = await client.dealVote.findUnique({
        where: { dealId_userId: { dealId, userId } },
        select: { value: true },
      });
      return (vote?.value ?? 0) as VoteValue;
    },

    /**
     * Sets (or with 0 clears) a user's vote and returns the deal's new score. The deal row is
     * locked first, so concurrent votes on one deal are counted one after another and the
     * stored score always equals the sum of its votes.
     */
    setVote(userId: string, dealId: string, value: VoteValue): Promise<number> {
      return inTransaction(client, async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Deal" WHERE id = ${dealId} FOR UPDATE`;
        const key = { dealId_userId: { dealId, userId } };
        if (value === 0) {
          await tx.dealVote.deleteMany({ where: { dealId, userId } });
        } else {
          await tx.dealVote.upsert({
            where: key,
            create: { dealId, userId, value },
            update: { value },
          });
        }
        const { _sum } = await tx.dealVote.aggregate({ where: { dealId }, _sum: { value: true } });
        const voteScore = _sum.value ?? 0;
        await tx.deal.update({ where: { id: dealId }, data: { voteScore } });
        return voteScore;
      });
    },
  };
}
