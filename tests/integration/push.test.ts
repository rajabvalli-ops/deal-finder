import { describe, expect, it, vi } from "vitest";
import { alertFormSchema } from "@/lib/validation/alerts";
import { MAX_PUSH_FAILURES } from "@/server/db/repositories/push-subscription.repository";
import type { PushMessage, PushResult, PushSender, PushTarget } from "@/server/push/web-push";
import { createAlertMatchingService } from "@/server/services/alerts/alert-matching.service";
import { createAlertsService } from "@/server/services/alerts/alerts.service";
import {
  createPushDelivery,
  pushDeliveryFromEnv,
} from "@/server/services/alerts/push-delivery.service";
import { createLiveDeal, createUser } from "./factories";
import { testDb } from "./setup";

const NOW = new Date(Date.UTC(2026, 9, 1, 12));
const DAY = 86_400_000;
const alerts = createAlertsService(testDb);

const subscription = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: `p256dh${n}`, auth: `auth${n}` },
});

/** A sender that records pushes and answers from a script (default: delivered). */
function fakeSender(results: Record<string, PushResult> = {}) {
  const sent: { target: PushTarget; message: PushMessage }[] = [];
  const sender: PushSender = {
    send: vi.fn(async (target: PushTarget, message: PushMessage) => {
      sent.push({ target, message });
      return results[target.endpoint] ?? "delivered";
    }),
  };
  return { sender, sent };
}

describe("push subscriptions", () => {
  it("saves a browser per account, moves a re-used browser, and removes only your own", async () => {
    const alice = await createUser("alice@example.test");
    const bob = await createUser("bob@example.test");
    await alerts.savePushSubscription(alice.id, subscription(1), "Firefox");
    await alerts.savePushSubscription(alice.id, subscription(2), null);
    expect(await alerts.pushDeviceCount(alice.id)).toBe(2);

    // The same browser signs in to another account: it now notifies that account.
    await alerts.savePushSubscription(bob.id, subscription(2), "Chrome");
    expect(await alerts.pushDeviceCount(alice.id)).toBe(1);
    expect(await alerts.pushDeviceCount(bob.id)).toBe(1);

    expect(await alerts.removePushSubscription(bob.id, subscription(1).endpoint)).toBe(false);
    expect(await alerts.removePushSubscription(alice.id, subscription(1).endpoint)).toBe(true);
    expect(await alerts.pushDeviceCount(alice.id)).toBe(0);
  });
});

describe("push delivery", () => {
  it("pushes each new alert notification to all of the user's devices, linking to the deal", async () => {
    const user = await createUser("pushed@example.test");
    const other = await createUser("quiet@example.test");
    await alerts.savePushSubscription(user.id, subscription(1), null);
    await alerts.savePushSubscription(user.id, subscription(2), null);
    for (const u of [user, other]) {
      await alerts.create(u.id, alertFormSchema.parse({ keyword: "kettle" }));
    }
    await testDb.alert.updateMany({ data: { createdAt: new Date(NOW.getTime() - DAY) } });
    const live = await createLiveDeal(NOW, "Glass Kettle");

    const { sender, sent } = fakeSender();
    const matching = createAlertMatchingService(testDb, {
      push: createPushDelivery(testDb, sender),
    });
    expect(await matching.matchDeals({ now: NOW, since: new Date(0) })).toMatchObject({
      notified: 2,
      pushed: 2,
    });
    expect(sent.map((s) => s.target.endpoint).sort()).toEqual([
      subscription(1).endpoint,
      subscription(2).endpoint,
    ]);
    expect(sent[0]!.message).toEqual({
      title: "Price alert: Glass Kettle",
      body: expect.stringMatching(/^Glass Kettle is £80\.00/),
      url: `/deals/${live.deal.slug}`,
      tag: `deal-${live.deal.slug}`,
      urgent: false,
    });
    expect(await testDb.pushSubscription.findMany({ select: { lastSuccessAt: true } })).toEqual([
      { lastSuccessAt: NOW },
      { lastSuccessAt: NOW },
    ]);

    // Already notified: nothing is pushed again.
    expect(await matching.matchDeals({ now: NOW, since: new Date(0) })).toMatchObject({
      pushed: 0,
    });
  });

  it("drops subscriptions that are gone or keep failing", async () => {
    const user = await createUser("flaky@example.test");
    await alerts.savePushSubscription(user.id, subscription(1), null);
    await alerts.savePushSubscription(user.id, subscription(2), null);
    const { sender } = fakeSender({
      [subscription(1).endpoint]: "gone",
      [subscription(2).endpoint]: "failed",
    });
    const delivery = createPushDelivery(testDb, sender);
    const notice = {
      userId: user.id,
      subject: "s",
      body: "b",
      dealSlug: "d",
      level: "PRICE_ERROR" as const,
    };

    expect(await delivery.deliver([notice], NOW)).toEqual({ pushed: 0, failed: 2 });
    expect(
      await testDb.pushSubscription.findMany({ select: { endpoint: true, failureCount: true } }),
    ).toEqual([{ endpoint: subscription(2).endpoint, failureCount: 1 }]);
    for (let i = 1; i < MAX_PUSH_FAILURES; i++) await delivery.deliver([notice], NOW);
    expect(await testDb.pushSubscription.count()).toBe(0);
    expect(await delivery.deliver([], NOW)).toEqual({ pushed: 0, failed: 0 });
  });

  it("keeps the in-app notification when pushing throws", async () => {
    const user = await createUser("broken@example.test");
    await alerts.create(user.id, alertFormSchema.parse({ keyword: "kettle" }));
    await testDb.alert.updateMany({ data: { createdAt: new Date(NOW.getTime() - DAY) } });
    await createLiveDeal(NOW, "Glass Kettle");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const matching = createAlertMatchingService(testDb, {
      push: { deliver: async () => Promise.reject(new Error("push service down")) },
    });
    expect(await matching.matchDeals({ now: NOW, since: new Date(0) })).toMatchObject({
      notified: 1,
      pushed: 0,
    });
    expect(error).toHaveBeenCalledWith("Push delivery failed", expect.any(Error));
    error.mockRestore();
  });

  it("is only set up when VAPID keys are configured", () => {
    expect(pushDeliveryFromEnv(testDb, {})).toBeUndefined();
    expect(
      pushDeliveryFromEnv(testDb, {
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:x@example.test",
      }),
    ).toBeDefined();
  });
});
