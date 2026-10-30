import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/admin/notice";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { formatDateTime } from "@/lib/format";
import { formatPrice } from "@/lib/money";
import { MAX_ALERTS_PER_USER } from "@/lib/validation/alerts";
import {
  DISCOUNT_OPTIONS,
  formatPoundsInput,
  parseSearchParams,
  type SearchFilters,
} from "@/lib/validation/search";
import { getCurrentUser } from "@/server/auth";
import { ALERT_ERROR_MESSAGES, alerts, type AlertErrorCode } from "@/server/services/alerts";
import { publicSearch } from "@/server/services/public";
import { alertAction, createAlert, notificationAction } from "./actions";

export const metadata: Metadata = {
  title: "Price alerts",
  description: "Get notified when a deal matches the product, price or discount you want.",
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const NOTICES: Record<string, string> = {
  created: "Alert created. We'll let you know when a new deal matches it.",
  pause: "Alert paused.",
  resume: "Alert resumed.",
  delete: "Alert deleted.",
  read: "Marked as read.",
  "read-all": "All notifications marked as read.",
};

const field =
  "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";
const label = "block text-sm font-medium";
const primaryButton =
  "inline-block rounded-md bg-brand-600 px-5 py-2 font-semibold text-white hover:bg-brand-700";
const smallButton =
  "rounded-md border border-line px-3 py-1 text-sm font-medium hover:bg-surface-muted";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function Messages({ notice, error }: { notice: string; error: string }) {
  if (error) {
    const message =
      error in ALERT_ERROR_MESSAGES
        ? ALERT_ERROR_MESSAGES[error as AlertErrorCode]
        : ALERT_ERROR_MESSAGES.INVALID_INPUT;
    return <Notice tone="error">{message}</Notice>;
  }
  return notice in NOTICES ? <Notice tone="success">{NOTICES[notice]}</Notice> : null;
}

function PriceFields({
  maxPrice,
  minDiscount,
}: {
  maxPrice: number | null;
  minDiscount: number | null;
}) {
  return (
    <>
      <label className={label}>
        Max price (£)
        <input
          name="max"
          inputMode="decimal"
          defaultValue={formatPoundsInput(maxPrice)}
          placeholder="Any"
          className={field}
        />
      </label>
      <label className={label}>
        Discount
        <select
          name="discount"
          defaultValue={minDiscount === null ? "" : String(minDiscount)}
          className={field}
        >
          <option value="">Any</option>
          {DISCOUNT_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}% or more
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

async function CreateAlertForm({
  prefill,
  dealSlug,
  returnTo,
}: {
  prefill: SearchFilters;
  dealSlug: string;
  returnTo: string;
}) {
  const deal = dealSlug ? await alerts.dealForAlert(dealSlug) : null;

  if (deal) {
    return (
      <form action={createAlert} className="space-y-4 rounded-lg border border-line p-4">
        <input type="hidden" name="deal" value={dealSlug} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <p>
          Watching <strong>{deal.productTitle}</strong>, now {formatPrice(deal.dealPrice)}.
          We&apos;ll tell you about its next deal that matches your price.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <PriceFields maxPrice={deal.dealPrice} minDiscount={null} />
        </div>
        <button type="submit" className={primaryButton}>
          Create alert
        </button>
      </form>
    );
  }

  const options = await publicSearch.options();
  return (
    <form action={createAlert} className="space-y-4 rounded-lg border border-line p-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      <p className="text-sm text-ink-muted">
        Choose a keyword, a category or both, then narrow it down if you like.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className={`${label} sm:col-span-2 lg:col-span-1`}>
          Keyword
          <input
            name="keyword"
            defaultValue={prefill.q}
            maxLength={100}
            placeholder="e.g. air fryer"
            className={field}
          />
        </label>
        <label className={label}>
          Category
          <select name="category" defaultValue={prefill.category ?? ""} className={field}>
            <option value="">Any category</option>
            {options.categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {`${"  ".repeat(c.depth)}${c.name}`}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Retailer
          <select name="retailer" defaultValue={prefill.retailer ?? ""} className={field}>
            <option value="">Any retailer</option>
            {options.retailers.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <PriceFields maxPrice={prefill.maxPrice} minDiscount={prefill.minDiscount} />
      </div>
      <button type="submit" className={primaryButton}>
        Create alert
      </button>
    </form>
  );
}

export default async function AlertsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const dealSlug = first(raw.deal).trim();
  const user = await getCurrentUser();

  // Keep the visitor's context (?deal=, a search) through sign-in and failed submissions.
  const context = new URLSearchParams();
  for (const key of ["deal", "q", "category", "retailer", "max", "discount"]) {
    const value = first(raw[key]);
    if (value) context.set(key, value);
  }
  const returnTo = context.size > 0 ? `/alerts?${context}` : "/alerts";

  const header = (
    <>
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Price alerts" }]} />
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Price alerts</h1>
        <p className="max-w-prose text-ink-muted">
          Tell us what you&apos;re after and we&apos;ll notify you here when a new deal matches it.
        </p>
      </div>
    </>
  );

  if (!user) {
    return (
      <div className="space-y-6">
        {header}
        <div className="space-y-4 rounded-lg border border-line p-6">
          <p>Sign in to create price alerts and see your notifications.</p>
          <p className="flex flex-wrap items-center gap-4">
            <Link href={`/sign-in?next=${encodeURIComponent(returnTo)}`} className={primaryButton}>
              Sign in
            </Link>
            <Link
              href={`/sign-up?next=${encodeURIComponent(returnTo)}`}
              className="font-medium text-brand-600 hover:underline"
            >
              Create an account
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const [alertList, notifications] = await Promise.all([
    alerts.list(user.id),
    alerts.notifications(user.id),
  ]);

  return (
    <div className="space-y-8">
      {header}
      <Messages notice={first(raw.notice)} error={first(raw.error)} />

      <section aria-labelledby="notifications-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="notifications-heading" className="text-xl font-bold">
            Notifications{notifications.unread > 0 ? ` (${notifications.unread} new)` : ""}
          </h2>
          {notifications.unread > 0 ? (
            <form action={notificationAction}>
              <input type="hidden" name="action" value="read-all" />
              <button type="submit" className={smallButton}>
                Mark all as read
              </button>
            </form>
          ) : null}
        </div>
        {notifications.items.length === 0 ? (
          <p className="text-ink-muted">
            No notifications yet. When a new deal matches one of your alerts, it appears here.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {notifications.items.map((n) => (
              <li
                key={n.id}
                className={`flex flex-wrap items-start justify-between gap-3 p-4 ${n.read ? "" : "bg-brand-50"}`}
              >
                <div className="space-y-1">
                  <p className="font-semibold">
                    {n.read ? null : <span className="sr-only">New: </span>}
                    {n.dealSlug ? (
                      <Link href={`/deals/${n.dealSlug}`} className="hover:text-brand-600">
                        {n.subject}
                      </Link>
                    ) : (
                      n.subject
                    )}
                  </p>
                  <p className="text-sm">{n.body}</p>
                  <p className="text-xs text-ink-muted">
                    {formatDateTime(n.createdAt)}
                    {n.dealSlug ? null : " · This deal has ended"}
                  </p>
                </div>
                {n.read ? null : (
                  <form action={notificationAction}>
                    <input type="hidden" name="action" value="read" />
                    <input type="hidden" name="notificationId" value={n.id} />
                    <button
                      type="submit"
                      className={smallButton}
                      aria-label={`Mark as read: ${n.subject}`}
                    >
                      Mark as read
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-alert-heading" className="space-y-3">
        <h2 id="new-alert-heading" className="text-xl font-bold">
          New alert
        </h2>
        {alertList.length >= MAX_ALERTS_PER_USER ? (
          <p className="text-ink-muted">{ALERT_ERROR_MESSAGES.LIMIT_REACHED}</p>
        ) : (
          <CreateAlertForm
            prefill={parseSearchParams(raw)}
            dealSlug={dealSlug}
            returnTo={returnTo}
          />
        )}
      </section>

      <section aria-labelledby="alerts-heading" className="space-y-3">
        <h2 id="alerts-heading" className="text-xl font-bold">
          Your alerts ({alertList.length})
        </h2>
        {alertList.length === 0 ? (
          <p className="text-ink-muted">You haven&apos;t set up any alerts yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {alertList.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="space-y-1">
                  <p className="font-semibold">{a.watching}</p>
                  <p className="text-sm text-ink-muted">
                    {a.condition}
                    {a.isActive ? "" : " · Paused"}
                    {a.lastTriggeredAt ? ` · Last match ${formatDateTime(a.lastTriggeredAt)}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <form action={alertAction}>
                    <input type="hidden" name="alertId" value={a.id} />
                    <input type="hidden" name="action" value={a.isActive ? "pause" : "resume"} />
                    <button
                      type="submit"
                      className={smallButton}
                      aria-label={`${a.isActive ? "Pause" : "Resume"} alert: ${a.watching}`}
                    >
                      {a.isActive ? "Pause" : "Resume"}
                    </button>
                  </form>
                  <form action={alertAction}>
                    <input type="hidden" name="alertId" value={a.id} />
                    <input type="hidden" name="action" value="delete" />
                    <button
                      type="submit"
                      className={`${smallButton} text-red-700`}
                      aria-label={`Delete alert: ${a.watching}`}
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
