import Link from "next/link";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, humanise } from "@/lib/format";
import { DEAL_STATUSES } from "@/server/deals/workflow";
import { adminReads } from "@/server/services/admin";

export const metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  const now = new Date();
  const o = await adminReads.overview(new Date(now.getTime() - 7 * 86_400_000));
  const dealCount = (status: string) =>
    o.dealsByStatus.find((d) => d.status === status)?._count._all ?? 0;

  const cards = [
    {
      label: "Deals awaiting review",
      value: dealCount("PENDING_REVIEW"),
      href: "/admin/deals?status=PENDING_REVIEW",
    },
    {
      label: "Approved, not yet published",
      value: dealCount("APPROVED"),
      href: "/admin/deals?status=APPROVED",
    },
    {
      label: "Published deals",
      value: dealCount("PUBLISHED"),
      href: "/admin/deals?status=PUBLISHED",
    },
    { label: "Active products", value: o.activeProducts, href: "/admin/products" },
    { label: "Active retailers", value: o.activeRetailers, href: "/admin/retailers" },
    { label: "Users", value: o.users, href: "/admin/users" },
    { label: "Active alerts", value: o.activeAlerts, href: "/admin/alerts" },
    { label: "Clicks (last 7 days)", value: o.recentClicks, href: "/admin/clicks" },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Overview</h1>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((card) => (
          <li key={card.label}>
            <Link
              href={card.href}
              className="block rounded-lg border border-line p-4 hover:border-brand-600"
            >
              <span className="block text-2xl font-bold tabular-nums">{card.value}</span>
              <span className="text-sm text-ink-muted">{card.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Deals by status</h2>
        <p className="flex flex-wrap gap-3 text-sm">
          {DEAL_STATUSES.map((status) => (
            <Link key={status} href={`/admin/deals?status=${status}`} className="hover:underline">
              {humanise(status)}: <strong className="tabular-nums">{dealCount(status)}</strong>
            </Link>
          ))}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Recent imports</h2>
        {o.recentRuns.length === 0 ? (
          <p className="text-sm text-ink-muted">No imports have run yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink-muted">
                <tr>
                  <th className="py-1 pr-4 font-medium">Started</th>
                  <th className="py-1 pr-4 font-medium">Retailer</th>
                  <th className="py-1 pr-4 font-medium">Job</th>
                  <th className="py-1 pr-4 font-medium">Status</th>
                  <th className="py-1 pr-4 text-right font-medium">Seen / saved / failed</th>
                </tr>
              </thead>
              <tbody>
                {o.recentRuns.map((run) => (
                  <tr key={run.id} className="border-t border-line">
                    <td className="py-1 pr-4 whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                    <td className="py-1 pr-4">{run.retailer.name}</td>
                    <td className="py-1 pr-4">{humanise(run.jobType)}</td>
                    <td className="py-1 pr-4">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="py-1 pr-4 text-right tabular-nums">
                      {run.itemsSeen} / {run.itemsUpserted} / {run.itemsFailed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Recent activity</h2>
        {o.recentAudit.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {o.recentAudit.map((entry) => (
              <li key={entry.id}>
                <span className="text-ink-muted">{formatDateTime(entry.createdAt)}</span> ·{" "}
                <code>{entry.action}</code> by {entry.actor?.email ?? "system"}
                {entry.entityType === "Deal" ? (
                  <>
                    {" "}
                    ·{" "}
                    <Link
                      href={`/admin/deals/${entry.entityId}`}
                      className="text-brand-600 hover:underline"
                    >
                      view deal
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
