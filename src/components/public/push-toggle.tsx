"use client";

import { useEffect, useState } from "react";

type SaveResult = { ok: true } | { ok: false; error: string };

type Props = {
  /** VAPID public key (base64url). */
  publicKey: string;
  save: (subscription: unknown) => Promise<SaveResult>;
  remove: (input: { endpoint: string }) => Promise<{ ok: boolean }>;
};

type State = "loading" | "unsupported" | "denied" | "off" | "on" | "working" | "error";

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

/** Whether this browser can receive pushes, and whether it already does. */
async function currentState(): Promise<State> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return (await registration?.pushManager.getSubscription()) ? "on" : "off";
  } catch {
    return "off";
  }
}

/** Turns price-alert push notifications on or off for this browser. */
export function PushToggle({ publicKey, save, remove }: Props) {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    currentState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
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
      const result = await save(subscription.toJSON());
      if (!result.ok) {
        await subscription.unsubscribe();
        setState("error");
        return;
      }
      setState("on");
    } catch {
      setState("error");
    }
  }

  async function turnOff() {
    setState("working");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await remove({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setState("error");
    }
  }

  const button =
    "rounded-md border border-line px-3 py-1 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" aria-live="polite">
      {state === "loading" ? <span className="text-ink-muted">Checking this device…</span> : null}
      {state === "unsupported" ? (
        <span className="text-ink-muted">
          This browser can&apos;t receive push notifications. On iPhone, add this site to your Home
          Screen first.
        </span>
      ) : null}
      {state === "denied" ? (
        <span className="text-ink-muted">
          Notifications are blocked for this site. Allow them in your browser settings to turn this
          on.
        </span>
      ) : null}
      {state === "off" || state === "error" || state === "working" ? (
        <>
          <button type="button" className={button} onClick={turnOn} disabled={state === "working"}>
            Turn on notifications on this device
          </button>
          {state === "error" ? (
            <span role="alert" className="text-red-700">
              That didn&apos;t work. Please try again.
            </span>
          ) : null}
        </>
      ) : null}
      {state === "on" ? (
        <>
          <span>Notifications are on for this device.</span>
          <button type="button" className={button} onClick={turnOff}>
            Turn off
          </button>
        </>
      ) : null}
    </div>
  );
}
