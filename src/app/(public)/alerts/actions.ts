"use server";

import { redirect } from "next/navigation";
import {
  alertActionSchema,
  alertFormSchema,
  notificationActionSchema,
} from "@/lib/validation/alerts";
import { headers } from "next/headers";
import { pushEndpointSchema, pushSubscriptionSchema } from "@/lib/validation/push";
import { getCurrentUser, requireRole } from "@/server/auth";
import { alerts } from "@/server/services/alerts";

/** FormData → plain object for Zod (last value wins; files ignored). */
function formObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData) if (typeof value === "string") result[key] = value;
  return result;
}

/** Back to the alerts page with a result code; only /alerts URLs are accepted from the form. */
function backToAlerts(returnTo: FormDataEntryValue | null, params: Record<string, string>): never {
  const path =
    typeof returnTo === "string" && /^\/alerts($|\?)/.test(returnTo) ? returnTo : "/alerts";
  const url = new URL(path, "http://alerts.invalid");
  for (const key of ["notice", "error"]) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  redirect(`${url.pathname}${url.search}`);
}

export async function createAlert(formData: FormData): Promise<void> {
  const user = await requireRole("USER", "/alerts");
  const returnTo = formData.get("returnTo");
  const parsed = alertFormSchema.safeParse(formObject(formData));
  if (!parsed.success) backToAlerts(returnTo, { error: "INVALID_INPUT" });

  const result = await alerts.create(user.id, parsed.data);
  // A new alert starts a clean page; an error keeps the visitor's context (e.g. ?deal=).
  if (result.ok) backToAlerts(null, { notice: "created" });
  backToAlerts(returnTo, { error: result.error });
}

export async function alertAction(formData: FormData): Promise<void> {
  const user = await requireRole("USER", "/alerts");
  const parsed = alertActionSchema.safeParse(formObject(formData));
  if (!parsed.success) backToAlerts(null, { error: "INVALID_INPUT" });

  const { alertId, action } = parsed.data;
  const result =
    action === "delete"
      ? await alerts.delete(user.id, alertId)
      : await alerts.setActive(user.id, alertId, action === "resume");
  backToAlerts(null, result.ok ? { notice: action } : { error: result.error });
}

export async function notificationAction(formData: FormData): Promise<void> {
  const user = await requireRole("USER", "/alerts");
  const parsed = notificationActionSchema.safeParse(formObject(formData));
  if (!parsed.success) backToAlerts(null, { error: "INVALID_INPUT" });

  const data = parsed.data;
  await alerts.markRead(
    user.id,
    new Date(),
    data.action === "read" ? data.notificationId : undefined,
  );
  backToAlerts(null, { notice: data.action });
}

/**
 * Called by the push toggle (client component) with the browser's subscription. Returns a
 * result instead of redirecting, so the button can show what happened.
 */
export async function savePushSubscription(
  subscription: unknown,
): Promise<{ ok: true } | { ok: false; error: "SIGNED_OUT" | "UNSUPPORTED" }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "SIGNED_OUT" };
  const parsed = pushSubscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { ok: false, error: "UNSUPPORTED" };
  const userAgent = (await headers()).get("user-agent");
  await alerts.savePushSubscription(user.id, parsed.data, userAgent);
  return { ok: true };
}

export async function removePushSubscription(input: unknown): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  const parsed = pushEndpointSchema.safeParse(input);
  if (!user || !parsed.success) return { ok: false };
  await alerts.removePushSubscription(user.id, parsed.data.endpoint);
  return { ok: true };
}
