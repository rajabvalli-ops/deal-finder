import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceChart } from "@/components/admin/price-chart";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, humanise, toDateTimeLocalValue } from "@/lib/format";
import { formatBps, formatPrice } from "@/lib/money";
import { allowedActions, isEditable } from "@/server/deals/workflow";
import { getDealDetail } from "@/server/services/admin";
import { ActionMessages } from "../../_lib/messages";
import { param, type SearchParams } from "../../_lib/params";
import { dealAction, updateDealContent } from "../actions";

export const metadata: Metadata = { title: "Deal" };

type Breakdown = {
  components: { key: string; points: number; max: number }[];
  penalties: { key: string; points: number }[];
};

function asBreakdown(value: unknown): Breakdown | null {
  const b = value as Partial<Breakdown> | null;
  return b && Array.isArray(b.components) && Array.isArray(b.penalties) ? (b as Breakdown) : null;
}

const SCORE_LABELS: Record<string, string> = {
  discountDepth: "Size of discount",
  historicalLow: "Near the lowest price",
  belowAverage90: "Below the 90-day average",
  savingAmount: "Saving in pounds",
  retailerTrust: "Retailer trust",
  socialProof: "Ratings and reviews",
  inflatedPreviousPrice: "Inflated previous price",
};

const REFERENCE_LABELS: Record<string, string> = {
  PREVIOUS: "previous price",
  AVG_30: "30-day average",
  AVG_90: "90-day average",
};

const input = "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2";

export default async function AdminDealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const now = new Date();
  const detail = await getDealDetail(id, now);
  if (!detail) notFound();
  const { deal, observations, stats, audit } = detail;
  const breakdown = asBreakdown(deal.scoreBreakdown);
  const actions = allowedActions(deal.status, "editor").filter((a) => a !== "submit");
  const returnTo = `/admin/deals/${deal.id}`;
  const detection = audit.find((a) => a.action === "deal.detect")?.diff as {
    reasons?: string[];
  } | null;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm">
          <Link href="/admin/deals" className="text-brand-600 hover:underline">
            ← Deals
          </Link>
        </p>
        <h1 className="text-2xl font-bold">{deal.title}</h1>
        <p className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          <StatusBadge status={deal.status} />
          <span>{deal.product.retailer.name}</span>
          <span>Detected {formatDateTime(deal.detectedAt)}</span>
          {deal.publishedAt ? <span>Published {formatDateTime(deal.publishedAt)}</span> : null}
          {deal.reviewedBy ? <span>Reviewed by {deal.reviewedBy.email}</span> : null}
        </p>
        <ActionMessages notice={param(sp, "notice")} error={param(sp, "error")} />
        {deal.rejectionReason ? (
          <p className="text-sm">Rejection reason: {deal.rejectionReason}</p>
        ) : null}
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {[
          ["Deal price", formatPrice(deal.dealPrice)],
          [
            `vs ${REFERENCE_LABELS[deal.referenceType] ?? deal.referenceType}`,
            formatPrice(deal.referencePrice),
          ],
          ["Saving", `${formatPrice(deal.savingAmount)} (${formatBps(deal.discountBps)})`],
          ["Score", `${deal.score} / 100`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line p-3">
            <span className="block text-sm text-ink-muted">{label}</span>
            <span className="text-lg font-semibold tabular-nums">{value}</span>
          </div>
        ))}
      </section>

      {actions.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Actions</h2>
          <div className="flex flex-wrap items-start gap-3">
            {actions
              .filter((a) => a !== "reject")
              .map((action) => (
                <form key={action} action={dealAction}>
                  <input type="hidden" name="dealId" value={deal.id} />
                  <input type="hidden" name="action" value={action} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button
                    type="submit"
                    className={
                      action === "approve" || action === "publish"
                        ? "rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
                        : "rounded-md border border-line px-4 py-2 font-medium hover:border-brand-600"
                    }
                  >
                    {humanise(action)}
                  </button>
                </form>
              ))}
            {actions.includes("reject") ? (
              <form action={dealAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="dealId" value={deal.id} />
                <input type="hidden" name="action" value="reject" />
                <input type="hidden" name="returnTo" value={returnTo} />
                <label className="text-sm">
                  Rejection reason
                  <input
                    name="reason"
                    required
                    maxLength={500}
                    className="mt-1 block rounded-md border border-line bg-surface px-3 py-2"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-md border border-red-300 px-4 py-2 font-medium text-red-800 hover:bg-red-50"
                >
                  Reject
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Why it was flagged</h2>
        {detection?.reasons?.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {detection.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{deal.summary ?? "—"}</p>
        )}
        {breakdown ? (
          <table className="text-sm">
            <tbody>
              {breakdown.components.map((c) => (
                <tr key={c.key}>
                  <td className="py-0.5 pr-6">{SCORE_LABELS[c.key] ?? c.key}</td>
                  <td className="py-0.5 text-right tabular-nums">
                    {c.points} / {c.max}
                  </td>
                </tr>
              ))}
              {breakdown.penalties.map((p) => (
                <tr key={p.key} className="text-red-800">
                  <td className="py-0.5 pr-6">Penalty: {SCORE_LABELS[p.key] ?? p.key}</td>
                  <td className="py-0.5 text-right tabular-nums">−{p.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className="text-xs text-ink-muted">Engine {deal.engineVersion}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Price history (last 180 days)</h2>
        <PriceChart
          observations={observations}
          until={now}
          label={`Price history for ${deal.product.title}`}
        />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          {[
            ["Current", stats.current],
            ["Lowest", stats.lowest],
            ["Highest", stats.highest],
            ["Previous", stats.previous],
            ["7-day avg", stats.avg7],
            ["30-day avg", stats.avg30],
            ["90-day avg", stats.avg90],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-ink-muted">{label}</dt>
              <dd className="tabular-nums">
                {value === null ? "—" : formatPrice(value as number)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-sm">
          <Link
            href={`/admin/products/${deal.productId}`}
            className="text-brand-600 hover:underline"
          >
            View product and full price table →
          </Link>
        </p>
      </section>

      {isEditable(deal.status) ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Edit content</h2>
          <p className="text-sm text-ink-muted">
            Prices and scores always come from the engines and can&apos;t be edited.
          </p>
          <form action={updateDealContent} className="max-w-2xl space-y-3">
            <input type="hidden" name="dealId" value={deal.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="block text-sm font-medium">
              Title
              <input
                name="title"
                required
                minLength={3}
                maxLength={200}
                defaultValue={deal.title}
                className={input}
              />
            </label>
            <label className="block text-sm font-medium">
              Summary
              <input
                name="summary"
                maxLength={300}
                defaultValue={deal.summary ?? ""}
                className={input}
              />
            </label>
            <label className="block text-sm font-medium">
              Description
              <textarea
                name="description"
                rows={4}
                maxLength={5000}
                defaultValue={deal.description ?? ""}
                className={input}
              />
            </label>
            <label className="block text-sm font-medium">
              Ends at (UTC, optional)
              <input
                name="expiresAt"
                type="datetime-local"
                defaultValue={toDateTimeLocalValue(deal.expiresAt)}
                className={input}
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                name="isFeatured"
                type="checkbox"
                defaultChecked={deal.isFeatured}
                value="on"
              />
              Featured on the homepage
            </label>
            <button
              type="submit"
              className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
            >
              Save changes
            </button>
          </form>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">History</h2>
        <ul className="space-y-1 text-sm">
          {audit.map((entry) => (
            <li key={entry.id}>
              <span className="text-ink-muted">{formatDateTime(entry.createdAt)}</span> ·{" "}
              <code>{entry.action}</code> by {entry.actor?.email ?? "system"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
