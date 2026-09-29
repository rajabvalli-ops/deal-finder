import type { Metadata } from "next";
import { requireRole } from "@/server/auth";
import { signOutAction } from "../(auth)/actions";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("EDITOR", "/admin");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 text-sm">
        <span>
          Signed in as <strong>{user.email}</strong> ({user.role.toLowerCase()})
        </span>
        <form action={signOutAction}>
          <button type="submit" className="font-medium text-brand-600 hover:underline">
            Sign out
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
