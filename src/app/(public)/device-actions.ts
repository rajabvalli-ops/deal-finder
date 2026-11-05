"use server";

import { headers } from "next/headers";
import {
  deviceSettingsSchema,
  deviceSignupSchema,
  pushEndpointSchema,
} from "@/lib/validation/push";
import { getCurrentUser } from "@/server/auth";
import { alerts } from "@/server/services/alerts";

// Push notifications for this browser ("device"). No account is needed to follow price errors
// or big drops; signed in, the device also gets the user's own alerts. A device is identified
// by its push endpoint, which only that browser knows.

export type DeviceSettings = {
  level: "" | "price-error" | "big-drop";
  quietStart: string;
  quietEnd: string;
  hasAccount: boolean;
};

export type DeviceResult = { ok: true } | { ok: false; error: "INVALID" | "NOTHING_TO_FOLLOW" };

export async function subscribeDevice(input: unknown): Promise<DeviceResult> {
  const parsed = deviceSignupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  const [user, requestHeaders] = await Promise.all([getCurrentUser(), headers()]);
  return alerts.savePushSubscription(
    user?.id ?? null,
    parsed.data.subscription,
    requestHeaders.get("user-agent"),
    parsed.data.level,
  );
}

export async function getDeviceSettings(input: unknown): Promise<DeviceSettings | null> {
  const parsed = pushEndpointSchema.safeParse(input);
  if (!parsed.success) return null;
  const device = await alerts.deviceSettings(parsed.data.endpoint);
  if (!device) return null;
  const level = device.broadcastLevel;
  return {
    level: level === null ? "" : level === "PRICE_ERROR" ? "price-error" : "big-drop",
    quietStart: device.quietStartHour === null ? "" : String(device.quietStartHour),
    quietEnd: device.quietEndHour === null ? "" : String(device.quietEndHour),
    hasAccount: device.hasAccount,
  };
}

export async function saveDeviceSettings(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: "INVALID" | "NOT_FOUND" | "NOTHING_TO_FOLLOW" }> {
  const parsed = deviceSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  return alerts.updateDeviceSettings(parsed.data);
}

export async function removeDevice(input: unknown): Promise<{ ok: boolean }> {
  const parsed = pushEndpointSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const user = await getCurrentUser();
  return { ok: await alerts.removeDevice(user?.id ?? null, parsed.data.endpoint) };
}
