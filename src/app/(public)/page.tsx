import Link from "next/link";
import { DealGrid } from "@/components/public/deal-card";
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
      <section className="space-y-3 rounded-2xl bg-brand-50 px-6 py-10 sm:px-10">
        <h1 className="max-w-2xl text-3xl font-bold sm:text-4xl">
          Genuine price drops from UK retailers
        </h1>
        <p className="max-w-2xl text-lg text-ink-muted">
          {site.name} tracks prices every day and only lists a deal when the price is below its own
          recent history — not a made-up &ldquo;was&rdquo; price. Every deal is checked by a person
          before it appears here.
        </p>
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
