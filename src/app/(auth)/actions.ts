"use server";

import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { PASSWORD_MIN, signInSchema, signUpSchema } from "@/lib/validation/auth";
import { auth } from "@/server/auth/auth";

export type AuthFormState = { error: string | null; email?: string; name?: string };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function describe(error: unknown, fallback: string): string {
  if (isAPIError(error) && error.statusCode === 429) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  return fallback;
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email");
  const parsed = signInSchema.safeParse({ email, password: field(formData, "password") });
  if (!parsed.success) return { error: "Enter a valid email address and your password.", email };
  try {
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (error) {
    if (!isAPIError(error)) throw error;
    // Same message for unknown email and wrong password, so accounts can't be enumerated.
    return { error: describe(error, "Incorrect email or password."), email };
  }
  redirect(safeRedirectPath(field(formData, "next")));
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email");
  const name = field(formData, "name");
  const parsed = signUpSchema.safeParse({ email, name, password: field(formData, "password") });
  if (!parsed.success) {
    return {
      error: `Enter a valid email address and a password of at least ${PASSWORD_MIN} characters.`,
      email,
      name,
    };
  }
  try {
    await auth.api.signUpEmail({ body: parsed.data, headers: await headers() });
  } catch (error) {
    if (!isAPIError(error)) throw error;
    return {
      error: describe(error, "We couldn't create that account. Try signing in instead."),
      email,
      name,
    };
  }
  redirect(safeRedirectPath(field(formData, "next")));
}

export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}
