import Link from "next/link";
import { StatusBadge } from "@/components/admin/status-badge";
import { humanise } from "@/lib/format";
import { getCurrentUser, hasRole } from "@/server/auth";
import { adminReads } from "@/server/services/admin";
import { ActionMessages } from "../_lib/messages";
import { param, type SearchParams } from "../_lib/params";
import { updateRetailer } from "./actions";

export const metadata = { title: "Retailers" };

export default async function AdminRetailersPage({ searchParams }: { searchParams: SearchParams }) {
  const [sp, user, retailers] = await Promise.all([
    searchParams,
    getCurrentUser(),
    adminReads.listRetailers(),
  ]);
  const canEdit = user !== null && hasRole(user.role, "ADMIN");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Retailers</h1>
      <ActionMessages notice={param(sp, "notice")} error={param(sp, "error")} />
      {!canEdit ? (
        <p className="text-sm text-ink-muted">Only admins can change retailer settings.</p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-2 pr-4 font-medium">Retailer</th>
              <th className="py-2 pr-4 font-medium">Integration</th>
              <th className="py-2 pr-4 text-right font-medium">Products</th>
              <th className="py-2 pr-4 text-right font-medium">Deals</th>
              <th className="py-2 pr-4 font-medium">Status and trust (0–100)</th>
            </tr>
          </thead>
          <tbody>
            {retailers.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="py-2 pr-4">
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-xs text-ink-muted">{r.websiteUrl}</span>
                  {r.adapterKey === "amazon" ? (
                    <Link
                      href={`/admin/retailers/${r.id}`}
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      What to track →
                    </Link>
                  ) : null}
                </td>
                <td className="py-2 pr-4">
                  {humanise(r.integrationType)} <code className="text-xs">({r.adapterKey})</code>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{r._count.products}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{r._count.deals}</td>
                <td className="py-2 pr-4">
                  {canEdit ? (
                    <form action={updateRetailer} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="retailerId" value={r.id} />
                      <select
                        name="status"
                        defaultValue={r.status}
                        aria-label={`Status for ${r.name}`}
                        className="rounded-md border border-line bg-surface px-2 py-1"
                      >
                        {["ACTIVE", "PAUSED", "DISABLED"].map((s) => (
                          <option key={s} value={s}>
                            {humanise(s)}
                          </option>
                        ))}
                      </select>
                      <input
                        name="trustScore"
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={r.trustScore}
                        aria-label={`Trust score for ${r.name}`}
                        className="w-20 rounded-md border border-line bg-surface px-2 py-1"
                      />
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          name="autoPublish"
                          value="on"
                          defaultChecked={r.autoPublish}
                          className="h-4 w-4"
                        />
                        Auto-publish
                      </label>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-3 py-1 font-medium hover:border-brand-600"
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <span className="flex items-center gap-2">
                      <StatusBadge status={r.status} /> trust {r.trustScore}
                      {r.autoPublish ? " · auto-publish" : ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">
        Paused or disabled retailers are skipped by imports, and their active deals expire at the
        next check. Trust feeds the deal score. Auto-publish puts this retailer&apos;s new deals
        live (and alerts out) as soon as they are detected, without an editor&apos;s review.
      </p>
    </div>
  );
}
