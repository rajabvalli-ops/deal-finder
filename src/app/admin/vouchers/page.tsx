import { formatDateTime } from "@/lib/format";
import { adminReads } from "@/server/services/admin";
import { vouchers } from "@/server/services/vouchers";
import { ActionMessages } from "../_lib/messages";
import { param, type SearchParams } from "../_lib/params";
import { createVoucher, voucherAction } from "./actions";

export const metadata = { title: "Vouchers" };

const field = "mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1";
const button = "rounded-md border border-line px-3 py-1 font-medium hover:border-brand-600";

export default async function AdminVouchersPage({ searchParams }: { searchParams: SearchParams }) {
  const [sp, list, retailers] = await Promise.all([
    searchParams,
    vouchers.listForAdmin(),
    adminReads.listRetailers(),
  ]);
  const now = new Date();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Vouchers</h1>
      <ActionMessages notice={param(sp, "notice")} error={param(sp, "error")} />

      <section aria-labelledby="add-heading" className="space-y-3">
        <h2 id="add-heading" className="text-lg font-semibold">
          Add a voucher
        </h2>
        <form action={createVoucher} className="grid gap-3 text-sm sm:grid-cols-2">
          <label className="block">
            Retailer
            <select name="retailerId" required className={field}>
              {retailers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Code (leave empty if none is needed)
            <input
              name="code"
              maxLength={40}
              placeholder="SAVE10"
              className={`${field} uppercase`}
            />
          </label>
          <label className="block sm:col-span-2">
            Headline
            <input
              name="title"
              required
              minLength={3}
              maxLength={120}
              placeholder="10% off kitchen appliances"
              className={field}
            />
          </label>
          <label className="block sm:col-span-2">
            Details (optional)
            <input name="description" maxLength={500} className={field} />
          </label>
          <label className="block">
            Ends (UTC, optional)
            <input name="validUntil" type="datetime-local" className={field} />
          </label>
          <label className="block">
            Only for this deal (slug, optional)
            <input
              name="deal"
              maxLength={200}
              placeholder="glass-kettle-ab12cd"
              className={field}
            />
          </label>
          <label className="block sm:col-span-2">
            Terms (optional)
            <textarea name="terms" rows={2} maxLength={2000} className={field} />
          </label>
          <div>
            <button
              type="submit"
              className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
            >
              Add voucher
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="list-heading" className="space-y-3">
        <h2 id="list-heading" className="text-lg font-semibold">
          All vouchers ({list.length})
        </h2>
        {list.length === 0 ? (
          <p className="text-sm text-ink-muted">No vouchers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Voucher</th>
                  <th className="py-2 pr-4 font-medium">Retailer</th>
                  <th className="py-2 pr-4 font-medium">Ends</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const ended = c.validUntil !== null && c.validUntil <= now;
                  return (
                    <tr key={c.id} className="border-t border-line align-top">
                      <td className="py-2 pr-4">
                        <span className="font-mono font-bold">{c.code ?? "No code"}</span>
                        <span className="block">{c.title}</span>
                        {c.deal ? (
                          <a
                            href={`/admin/deals/${c.deal.id}`}
                            className="text-xs text-brand-600 hover:underline"
                          >
                            For: {c.deal.title}
                          </a>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4">{c.retailer.name}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {c.validUntil ? formatDateTime(c.validUntil) : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {!c.isActive ? "Off" : ended ? "Ended" : "Live"}
                        {c._count.reports > 0 ? (
                          <a
                            href="/admin/reports"
                            className="block text-xs text-red-700 hover:underline"
                          >
                            {c._count.reports} open report{c._count.reports === 1 ? "" : "s"}
                          </a>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-2">
                          <form action={voucherAction}>
                            <input type="hidden" name="couponId" value={c.id} />
                            <input
                              type="hidden"
                              name="action"
                              value={c.isActive ? "deactivate" : "activate"}
                            />
                            <button type="submit" className={button}>
                              {c.isActive ? "Switch off" : "Switch on"}
                            </button>
                          </form>
                          <form action={voucherAction}>
                            <input type="hidden" name="couponId" value={c.id} />
                            <input type="hidden" name="action" value="delete" />
                            <button
                              type="submit"
                              className={`${button} text-red-700`}
                              aria-label={`Delete voucher ${c.code ?? c.title}`}
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
