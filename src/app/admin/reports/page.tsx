import Link from "next/link";
import { formatDateTime, humanise } from "@/lib/format";
import { reports } from "@/server/services/reports";
import { ActionMessages } from "../_lib/messages";
import { param, type SearchParams } from "../_lib/params";
import { voucherAction } from "../vouchers/actions";
import { closeReports } from "./actions";

export const metadata = { title: "Reports" };

const button = "rounded-md border border-line px-3 py-1 font-medium hover:border-brand-600";

export default async function AdminReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const [sp, groups] = await Promise.all([searchParams, reports.openGroups()]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Reports</h1>
      <ActionMessages notice={param(sp, "notice")} error={param(sp, "error")} />
      <p className="text-sm text-ink-muted">
        Problems visitors reported. Vouchers are switched off automatically after 3 &ldquo;ended /
        doesn&apos;t work&rdquo; reports; deals are never taken down by reports alone — open the
        deal and expire it if they&apos;re right.
      </p>
      {groups.length === 0 ? (
        <p className="rounded-lg border border-line p-6 text-ink-muted">No open reports.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {groups.map((g) => (
            <li key={g.targetId} className="space-y-2 p-4 text-sm">
              <p>
                <span className="mr-2 rounded bg-surface-muted px-1.5 py-0.5 text-xs font-medium">
                  {g.target === "DEAL" ? "Deal" : "Voucher"}
                </span>
                <Link href={g.href} className="font-semibold hover:text-brand-600">
                  {g.label}
                </Link>
                {g.live ? null : <span className="text-ink-muted"> · no longer live</span>}
              </p>
              <p>
                <strong>
                  {g.count} report{g.count === 1 ? "" : "s"}
                </strong>
                {" — "}
                {Object.entries(g.reasons)
                  .map(([reason, n]) => `${humanise(reason)} ×${n}`)
                  .join(", ")}
                <span className="text-ink-muted"> · latest {formatDateTime(g.latestAt)}</span>
              </p>
              {g.notes.length > 0 ? (
                <ul className="list-inside list-disc text-ink-muted">
                  {g.notes.slice(0, 5).map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {g.target === "COUPON" && g.live ? (
                  <form action={voucherAction}>
                    <input type="hidden" name="couponId" value={g.targetId} />
                    <input type="hidden" name="action" value="deactivate" />
                    <input type="hidden" name="returnTo" value="/admin/reports" />
                    <button type="submit" className={button}>
                      Switch voucher off
                    </button>
                  </form>
                ) : null}
                {g.target === "DEAL" && g.live ? (
                  <Link href={g.href} className={button}>
                    Open deal to expire it
                  </Link>
                ) : null}
                <form action={closeReports}>
                  <input type="hidden" name="targetId" value={g.targetId} />
                  <input type="hidden" name="outcome" value="resolve" />
                  <button type="submit" className={button}>
                    Mark handled
                  </button>
                </form>
                <form action={closeReports}>
                  <input type="hidden" name="targetId" value={g.targetId} />
                  <input type="hidden" name="outcome" value="dismiss" />
                  <button type="submit" className={button}>
                    Dismiss (nothing wrong)
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
