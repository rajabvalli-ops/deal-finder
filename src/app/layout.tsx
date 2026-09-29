import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { site, primaryNav } from "@/lib/site";
import { env } from "@/server/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: { default: site.name, template: `%s | ${site.name}` },
  description: site.tagline,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="flex min-h-dvh flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="text-lg font-bold text-brand-600">
              {site.name}
            </Link>
            <nav aria-label="Main">
              <ul className="flex gap-4 text-sm font-medium">
                {primaryNav.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="hover:text-brand-600">
                      {item.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href="/sign-in" className="hover:text-brand-600">
                    Sign in
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-line bg-surface-muted">
          <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-ink-muted">
            © {new Date().getFullYear()} {site.name}
          </div>
        </footer>
      </body>
    </html>
  );
}
