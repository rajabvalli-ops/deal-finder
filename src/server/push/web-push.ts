import webpush from "web-push";
import { isPushServiceUrl } from "@/lib/validation/push";

// Web Push (RFC 8030) with VAPID keys. The keys are ours — generated once with
// `npm run push:keys` — so no third-party account is involved; browsers deliver through
// their own push services. Unset keys simply turn push off.

export const PUSH_ENV = {
  publicKey: "VAPID_PUBLIC_KEY",
  privateKey: "VAPID_PRIVATE_KEY",
  subject: "VAPID_SUBJECT",
} as const;

export type PushConfig = { publicKey: string; privateKey: string; subject: string };

/** VAPID settings, or null when push isn't configured (or only partly). */
export function pushConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): PushConfig | null {
  const publicKey = env[PUSH_ENV.publicKey]?.trim();
  const privateKey = env[PUSH_ENV.privateKey]?.trim();
  const subject = env[PUSH_ENV.subject]?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type PushMessage = {
  title: string;
  body: string;
  /** Same-site path opened when the notification is clicked. */
  url: string;
  /** Product photo shown in large notifications (Android, desktop Chrome); https only. */
  image: string | null;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
  urgent: boolean;
};

export type PushResult = "delivered" | "gone" | "failed";

type SendFn = typeof webpush.sendNotification;

/** Hours a push service keeps trying to reach an offline device. */
const PUSH_TTL_SECONDS = 12 * 3600;

export function createPushSender(
  config: PushConfig,
  options: { send?: SendFn; isAllowedEndpoint?: (url: string) => boolean } = {},
) {
  const send = options.send ?? webpush.sendNotification.bind(webpush);
  const isAllowed = options.isAllowedEndpoint ?? isPushServiceUrl;

  return {
    async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
      // Checked again here: only browser push services are ever contacted.
      if (!isAllowed(target.endpoint)) return "gone";
      try {
        await send(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(message),
          {
            vapidDetails: config,
            TTL: PUSH_TTL_SECONDS,
            urgency: message.urgent ? "high" : "normal",
            topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
            timeout: 10_000,
          },
        );
        return "delivered";
      } catch (error) {
        const status = (error as { statusCode?: unknown }).statusCode;
        // 404/410: the browser unsubscribed or the subscription expired.
        return status === 404 || status === 410 ? "gone" : "failed";
      }
    },
  };
}

export type PushSender = ReturnType<typeof createPushSender>;

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
