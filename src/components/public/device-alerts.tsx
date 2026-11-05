"use client";

import { useEffect, useState } from "react";

type Level = "" | "price-error" | "big-drop";

export type DeviceSettingsView = {
  level: Level;
  quietStart: string;
  quietEnd: string;
  hasAccount: boolean;
};

type Result = { ok: true } | { ok: false; error: string };

export type DeviceActions = {
  subscribe: (input: { subscription: unknown; level: Level }) => Promise<Result>;
  getSettings: (input: { endpoint: string }) => Promise<DeviceSettingsView | null>;
  saveSettings: (input: {
    endpoint: string;
    level: Level;
    quietStart: string;
    quietEnd: string;
  }) => Promise<Result>;
  remove: (input: { endpoint: string }) => Promise<{ ok: boolean }>;
};

type Props = {
  /** VAPID public key (base64url). */
  publicKey: string;
  actions: DeviceActions;
  /** Signed in: the device can also (or only) get the user's own alerts. */
  signedIn?: boolean;
};

type State =
  | { kind: "loading" | "unsupported" | "denied" | "off" | "working" }
  | { kind: "error"; message: string }
  | { kind: "on"; endpoint: string; settings: DeviceSettingsView; saved?: boolean };

const LEVEL_LABELS: Record<Level, string> = {
  "price-error": "Price errors only (70%+ off)",
  "big-drop": "Price errors and big drops (35%+ off)",
  "": "Only my own price alerts",
};

const HOURS = Array.from({ length: 24 }, (_, h) => String(h));
const hourLabel = (h: string) => `${h.padStart(2, "0")}:00`;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`;
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

const button =
  "rounded-md border border-line px-3 py-1 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";
const primary =
  "rounded-md bg-lime-400 px-4 py-2 text-sm font-bold text-black hover:bg-lime-300 disabled:opacity-60";
const select = "rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink";

/**
 * Push notifications on this device: price errors and big drops without an account, the
 * user's own alerts when signed in, and quiet hours (UK time) when nothing is sent.
 */
export function DeviceAlerts({ publicKey, actions, signedIn = false }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [level, setLevel] = useState<Level>("price-error");

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<State> => {
      if (!supported()) return { kind: "unsupported" };
      if (Notification.permission === "denied") return { kind: "denied" };
      const subscription = await currentSubscription();
      if (!subscription) return { kind: "off" };
      const settings = await actions.getSettings({ endpoint: subscription.endpoint });
      return settings ? { kind: "on", endpoint: subscription.endpoint, settings } : { kind: "off" };
    })()
      .catch((): State => ({ kind: "off" }))
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [actions]);

  async function turnOn() {
    setState({ kind: "working" });
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState({ kind: permission === "denied" ? "denied" : "off" });
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const result = await actions.subscribe({ subscription: subscription.toJSON(), level });
      if (!result.ok) {
        await subscription.unsubscribe();
        setState({
          kind: "error",
          message:
            result.error === "NOTHING_TO_FOLLOW"
              ? "Sign in to get only your own alerts, or choose price errors."
              : "That didn't work. Please try again.",
        });
        return;
      }
      const settings = await actions.getSettings({ endpoint: subscription.endpoint });
      setState(
        settings
          ? { kind: "on", endpoint: subscription.endpoint, settings }
          : { kind: "error", message: "That didn't work. Please try again." },
      );
    } catch {
      setState({ kind: "error", message: "That didn't work. Please try again." });
    }
  }

  async function turnOff() {
    setState({ kind: "working" });
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await actions.remove({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setState({ kind: "off" });
    } catch {
      setState({ kind: "error", message: "That didn't work. Please try again." });
    }
  }

  async function save(form: FormData) {
    if (state.kind !== "on") return;
    const settings = {
      level: String(form.get("level") ?? "") as Level,
      quietStart: String(form.get("quietStart") ?? ""),
      quietEnd: String(form.get("quietEnd") ?? ""),
    };
    const result = await actions.saveSettings({ endpoint: state.endpoint, ...settings });
    if (!result.ok) {
      setState({
        kind: "error",
        message:
          result.error === "NOTHING_TO_FOLLOW"
            ? "Without an account, choose price errors or big drops to follow."
            : "That didn't save. Please try again.",
      });
      return;
    }
    const fresh = await actions.getSettings({ endpoint: state.endpoint });
    if (fresh) setState({ kind: "on", endpoint: state.endpoint, settings: fresh, saved: true });
  }

  const levels: Level[] =
    signedIn || (state.kind === "on" && state.settings.hasAccount)
      ? ["price-error", "big-drop", ""]
      : ["price-error", "big-drop"];

  return (
    <div className="space-y-3 text-sm" aria-live="polite">
      {state.kind === "loading" ? <p className="text-ink-muted">Checking this device…</p> : null}
      {state.kind === "unsupported" ? (
        <p className="text-ink-muted">
          This browser can&apos;t receive notifications. On iPhone, open this site in Safari, tap
          Share → Add to Home Screen, then open it from the new icon.
        </p>
      ) : null}
      {state.kind === "denied" ? (
        <p className="text-ink-muted">
          Notifications are blocked for this site. Allow them in your browser settings to turn
          alerts on.
        </p>
      ) : null}
      {state.kind === "off" || state.kind === "working" || state.kind === "error" ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs font-medium">Alert me about</span>
            <select
              className={`${select} mt-1`}
              value={level}
              onChange={(e) => setLevel(e.target.value as Level)}
            >
              {levels.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={primary}
            onClick={turnOn}
            disabled={state.kind === "working"}
          >
            {signedIn
              ? "🔔 Turn on notifications on this device"
              : "🚨 Get price error alerts — no account needed"}
          </button>
          {state.kind === "error" ? (
            <p role="alert" className="w-full text-red-700">
              {state.message}
            </p>
          ) : null}
        </div>
      ) : null}
      {state.kind === "on" ? (
        <form action={save} className="space-y-3">
          <p className="font-medium">✅ Notifications are on for this device.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-xs font-medium">Alert me about</span>
              <select name="level" defaultValue={state.settings.level} className={`${select} mt-1`}>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABELS[l]}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="flex items-end gap-2">
              <legend className="text-xs font-medium">Quiet hours (UK time)</legend>
              <label className="block">
                <span className="sr-only">Quiet from</span>
                <select
                  name="quietStart"
                  defaultValue={state.settings.quietStart}
                  className={`${select} mt-1`}
                >
                  <option value="">Off</option>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="pb-1">to</span>
              <label className="block">
                <span className="sr-only">Quiet until</span>
                <select
                  name="quietEnd"
                  defaultValue={state.settings.quietEnd}
                  className={`${select} mt-1`}
                >
                  <option value="">Off</option>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={button}>
              Save
            </button>
            <button type="button" className={button} onClick={turnOff}>
              Turn off
            </button>
            {state.saved ? <span>Saved.</span> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
