import { z } from "zod";

// A browser's push subscription, as sent by PushSubscription.toJSON(). The server later POSTs
// to the endpoint, so only the push services of the major browsers are accepted — never an
// arbitrary URL (which would let anyone make the server call any address).

const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Chromium), Opera, Samsung Internet
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, // Safari (macOS, iOS home-screen apps)
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge (legacy WNS)
];

export function isPushServiceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname))
    );
  } catch {
    return false;
  }
}

const base64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/);

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isPushServiceUrl, "Unsupported push service"),
  keys: z.object({ p256dh: base64url(200), auth: base64url(100) }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushEndpointSchema = z.object({
  endpoint: z.string().max(2048),
});

/** What a device follows without an account: "" = only the owner's own alerts. */
const broadcastLevel = z
  .enum(["", "price-error", "big-drop"])
  .transform((v) => (v === "" ? null : v === "price-error" ? "PRICE_ERROR" : "BIG_DROP"));

const hour = z
  .string()
  .regex(/^(|[01]?\d|2[0-3])$/)
  .transform((v) => (v === "" ? null : Number(v)));

export const deviceSignupSchema = z.object({
  subscription: pushSubscriptionSchema,
  level: broadcastLevel,
});

export const deviceSettingsSchema = z
  .object({
    endpoint: z.string().max(2048),
    level: broadcastLevel,
    quietStart: hour,
    quietEnd: hour,
  })
  .transform((s) => {
    // Both hours or neither; an empty window means no quiet hours.
    const quiet = s.quietStart !== null && s.quietEnd !== null && s.quietStart !== s.quietEnd;
    return {
      endpoint: s.endpoint,
      broadcastLevel: s.level as "PRICE_ERROR" | "BIG_DROP" | null,
      quietStartHour: quiet ? s.quietStart : null,
      quietEndHour: quiet ? s.quietEnd : null,
    };
  });

export type DeviceSettingsInput = z.output<typeof deviceSettingsSchema>;
