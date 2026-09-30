import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { PASSWORD_MIN } from "@/lib/validation/auth";
import { getCurrentUser } from "@/server/auth";
import { signInAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeRedirectPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  return (
    <section className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <AuthForm mode="sign-in" action={signInAction} next={next} passwordMin={PASSWORD_MIN} />
    </section>
  );
}
