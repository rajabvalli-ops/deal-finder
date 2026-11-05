"use client";

import { useActionState } from "react";

export type ReportState = { status: "idle" | "sent" | "error" | "limited" | "gone" };

type Props = {
  target: "deal" | "coupon";
  id: string;
  reasons: Readonly<Record<string, string>>;
  action: (state: ReportState, formData: FormData) => Promise<ReportState>;
};

const MESSAGES: Record<Exclude<ReportState["status"], "idle">, string> = {
  sent: "Thanks — we'll check it.",
  error: "That didn't work. Please try again.",
  limited: "You've sent a lot of reports. Please try again later.",
  gone: "This has already been taken down.",
};

/** "Report a problem" on a deal or voucher: a few reasons, an optional note, no sign-in needed. */
export function ReportProblem({ target, id, reasons, action }: Props) {
  const [state, formAction, pending] = useActionState<ReportState, FormData>(action, {
    status: "idle",
  });

  if (state.status === "sent" || state.status === "gone") {
    return (
      <p role="status" className="text-sm text-ink-muted">
        {MESSAGES[state.status]}
      </p>
    );
  }

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-ink-muted hover:text-ink">Report a problem</summary>
      <form action={formAction} className="mt-2 space-y-2 rounded-md border border-line p-3">
        <input type="hidden" name="target" value={target} />
        <input type="hidden" name="id" value={id} />
        <fieldset className="space-y-1">
          <legend className="sr-only">What&apos;s wrong?</legend>
          {Object.entries(reasons).map(([value, label], index) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="reason"
                value={value}
                defaultChecked={index === 0}
                className="h-4 w-4"
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="block">
          <span className="sr-only">Anything else? (optional)</span>
          <input
            name="note"
            maxLength={300}
            placeholder="Anything else? (optional)"
            className="block w-full rounded-md border border-line bg-surface px-2 py-1"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line px-3 py-1 font-medium hover:bg-surface-muted disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send report"}
        </button>
        {state.status === "error" || state.status === "limited" ? (
          <p role="alert" className="text-red-700">
            {MESSAGES[state.status]}
          </p>
        ) : null}
      </form>
    </details>
  );
}
