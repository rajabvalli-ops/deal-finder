import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { VoucherCard } from "@/components/public/voucher-card";
import { vouchers } from "@/server/services/vouchers";

export const metadata: Metadata = {
  title: "Voucher codes",
  description: "Working UK voucher and promo codes, checked and taken down when they end.",
};

// Cached for five minutes; adding or switching off a voucher refreshes it at once.
export const revalidate = 300;

export default async function VouchersPage() {
  const now = new Date();
  const list = await vouchers.listLive(now);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Voucher codes" }]} />
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Voucher codes</h1>
        <p className="max-w-prose text-ink-muted">
          Tap a code to copy it, then use it at checkout. Codes that end or stop working are taken
          down — if one doesn&apos;t work for you, report it.
        </p>
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border border-line p-6 text-ink-muted">
          No voucher codes right now. Check back soon.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((v) => (
            <li key={v.id}>
              <VoucherCard voucher={v} now={now} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
