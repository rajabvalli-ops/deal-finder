import type { DealLevel } from "@/generated/prisma/enums";
import type { DbClient } from "../types";

/** Failed deliveries in a row after which a subscription is dropped. */
export const MAX_PUSH_FAILURES = 5;

export function createPushSubscriptionRepository(client: DbClient) {
  return {
    /**
     * Saves a browser's subscription. With a user it becomes theirs (a browser re-used by
     * another account moves to it); without one it is an account-free device. Settings it
     * already had are kept unless given.
     */
    save(data: {
      userId: string | null;
      endpoint: string;
      p256dh: string;
      auth: string;
      userAgent: string | null;
      broadcastLevel?: DealLevel | null;
    }) {
      const { broadcastLevel, ...rest } = data;
      return client.pushSubscription.upsert({
        where: { endpoint: data.endpoint },
        create: { ...rest, broadcastLevel: broadcastLevel ?? null },
        update: {
          ...rest,
          // An account-free sign-up never detaches a device from its account.
          ...(data.userId === null ? { userId: undefined } : {}),
          ...(broadcastLevel !== undefined ? { broadcastLevel } : {}),
          failureCount: 0,
        },
      });
    },

    findByEndpoint(endpoint: string) {
      return client.pushSubscription.findUnique({ where: { endpoint } });
    },

    updateSettings(
      endpoint: string,
      settings: {
        broadcastLevel: DealLevel | null;
        quietStartHour: number | null;
        quietEndHour: number | null;
      },
    ) {
      return client.pushSubscription.update({ where: { endpoint }, data: settings });
    },

    /** Removes a device by its endpoint (account-free devices have no other owner). */
    async deleteByEndpoint(endpoint: string): Promise<boolean> {
      const { count } = await client.pushSubscription.deleteMany({ where: { endpoint } });
      return count > 0;
    },

    /** Devices following deals at one of `levels`. */
    listFollowing(levels: DealLevel[]) {
      return client.pushSubscription.findMany({
        where: { broadcastLevel: { in: levels } },
        orderBy: { createdAt: "asc" },
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

    /** Subscriptions of users with one of `roles` (e.g. editors, for "tap to tweet"). */
    listForRoles(roles: ("USER" | "EDITOR" | "ADMIN")[]) {
      return client.pushSubscription.findMany({
        where: { user: { role: { in: roles } } },
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
