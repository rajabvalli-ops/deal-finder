import type { DbClient } from "../types";

/** Failed deliveries in a row after which a subscription is dropped. */
export const MAX_PUSH_FAILURES = 5;

export function createPushSubscriptionRepository(client: DbClient) {
  return {
    /** Saves a browser's subscription for `userId`; a browser re-used by another account moves to it. */
    save(data: {
      userId: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      userAgent: string | null;
    }) {
      return client.pushSubscription.upsert({
        where: { endpoint: data.endpoint },
        create: data,
        update: { ...data, failureCount: 0 },
      });
    },

    /** Removes the user's own subscription only. */
    async deleteOwned(userId: string, endpoint: string): Promise<boolean> {
      const { count } = await client.pushSubscription.deleteMany({ where: { userId, endpoint } });
      return count > 0;
    },

    countForUser(userId: string) {
      return client.pushSubscription.count({ where: { userId } });
    },

    listForUsers(userIds: string[]) {
      return client.pushSubscription.findMany({
        where: { userId: { in: userIds } },
        orderBy: { createdAt: "asc" },
      });
    },

    markDelivered(id: string, at: Date) {
      return client.pushSubscription.update({
        where: { id },
        data: { lastSuccessAt: at, failureCount: 0 },
      });
    },

    /** Counts a failure; drops the subscription when it is gone or keeps failing. */
    async markFailed(id: string, gone: boolean): Promise<void> {
      if (gone) {
        await client.pushSubscription.deleteMany({ where: { id } });
        return;
      }
      const updated = await client.pushSubscription.update({
        where: { id },
        data: { failureCount: { increment: 1 } },
      });
      if (updated.failureCount >= MAX_PUSH_FAILURES) {
        await client.pushSubscription.deleteMany({ where: { id } });
      }
    },
  };
}

export type PushSubscriptionRepository = ReturnType<typeof createPushSubscriptionRepository>;
