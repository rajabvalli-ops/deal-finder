import Link from "next/link";
import { notFound } from "next/navigation";
import { AMAZON_SEARCH_INDEXES } from "@/lib/validation/amazon";
import { getCurrentUser, hasRole } from "@/server/auth";
import { getAmazonTracking } from "@/server/services/admin";
import { ActionMessages } from "../../_lib/messages";
import { param, type SearchParams } from "../../_lib/params";
import { addAmazonSearch, removeAmazonSearch, updateAmazonAsins } from "../actions";

export const metadata = { title: "Amazon tracking" };

const input = "rounded-md border border-line bg-surface px-2 py-1";
const button = "rounded-md border border-line px-3 py-1 font-medium hover:border-brand-600";

export default async function AmazonTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const [{ id }, sp, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  const tracking = await getAmazonTracking(id);
  if (!tracking) notFound();
  const { retailer, config, missingEnv } = tracking;
  const canEdit = user !== null && hasRole(user.role, "ADMIN");

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href="/admin/retailers" className="text-brand-600 hover:underline">
          ← Retailers
        </Link>
      </p>
      <h1 className="text-2xl font-bold">{retailer.name}: what to track</h1>
      <ActionMessages notice={param(sp, "notice")} error={param(sp, "error")} />

      <section aria-labelledby="setup-heading" className="space-y-2">
        <h2 id="setup-heading" className="text-lg font-semibold">
          Connection
        </h2>
        {missingEnv.length > 0 ? (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p>
              Not connected yet. Set these environment variables from your Amazon Associates
              Creators API credentials, then set the retailer to Active:
            </p>
            <ul className="mt-1 list-inside list-disc font-mono text-xs">
              {missingEnv.map((key) => (
                <li key={key}>{key}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm">
            Credentials are set. Status: <strong>{retailer.status.toLowerCase()}</strong>
            {retailer.status === "ACTIVE"
              ? ""
              : " — set it to Active on the Retailers page to start imports"}
            .
          </p>
        )}
        <p className="text-xs text-ink-muted">
          {retailer._count.products} products tracked so far, {retailer._count.deals} deals. Deals
          need 14 days of our own price history for a product before they can be detected.
        </p>
      </section>

      <section aria-labelledby="asins-heading" className="space-y-2">
        <h2 id="asins-heading" className="text-lg font-semibold">
          Products ({config.asins.length})
        </h2>
        <p className="text-sm text-ink-muted">
          ASINs or amazon.co.uk product links, one per line. Their prices are checked every few
          hours.
        </p>
        {canEdit ? (
          <form action={updateAmazonAsins} className="space-y-2">
            <input type="hidden" name="retailerId" value={retailer.id} />
            <label className="sr-only" htmlFor="asins">
              Products to track
            </label>
            <textarea
              id="asins"
              name="asins"
              rows={8}
              defaultValue={config.asins.join("\n")}
              className={`${input} block w-full font-mono text-sm`}
              placeholder={"B0ABCDEF12\nhttps://www.amazon.co.uk/dp/B0ABCDEF12"}
            />
            <button type="submit" className={button}>
              Save products
            </button>
          </form>
        ) : (
          <pre className="max-h-64 overflow-auto rounded-md bg-surface-muted p-2 text-xs">
            {config.asins.join("\n") || "None"}
          </pre>
        )}
      </section>

      <section aria-labelledby="searches-heading" className="space-y-3">
        <h2 id="searches-heading" className="text-lg font-semibold">
          Searches ({config.searches.length})
        </h2>
        <p className="text-sm text-ink-muted">
          Each import reads these Amazon searches and starts tracking what they find — a way to
          discover products without listing every ASIN.
        </p>
        {config.searches.length > 0 ? (
          <ul className="divide-y divide-line rounded-md border border-line text-sm">
            {config.searches.map((s, index) => (
              <li
                key={`${index}-${s.keywords}`}
                className="flex items-center justify-between gap-2 p-2"
              >
                <span>
                  “{s.keywords}”
                  {s.searchIndex
                    ? ` in ${AMAZON_SEARCH_INDEXES[s.searchIndex] ?? s.searchIndex}`
                    : ""}
                  {s.minSavingPercent ? `, ${s.minSavingPercent}%+ off` : ""} · {s.pages} page
                  {s.pages === 1 ? "" : "s"}
                </span>
                {canEdit ? (
                  <form action={removeAmazonSearch}>
                    <input type="hidden" name="retailerId" value={retailer.id} />
                    <input type="hidden" name="index" value={index} />
                    <button
                      type="submit"
                      className={button}
                      aria-label={`Remove search ${s.keywords}`}
                    >
                      Remove
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {canEdit ? (
          <form action={addAmazonSearch} className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="retailerId" value={retailer.id} />
            <label className="block">
              Keywords
              <input
                name="keywords"
                required
                minLength={2}
                maxLength={200}
                className={`${input} mt-1 block`}
              />
            </label>
            <label className="block">
              Department
              <select name="searchIndex" defaultValue="" className={`${input} mt-1 block`}>
                <option value="">All departments</option>
                {Object.entries(AMAZON_SEARCH_INDEXES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Min. Amazon discount %
              <input
                name="minSavingPercent"
                type="number"
                min={1}
                max={99}
                className={`${input} mt-1 block w-24`}
              />
            </label>
            <label className="block">
              Pages
              <input
                name="pages"
                type="number"
                min={1}
                max={10}
                defaultValue={1}
                className={`${input} mt-1 block w-20`}
              />
            </label>
            <button type="submit" className={button}>
              Add search
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
