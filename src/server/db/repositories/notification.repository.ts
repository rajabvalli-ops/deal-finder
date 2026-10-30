import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "../types";

export type NotificationCreate = Pick<
  Prisma.NotificationCreateManyInput,
  | "userId"
  | "alertId"
  | "dealId"
  | "channel"
  | "status"
  | "subject"
  | "body"
  | "dedupeKey"
  | "sentAt"
>;

const notificationListInclude = {
  deal: {
    select: {
      slug: true,
      status: true,
      product: { select: { isActive: true } },
      retailer: { select: { status: true } },
    },
  },
} satisfies Prisma.NotificationInclude;

export type NotificationRow = Prisma.NotificationGetPayload<{
  include: typeof notificationListInclude;
}>;

export function createNotificationRepository(client: DbClient) {
  return {
    /** Inserts notifications, skipping any whose dedupe key already exists. Returns those created. */
    createMany(data: NotificationCreate[]) {
      return client.notification.createManyAndReturn({
        data,
        skipDuplicates: true,
        select: { id: true, alertId: true, dealId: true, userId: true, subject: true, body: true },
      });
    },

    listInAppForUser(userId: string, take: number): Promise<NotificationRow[]> {
      return client.notification.findMany({
        where: { userId, channel: "IN_APP" },
        include: notificationListInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      });
    },

    countUnread(userId: string) {
      return client.notification.count({
        where: { userId, channel: "IN_APP", readAt: null },
      });
    },

    /** Marks one of the user's notifications (or all of them, without an id) as read. */
    async markRead(userId: string, at: Date, notificationId?: string): Promise<number> {
      const { count } = await client.notification.updateMany({
        where: {
          userId,
          channel: "IN_APP",
          readAt: null,
          ...(notificationId ? { id: notificationId } : {}),
        },
        data: { readAt: at },
      });
      return count;
    },
  };
}

export type NotificationRepository = ReturnType<typeof createNotificationRepository>;
