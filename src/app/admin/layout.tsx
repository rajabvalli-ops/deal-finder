import type { Metadata } from "next";
import Link from "next/link";
import { hasRole, requireRole } from "@/server/auth";
import { signOutAction } from "../(auth)/actions";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin" },
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/deals", label: "Deals" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/retailers", label: "Retailers" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/users", label: "Users", adminOnly: true },
  { href: "/admin/alerts", label: "Alerts" },
  { href: "/admin/clicks", label: "Clicks" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("EDITOR", "/admin");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 text-sm">
        <nav aria-label="Admin">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
            {NAV.filter((item) => !item.adminOnly || hasRole(user.role, "ADMIN")).map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="hover:text-brand-600">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-ink-muted">
            Signed in as <strong className="text-ink">{user.email}</strong> (
            {user.role.toLowerCase()})
          </span>
          <form action={signOutAction}>
            <button type="submit" className="font-medium text-brand-600 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
      {children}
    </div>
  );
}
