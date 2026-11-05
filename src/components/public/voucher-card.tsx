import Link from "next/link";
import { formatDate } from "@/lib/format";
import { formatVoucherDiscount, timeAgo } from "@/lib/voucher-price";
import { REPORT_REASONS } from "@/lib/validation/vouchers";
import { reportProblem } from "@/app/(public)/report-actions";
import { CopyCode } from "./copy-code";
import { ReportProblem } from "./report-problem";

export type VoucherCardData = {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  terms: string | null;
  validUntil: Date | null;
  discountPence: number | null;
  discountBps: number | null;
  minSpendPence: number | null;
  lastCheckedAt: Date | null;
  retailer: { slug: string; name: string };
  dealSlug: string | null;
};

const ENDING_SOON_MS = 3 * 86_400_000;

export function VoucherCard({
  voucher,
  now,
  showDealLink = true,
}: {
  voucher: VoucherCardData;
  now: Date;
  showDealLink?: boolean;
}) {
  const discount = formatVoucherDiscount(voucher);
  const endingSoon =
    voucher.validUntil !== null && voucher.validUntil.getTime() - now.getTime() < ENDING_SOON_MS;
  return (
    <article className="flex h-full flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
          {voucher.retailer.name}
        </p>
        {endingSoon ? (
          <span className="rounded bg-red-700 px-2 py-0.5 text-xs font-bold text-white">
            Ends soon
          </span>
        ) : null}
      </div>
      <h3 className="font-semibold">{voucher.title}</h3>
      {discount ? (
        <p className="w-fit rounded-md bg-lime-400 px-2 py-0.5 text-sm font-bold text-black">
          {discount}
        </p>
      ) : null}
      {voucher.code ? (
        <CopyCode code={voucher.code} />
      ) : (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-sm font-medium">No code needed</p>
      )}
      {voucher.description ? <p className="text-sm">{voucher.description}</p> : null}
      <p className="text-xs text-ink-muted">
        {voucher.validUntil ? `Ends ${formatDate(voucher.validUntil)}` : "No end date given"}
        {voucher.lastCheckedAt ? ` · ✓ Checked ${timeAgo(voucher.lastCheckedAt, now)}` : ""}
      </p>
      {voucher.terms ? (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">Terms</summary>
          <p className="mt-1 whitespace-pre-line">{voucher.terms}</p>
        </details>
      ) : null}
      <div className="mt-auto space-y-2">
        {showDealLink ? (
          <Link
            href={
              voucher.dealSlug
                ? `/deals/${voucher.dealSlug}`
                : `/retailers/${voucher.retailer.slug}`
            }
            className="block text-sm font-medium text-brand-600 hover:underline"
          >
            {voucher.dealSlug ? "See the deal →" : `More ${voucher.retailer.name} deals →`}
          </Link>
        ) : null}
        <ReportProblem
          target="coupon"
          id={voucher.id}
          reasons={REPORT_REASONS.coupon}
          action={reportProblem}
        />
      </div>
    </article>
  );
}
