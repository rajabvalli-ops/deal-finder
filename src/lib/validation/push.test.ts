import { describe, expect, it } from "vitest";
import { isPushServiceUrl, pushEndpointSchema, pushSubscriptionSchema } from "./push";

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
