"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Session = { email: string; role: string } | null;

const link = "hover:text-brand-600";

/**
 * The signed-in part of the header. Pages are cached and shared by everyone, so the session
 * is looked up in the browser after the page loads rather than while rendering it.
 */
export function AccountLinks({ signOut }: { signOut: () => Promise<void> }) {
  const [session, setSession] = useState<Session | undefined>(undefined);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { user?: { email?: unknown; role?: unknown } } | null) => {
        if (cancelled) return;
        const user = data?.user;
        setSession(
          user && typeof user.email === "string"
            ? { email: user.email, role: typeof user.role === "string" ? user.role : "USER" }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
    // Re-checked on navigation, so signing in or out shows straight away.
  }, [pathname]);

  // Nothing until known, so the header doesn't flash "Sign in" for signed-in users.
  if (session === undefined) return <li aria-hidden="true" className="w-14" />;

  if (session === null) {
    return (
      <li>
        <Link href={`/sign-in?next=${encodeURIComponent(pathname || "/")}`} className={link}>
          Sign in
        </Link>
      </li>
    );
  }

  return (
    <>
      {session.role === "EDITOR" || session.role === "ADMIN" ? (
        <li>
          <Link href="/admin" className={link}>
            Admin
          </Link>
        </li>
      ) : null}
      <li>
        <form action={signOut}>
          <button type="submit" className={link} title={`Signed in as ${session.email}`}>
            Sign out
          </button>
        </form>
      </li>
    </>
  );
}
