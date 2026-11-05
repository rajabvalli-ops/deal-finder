import { describe, expect, it } from "vitest";
import {
  deviceSettingsSchema,
  deviceSignupSchema,
  isPushServiceUrl,
  pushEndpointSchema,
  pushSubscriptionSchema,
} from "./push";

describe("isPushServiceUrl", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:123",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
    "https://web.push.apple.com/QGx2",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", (url) => {
    expect(isPushServiceUrl(url)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evil.example/fcm.googleapis.com",
    "https://localhost/push",
    "https://169.254.169.254/latest/meta-data",
    "not a url",
  ])("rejects %s", (url) => {
    expect(isPushServiceUrl(url)).toBe(false);
  });
});

describe("pushSubscriptionSchema", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    expirationTime: null,
    keys: {
      p256dh:
        "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    },
  };

  it("accepts a browser subscription", () => {
    expect(pushSubscriptionSchema.parse(valid)).toEqual({
      endpoint: valid.endpoint,
      keys: valid.keys,
    });
  });

  it.each([
    { endpoint: "https://evil.example/push" },
    { keys: { p256dh: "not base64!", auth: "x" } },
    { keys: { p256dh: "a".repeat(201), auth: "x" } },
    { keys: { p256dh: "abc" } },
  ])("rejects %j", (change) => {
    expect(pushSubscriptionSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });

  it("reads an endpoint to remove", () => {
    expect(pushEndpointSchema.parse({ endpoint: "https://x" }).endpoint).toBe("https://x");
  });
});

describe("device schemas", () => {
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: "p256", auth: "auth" },
  };

  it("signs a device up for price errors or big drops", () => {
    expect(deviceSignupSchema.parse({ subscription, level: "price-error" }).level).toBe(
      "PRICE_ERROR",
    );
    expect(deviceSignupSchema.parse({ subscription, level: "big-drop" }).level).toBe("BIG_DROP");
    expect(deviceSignupSchema.parse({ subscription, level: "" }).level).toBeNull();
    expect(deviceSignupSchema.safeParse({ subscription, level: "everything" }).success).toBe(false);
  });

  it("reads quiet hours, dropping half-set or empty windows", () => {
    const base = { endpoint: subscription.endpoint, level: "price-error" };
    expect(deviceSettingsSchema.parse({ ...base, quietStart: "23", quietEnd: "7" })).toEqual({
      endpoint: subscription.endpoint,
      broadcastLevel: "PRICE_ERROR",
      quietStartHour: 23,
      quietEndHour: 7,
    });
    expect(deviceSettingsSchema.parse({ ...base, quietStart: "23", quietEnd: "" })).toMatchObject({
      quietStartHour: null,
      quietEndHour: null,
    });
    expect(deviceSettingsSchema.parse({ ...base, quietStart: "8", quietEnd: "8" })).toMatchObject({
      quietStartHour: null,
      quietEndHour: null,
    });
    expect(deviceSettingsSchema.parse({ ...base, quietStart: "0", quietEnd: "6" })).toMatchObject({
      quietStartHour: 0,
      quietEndHour: 6,
    });
    expect(
      deviceSettingsSchema.safeParse({ ...base, quietStart: "24", quietEnd: "1" }).success,
    ).toBe(false);
  });
});
