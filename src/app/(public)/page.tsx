import Link from "next/link";
import { DealGrid } from "@/components/public/deal-card";
import { SearchBox } from "@/components/public/search-form";
import { site } from "@/lib/site";
import { publicCatalogue } from "@/server/services/public";

// Cached for five minutes; publishing or editing a deal in the admin refreshes it at once.
export const revalidate = 300;

function Section({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-bold">{title}</h2>
        {href ? (
          <Link href={href} className="text-sm font-medium text-brand-600 hover:underline">
            See all
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default async function HomePage() {
  const home = await publicCatalogue.homepage();
  const empty = home.latest.length === 0;

  return (
    <div className="space-y-12">
      <section className="space-y-4 overflow-hidden rounded-2xl bg-gradient-to-br from-navy-900 to-navy-800 px-6 py-10 text-white sm:px-10">
        <p className="text-xs font-bold tracking-[0.2em] text-accent-500 uppercase">
          Price drops · Price errors · Every day
        </p>
        <h1 className="max-w-2xl text-3xl font-black tracking-tight uppercase sm:text-5xl">
          Real deals. <span className="text-accent-500">Before they&apos;re gone.</span>
        </h1>
        <p className="max-w-2xl text-lg text-white/80">
          {site.name} watches UK prices around the clock and only lists a deal when the price is
          below its own recent history — never a made-up &ldquo;was&rdquo; price. Turn on alerts and
          we&apos;ll ping you the moment a price drops or looks like a mistake.
        </p>
        <div className="pt-1 text-ink">
          <SearchBox />
        </div>
        <ul className="flex flex-wrap gap-2 pt-1 text-sm font-semibold">
          <li>
            <Link
              href="/deals"
              className="block rounded-full bg-white/10 px-4 py-1.5 hover:bg-white/20"
            >
              Latest deals
            </Link>
          </li>
          <li>
            <Link
              href="/price-drops"
              className="block rounded-full bg-accent-600 px-4 py-1.5 hover:bg-accent-500"
            >
              🚨 Price errors &amp; big drops
            </Link>
          </li>
          <li>
            <Link
              href="/alerts"
              className="block rounded-full bg-white/10 px-4 py-1.5 hover:bg-white/20"
            >
              🔔 Get alerts
            </Link>
          </li>
        </ul>
      </section>

      {empty ? (
        <p className="rounded-lg border border-line p-6 text-ink-muted">
          No deals are live right now. Prices are checked throughout the day, so come back soon.
        </p>
      ) : null}

      {home.featured.length > 0 ? (
        <Section title="Featured deals">
          <DealGrid deals={home.featured} />
        </Section>
      ) : null}

      {home.latest.length > 0 ? (
        <Section title="Latest deals" href="/deals">
          <DealGrid deals={home.latest} />
        </Section>
      ) : null}

      {home.nearLows.length > 0 ? (
        <Section title="At or near their lowest price">
          <DealGrid deals={home.nearLows} />
        </Section>
      ) : null}

      <Section title={empty ? "Categories" : "Popular categories"}>
        <ul className="flex flex-wrap gap-2">
          {home.categories.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/categories/${c.slug}`}
                className="inline-block rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-brand-600"
              >
                {c.name}
                {c.dealCount > 0 ? (
                  <span className="ml-1 text-ink-muted">({c.dealCount})</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {home.retailers.length > 0 ? (
        <Section title="Popular retailers">
          <ul className="flex flex-wrap gap-2">
            {home.retailers.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/retailers/${r.slug}`}
                  className="inline-block rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-brand-600"
                >
                  {r.name} <span className="text-ink-muted">({r.dealCount})</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
