import type { PointsReason } from "@/generated/prisma/enums";
import type { DbClient } from "../types";

export function createPointsRepository(client: DbClient) {
  return {
    /** Records an award once per (user, reason, refKey); returns whether it was new. */
    async award(data: {
      userId: string;
      reason: PointsReason;
      refKey: string;
      points: number;
      day: string;
      createdAt: Date;
    }): Promise<boolean> {
      const { count } = await client.pointsEntry.createMany({ data: [data], skipDuplicates: true });
      return count > 0;
    },

    countForDay(userId: string, reason: PointsReason, day: string) {
      return client.pointsEntry.count({ where: { userId, reason, day } });
    },

    async balance(userId: string): Promise<number> {
      const { _sum } = await client.pointsEntry.aggregate({
        where: { userId },
        _sum: { points: true },
      });
      return _sum.points ?? 0;
    },

    /** Recent check-in days, newest first (enough for any streak worth showing). */
    async checkInDays(userId: string): Promise<string[]> {
      const rows = await client.pointsEntry.findMany({
        where: { userId, reason: "CHECK_IN" },
        select: { day: true },
        orderBy: { day: "desc" },
        take: 400,
      });
      return rows.map((r) => r.day);
    },

    recent(userId: string, take: number) {
      return client.pointsEntry.findMany({
        where: { userId },
        select: { id: true, reason: true, points: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      });
    },
  };
}
