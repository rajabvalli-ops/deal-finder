import type { DbClient } from "../types";

export function createCommentRepository(client: DbClient) {
  return {
    create(data: { dealId: string; userId: string; body: string; createdAt: Date }) {
      return client.comment.create({ data });
    },

    /** Visible comments on a deal, newest first, with the author's name only. */
    listVisibleForDeal(dealId: string, take: number) {
      return client.comment.findMany({
        where: { dealId, status: "VISIBLE" },
        select: {
          id: true,
          userId: true,
          body: true,
          createdAt: true,
          user: { select: { name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      });
    },

    countVisibleForDeal(dealId: string) {
      return client.comment.count({ where: { dealId, status: "VISIBLE" } });
    },

    async deleteOwned(userId: string, id: string): Promise<boolean> {
      return (await client.comment.deleteMany({ where: { id, userId } })).count > 0;
    },

    findById(id: string) {
      return client.comment.findUnique({ where: { id } });
    },

    setStatus(id: string, status: "VISIBLE" | "HIDDEN", moderatorId: string, at: Date) {
      return client.comment.update({
        where: { id },
        data:
          status === "HIDDEN"
            ? { status, hiddenAt: at, hiddenById: moderatorId }
            : { status, hiddenAt: null, hiddenById: null },
      });
    },

    listForAdmin(take: number) {
      return client.comment.findMany({
        include: {
          deal: { select: { id: true, slug: true, title: true } },
          user: { select: { email: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      });
    },
  };
}
