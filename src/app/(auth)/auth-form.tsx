"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthFormState } from "./actions";

type Props = {
  mode: "sign-in" | "sign-up";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next: string;
  passwordMin: number;
};

const input =
  "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export function AuthForm({ mode, action, next, passwordMin }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const signUp = mode === "sign-up";

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {signUp && (
        <label className="block text-sm font-medium">
          Name <span className="font-normal text-ink-muted">(optional)</span>
          <input
            name="name"
            autoComplete="name"
            defaultValue={state.name}
            maxLength={100}
            className={input}
          />
        </label>
      )}
      <label className="block text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className={input}
        />
      </label>
      <label className="block text-sm font-medium">
        Password
        <input
          name="password"
          type="password"
          autoComplete={signUp ? "new-password" : "current-password"}
          required
          minLength={signUp ? passwordMin : undefined}
          aria-describedby={signUp ? "password-hint" : undefined}
          className={input}
        />
        {signUp && (
          <span id="password-hint" className="mt-1 block text-xs font-normal text-ink-muted">
            At least {passwordMin} characters.
          </span>
        )}
      </label>
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Please wait…" : signUp ? "Create account" : "Sign in"}
      </button>
      <p className="text-sm text-ink-muted">
        {signUp ? "Already have an account? " : "New here? "}
        <Link
          href={`/${signUp ? "sign-in" : "sign-up"}?next=${encodeURIComponent(next)}`}
          className="font-medium text-brand-600 hover:underline"
        >
          {signUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
