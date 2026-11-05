import { describe, expect, it, vi } from "vitest";
import type { PushMessage, PushSender, PushTarget } from "@/server/push/web-push";
import { createAlertsService } from "@/server/services/alerts/alerts.service";
import {
  BROADCAST_NETWORK,
  broadcastFromEnv,
  createBroadcastService,
} from "@/server/services/alerts/broadcast.service";
import { createPushDelivery } from "@/server/services/alerts/push-delivery.service";
import { createPendingDeal, createUser } from "./factories";
import { testDb } from "./setup";

// 12:00 UK time (GMT in November).
const NOW = new Date(Date.UTC(2026, 10, 5, 12));
const DAY = 86_400_000;
const since = new Date(NOW.getTime() - DAY);
const alerts = createAlertsService(testDb);

const subscription = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: `p256dh${n}`, auth: `auth${n}` },
});

function fakeSender() {
  const sent: { target: PushTarget; message: PushMessage }[] = [];
  const sender: PushSender = {
    send: vi.fn(async (target: PushTarget, message: PushMessage) => {
      sent.push({ target, message });
      return "delivered" as const;
    }),
  };
  return { sender, sent };
}

const liveDeal = (title: string, dropTo: number) =>
  createPendingDeal(NOW, { title, externalId: title, dropTo, autoPublish: true });

describe("devices without an account", () => {
  it("needs something to follow, and keeps its account when re-subscribed signed out", async () => {
    expect(await alerts.savePushSubscription(null, subscription(1), null, null)).toEqual({
      ok: false,
      error: "NOTHING_TO_FOLLOW",
    });
    expect(
      await alerts.savePushSubscription(null, subscription(1), "Safari", "PRICE_ERROR"),
    ).toEqual({ ok: true });
    expect(await alerts.deviceSettings(subscription(1).endpoint)).toEqual({
      broadcastLevel: "PRICE_ERROR",
      quietStartHour: null,
      quietEndHour: null,
      hasAccount: false,
    });

    const user = await createUser("owner@example.test");
    await alerts.savePushSubscription(user.id, subscription(2), null);
    await alerts.savePushSubscription(null, subscription(2), null, "BIG_DROP");
    expect(await alerts.deviceSettings(subscription(2).endpoint)).toMatchObject({
      broadcastLevel: "BIG_DROP",
      hasAccount: true,
    });
    expect(await alerts.deviceSettings("https://fcm.googleapis.com/fcm/send/unknown")).toBeNull();
  });

  it("changes settings by endpoint, and won't leave an account-free device following nothing", async () => {
    await alerts.savePushSubscription(null, subscription(1), null, "PRICE_ERROR");
    const endpoint = subscription(1).endpoint;
    expect(
      await alerts.updateDeviceSettings({
        endpoint,
        broadcastLevel: "BIG_DROP",
        quietStartHour: 23,
        quietEndHour: 7,
      }),
    ).toEqual({ ok: true });
    expect(await alerts.deviceSettings(endpoint)).toMatchObject({
      broadcastLevel: "BIG_DROP",
      quietStartHour: 23,
      quietEndHour: 7,
    });
    expect(
      await alerts.updateDeviceSettings({
        endpoint,
        broadcastLevel: null,
        quietStartHour: null,
        quietEndHour: null,
      }),
    ).toEqual({ ok: false, error: "NOTHING_TO_FOLLOW" });
    expect(
      await alerts.updateDeviceSettings({
        endpoint: "https://fcm.googleapis.com/fcm/send/unknown",
        broadcastLevel: "BIG_DROP",
        quietStartHour: null,
        quietEndHour: null,
      }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("removes an account-free device for anyone with its endpoint, an owned one only for its owner", async () => {
    const owner = await createUser("mine@example.test");
    const other = await createUser("theirs@example.test");
    await alerts.savePushSubscription(null, subscription(1), null, "PRICE_ERROR");
    await alerts.savePushSubscription(owner.id, subscription(2), null);

    expect(await alerts.removeDevice(null, subscription(2).endpoint)).toBe(false);
    expect(await alerts.removeDevice(other.id, subscription(2).endpoint)).toBe(false);
    expect(await alerts.removeDevice(owner.id, subscription(2).endpoint)).toBe(true);
    expect(await alerts.removeDevice(null, subscription(1).endpoint)).toBe(true);
    expect(await alerts.removeDevice(null, subscription(1).endpoint)).toBe(false);
  });

  it("enforces a purpose and a valid quiet-hours window in the database", async () => {
    const base = { endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" };
    await expect(testDb.pushSubscription.create({ data: base })).rejects.toThrow();
    await expect(
      testDb.pushSubscription.create({
        data: { ...base, broadcastLevel: "BIG_DROP", quietStartHour: 23 },
      }),
    ).rejects.toThrow();
    await expect(
      testDb.pushSubscription.create({
        data: { ...base, broadcastLevel: "BIG_DROP", quietStartHour: 24, quietEndHour: 7 },
      }),
    ).rejects.toThrow();
  });
});

describe("price error broadcasts", () => {
  it("pushes each big drop or price error once to the devices following its level", async () => {
    await alerts.savePushSubscription(null, subscription(1), null, "PRICE_ERROR");
    await alerts.savePushSubscription(null, subscription(2), null, "BIG_DROP");
    const sleeper = await createUser("sleeper@example.test");
    await alerts.savePushSubscription(sleeper.id, subscription(3), null, "BIG_DROP");
    await alerts.updateDeviceSettings({
      endpoint: subscription(3).endpoint,
      broadcastLevel: "BIG_DROP",
      quietStartHour: 9, // 09:00–17:00 UK: quiet at noon
      quietEndHour: 17,
    });
    const owner = await createUser("own-alerts@example.test");
    await alerts.savePushSubscription(owner.id, subscription(4), null);

    await liveDeal("Normal Kettle", 8000);
    const big = await liveDeal("Big Kettle", 6000);
    const glitch = await liveDeal("Glitch Kettle", 900);

    const { sender, sent } = fakeSender();
    const broadcast = createBroadcastService(testDb, sender);
    expect(await broadcast.run({ now: NOW, since })).toMatchObject({ queued: 2, posted: 2 });

    const byDeal = (slug: string) =>
      sent
        .filter((s) => s.message.url === `/deals/${slug}`)
        .map((s) => s.target.endpoint)
        .sort();
    expect(byDeal(glitch.deal.slug)).toEqual([subscription(1).endpoint, subscription(2).endpoint]);
    expect(byDeal(big.deal.slug)).toEqual([subscription(2).endpoint]);
    expect(sent[0]!.message).toMatchObject({
      title: expect.stringContaining("rice error"),
      tag: `deal-${glitch.deal.slug}`,
      urgent: true,
    });
    expect(await testDb.socialPost.count({ where: { network: BROADCAST_NETWORK } })).toBe(2);

    // Already sent: nothing goes out again.
    expect(await broadcast.run({ now: NOW, since })).toMatchObject({ queued: 0, posted: 0 });
    expect(sent).toHaveLength(3);
  });

  it("is off without push keys", () => {
    expect(broadcastFromEnv(testDb, {})).toBeUndefined();
  });
});

describe("quiet hours for a user's own alerts", () => {
  it("holds back pushes during the device's quiet hours", async () => {
    const user = await createUser("night@example.test");
    await alerts.savePushSubscription(user.id, subscription(1), null);
    await alerts.savePushSubscription(user.id, subscription(2), null);
    await alerts.updateDeviceSettings({
      endpoint: subscription(2).endpoint,
      broadcastLevel: null,
      quietStartHour: 11,
      quietEndHour: 13,
    });
    const { sender, sent } = fakeSender();
    const notice = {
      userId: user.id,
      title: "t",
      body: "b",
      dealSlug: "d",
      imageUrl: null,
      level: "BIG_DROP" as const,
    };
    expect(await createPushDelivery(testDb, sender).deliver([notice], NOW)).toEqual({
      pushed: 1,
      failed: 0,
    });
    expect(sent.map((s) => s.target.endpoint)).toEqual([subscription(1).endpoint]);
  });
});
