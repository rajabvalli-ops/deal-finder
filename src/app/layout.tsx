import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AccountLinks } from "@/components/public/account-links";
import { AffiliateDisclosure } from "@/components/public/affiliate-disclosure";
import { site, primaryNav } from "@/lib/site";
import { env } from "@/server/env";
import { signOutAction } from "./(auth)/actions";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: { default: site.name, template: `%s | ${site.name}` },
  description: site.tagline,
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: site.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0d10",
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
        <header className="border-b-4 border-lime-400 bg-frame-900 text-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2" aria-label={`${site.name} home`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
              <img src="/icon-192.png" alt="" width={36} height={36} className="rounded-full" />
              <span className="text-xl font-black tracking-tight uppercase">Deal Broker</span>
              <span className="rounded bg-lime-400 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-black">
                UK
              </span>
            </Link>
            <nav aria-label="Main">
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
                {primaryNav.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={
                        item.href === "/price-drops"
                          ? "rounded bg-lime-400 px-2 py-0.5 text-black hover:bg-lime-300"
                          : "hover:underline underline-offset-4"
                      }
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
                <AccountLinks signOut={signOutAction} />
              </ul>
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-line bg-surface-muted">
          <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-sm text-ink-muted">
            <AffiliateDisclosure compact />
            <p>
              © {new Date().getFullYear()} {site.name}
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
