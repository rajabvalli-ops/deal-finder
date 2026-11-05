import "server-only";
import { alertCondition, alertWatching } from "@/lib/alerts";
import { MAX_ALERTS_PER_USER, type AlertInput } from "@/lib/validation/alerts";
import { createAlertRepository } from "@/server/db/repositories/alert.repository";
import {
  createNotificationRepository,
  type NotificationRow,
} from "@/server/db/repositories/notification.repository";
import { createPublicRepository } from "@/server/db/repositories/public.repository";
import { createPushSubscriptionRepository } from "@/server/db/repositories/push-subscription.repository";
import type { PushSubscriptionInput } from "@/lib/validation/push";
import type { DbClient } from "@/server/db/types";

export type AlertErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "LIMIT_REACHED"
  | "VAGUE_KEYWORD"
  | "UNKNOWN_CATEGORY"
  | "UNKNOWN_RETAILER"
  | "UNKNOWN_DEAL";

/** Messages shown on the alerts page; keyed by code so no user input is ever reflected. */
export const ALERT_ERROR_MESSAGES: Record<AlertErrorCode, string> = {
  INVALID_INPUT:
    "Please check the form: choose a keyword, a category, a product or a kind of drop to watch.",
  NOT_FOUND: "That alert or notification no longer exists.",
  LIMIT_REACHED: `You can keep up to ${MAX_ALERTS_PER_USER} alerts. Delete one to add another.`,
  VAGUE_KEYWORD: "That keyword is too general to match anything. Try a product name or brand.",
  UNKNOWN_CATEGORY: "That category isn't available.",
  UNKNOWN_RETAILER: "That retailer isn't available.",
  UNKNOWN_DEAL: "That deal is no longer live, so we can't set up an alert from it.",
};

export type AlertResult = { ok: true } | { ok: false; error: AlertErrorCode };

const okResult: AlertResult = { ok: true };
const fail = (error: AlertErrorCode): AlertResult => ({ ok: false, error });

/** An alert as the owner sees it. */
export type AlertView = {
  id: string;
  watching: string;
  condition: string;
  isActive: boolean;
  lastTriggeredAt: Date | null;
  createdAt: Date;
};

export type NotificationView = {
  id: string;
  subject: string;
  body: string;
  createdAt: Date;
  read: boolean;
  /** Only while the deal is still public. */
  dealSlug: string | null;
};

/** Notifications shown on the alerts page. */
const NOTIFICATION_LIST_SIZE = 50;

function toNotificationView(n: NotificationRow): NotificationView {
  const live =
    n.deal?.status === "PUBLISHED" &&
    n.deal.product.isActive &&
    n.deal.retailer.status === "ACTIVE";
  return {
    id: n.id,
    subject: n.subject,
    body: n.body,
    createdAt: n.createdAt,
    read: n.readAt !== null,
    dealSlug: live ? n.deal!.slug : null,
  };
}

/** A signed-in user's own alerts and notifications. Every call is scoped to `userId`. */
export function createAlertsService(client: DbClient) {
  const alerts = createAlertRepository(client);
  const notifications = createNotificationRepository(client);
  const publicRepo = createPublicRepository(client);
  const pushSubscriptions = createPushSubscriptionRepository(client);

  return {
    async create(userId: string, input: AlertInput): Promise<AlertResult> {
      if ((await alerts.countForUser(userId)) >= MAX_ALERTS_PER_USER) return fail("LIMIT_REACHED");
      if (input.keyword && !(await alerts.isSearchableKeyword(input.keyword))) {
        return fail("VAGUE_KEYWORD");
      }
      const [category, retailer, deal] = await Promise.all([
        input.categorySlug ? publicRepo.findCategoryBySlug(input.categorySlug) : null,
        input.retailerSlug ? publicRepo.findRetailerBySlug(input.retailerSlug) : null,
        input.dealSlug ? alerts.findPublicDealProduct(input.dealSlug) : null,
      ]);
      if (input.categorySlug && !category) return fail("UNKNOWN_CATEGORY");
      if (input.retailerSlug && retailer?.status !== "ACTIVE") return fail("UNKNOWN_RETAILER");
      if (input.dealSlug && !deal) return fail("UNKNOWN_DEAL");

      await alerts.create({
        userId,
        keyword: input.keyword,
        productId: deal?.productId ?? null,
        categoryId: category?.id ?? null,
        retailerId: retailer?.id ?? null,
        maxPrice: input.maxPrice,
        minDiscountBps: input.minDiscountBps,
        minLevel: input.minLevel,
      });
      return okResult;
    },

    async setActive(userId: string, alertId: string, isActive: boolean): Promise<AlertResult> {
      return (await alerts.setActive(userId, alertId, isActive)) ? okResult : fail("NOT_FOUND");
    },

    async delete(userId: string, alertId: string): Promise<AlertResult> {
      return (await alerts.deleteOwned(userId, alertId)) ? okResult : fail("NOT_FOUND");
    },

    async list(userId: string): Promise<AlertView[]> {
      return (await alerts.listForUser(userId)).map((a) => {
        const description = {
          keyword: a.keyword,
          productTitle: a.product?.title ?? null,
          categoryName: a.category?.name ?? null,
          retailerName: a.retailer?.name ?? null,
          maxPrice: a.maxPrice,
          minDiscountBps: a.minDiscountBps,
          minLevel: a.minLevel,
        };
        return {
          id: a.id,
          watching: alertWatching(description),
          condition: alertCondition(description),
          isActive: a.isActive,
          lastTriggeredAt: a.lastTriggeredAt,
          createdAt: a.createdAt,
        };
      });
    },

    /** The deal behind "alert me about this product", if it is still public. */
    async dealForAlert(slug: string): Promise<{ productTitle: string; dealPrice: number } | null> {
      const deal = await alerts.findPublicDealProduct(slug);
      return deal ? { productTitle: deal.product.title, dealPrice: deal.dealPrice } : null;
    },

    async notifications(userId: string): Promise<{ items: NotificationView[]; unread: number }> {
      const [rows, unread] = await Promise.all([
        notifications.listInAppForUser(userId, NOTIFICATION_LIST_SIZE),
        notifications.countUnread(userId),
      ]);
      return { items: rows.map(toNotificationView), unread };
    },

    /** Turns on push for this browser (its subscription moves to this account if it had another). */
    async savePushSubscription(
      userId: string,
      subscription: PushSubscriptionInput,
      userAgent: string | null,
    ): Promise<void> {
      await pushSubscriptions.save({
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent?.slice(0, 300) ?? null,
      });
    },

    removePushSubscription(userId: string, endpoint: string): Promise<boolean> {
      return pushSubscriptions.deleteOwned(userId, endpoint);
    },

    /** Browsers (devices) this user gets push notifications on. */
    pushDeviceCount(userId: string): Promise<number> {
      return pushSubscriptions.countForUser(userId);
    },

    /**
     * Marks one notification (or, without an id, all of them) as read. Scoped to the user, so
     * another user's id changes nothing; re-reading a read one is harmless. Returns the count.
     */
    markRead(userId: string, now: Date, notificationId?: string): Promise<number> {
      return notifications.markRead(userId, now, notificationId);
    },
  };
}

export type AlertsService = ReturnType<typeof createAlertsService>;
