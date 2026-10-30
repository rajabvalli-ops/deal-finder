import { createECDH, randomBytes } from "node:crypto";
// @ts-expect-error -- http_ece (web-push's own dependency) ships without type declarations
import ece from "http_ece";
import webpush from "web-push";
import { describe, expect, it, vi } from "vitest";
import {
  createPushSender,
  generateVapidKeys,
  pushConfigFromEnv,
  type PushMessage,
} from "./web-push";

const keys = generateVapidKeys();
const config = { ...keys, subject: "mailto:alerts@example.test" };
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-subscription";

/** A browser's side of a subscription: its key pair and auth secret. */
function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    target: {
      endpoint: ENDPOINT,
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
    },
  };
}

const message: PushMessage = {
  title: "Possible price error: Glass Kettle",
  body: "Glass Kettle is £9.99 at Example Shop, 90% below its recent average price.",
  url: "/deals/glass-kettle-abc123",
  tag: "deal-glass-kettle-abc123",
  image: "https://m.media-amazon.com/images/I/kettle.jpg",
  urgent: true,
};

describe("pushConfigFromEnv", () => {
  it("needs all three settings and a contact subject", () => {
    const env = {
      VAPID_PUBLIC_KEY: " pub ",
      VAPID_PRIVATE_KEY: "priv",
      VAPID_SUBJECT: "mailto:me@example.test",
    };
    expect(pushConfigFromEnv(env)).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:me@example.test",
    });
    expect(pushConfigFromEnv({ ...env, VAPID_SUBJECT: "https://example.test" })).not.toBeNull();
    expect(pushConfigFromEnv({ ...env, VAPID_SUBJECT: "me@example.test" })).toBeNull();
    expect(pushConfigFromEnv({ ...env, VAPID_PRIVATE_KEY: "" })).toBeNull();
    expect(pushConfigFromEnv({})).toBeNull();
  });
});

describe("createPushSender", () => {
  it("builds a request a browser can decrypt, signed with our VAPID key", async () => {
    const { ecdh, auth, target } = browser();
    let request: ReturnType<typeof webpush.generateRequestDetails> | undefined;
    const send = vi.fn(async (...args: Parameters<typeof webpush.sendNotification>) => {
      // The real library builds the request; only the network call is skipped.
      const [target, payload, options] = args;
      request = webpush.generateRequestDetails(target, payload as string, options);
      return { statusCode: 201, body: "", headers: {} };
    });
    const sender = createPushSender(config, { send });

    expect(await sender.send(target, message)).toBe("delivered");
    expect(request).toMatchObject({
      method: "POST",
      endpoint: ENDPOINT,
      headers: {
        TTL: 43200,
        Urgency: "high",
        Topic: "deal-glass-kettle-abc123",
        "Content-Encoding": "aes128gcm",
        Authorization: expect.stringMatching(/^vapid t=.+, k=/),
      },
    });
    const plaintext = ece.decrypt(request!.body, {
      version: "aes128gcm",
      privateKey: ecdh,
      authSecret: auth.toString("base64url"),
    });
    expect(JSON.parse(plaintext.toString("utf8"))).toEqual(message);
  });

  it("sends ordinary alerts at normal urgency without a topic when the tag has no usable characters", async () => {
    const send = vi.fn(async () => ({ statusCode: 201, body: "", headers: {} }));
    await createPushSender(config, { send }).send(browser().target, {
      ...message,
      urgent: false,
      tag: "££",
    });
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ urgency: "normal", topic: undefined }),
    );
  });

  it.each([
    [404, "gone"],
    [410, "gone"],
    [429, "failed"],
    [500, "failed"],
    [undefined, "failed"],
  ])("reports a %s response as %s", async (statusCode, result) => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error("push failed"), { statusCode });
    });
    expect(await createPushSender(config, { send }).send(browser().target, message)).toBe(result);
  });

  it("never contacts anything but a browser push service", async () => {
    const send = vi.fn();
    const sender = createPushSender(config, { send });
    const target = { ...browser().target, endpoint: "https://169.254.169.254/latest" };
    expect(await sender.send(target, message)).toBe("gone");
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the web-push library by default", () => {
    expect(() => createPushSender(config)).not.toThrow();
  });
});
