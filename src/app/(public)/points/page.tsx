import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/admin/notice";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { POINTS } from "@/lib/points";
import { timeAgo } from "@/lib/voucher-price";
import { getCurrentUser } from "@/server/auth";
import { points } from "@/server/services/points";
import { checkIn } from "./actions";

export const metadata: Metadata = {
  title: "Your points",
  description: "Earn points for checking in daily, voting on deals and commenting.",
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const primary =
  "inline-block rounded-md bg-lime-400 px-5 py-2 font-bold text-black hover:bg-lime-300 disabled:opacity-60";

function HowToEarn() {
  return (
    <section aria-labelledby="earn-heading" className="space-y-2">
      <h2 id="earn-heading" className="text-xl font-bold">
        How to earn
      </h2>
      <ul className="list-inside list-disc space-y-1 text-sm">
        <li>
          Check in every day: {POINTS.checkIn} points, plus {POINTS.weeklyStreakBonus} extra on
          every 7th day in a row
        </li>
        <li>Vote a deal 🔥 hot or 🧊 cold: {POINTS.vote} point the first time for each deal</li>
        <li>
          Comment on a deal: {POINTS.comment} points, for up to {POINTS.commentsPerDay} comments a
          day
        </li>
      </ul>
      <p className="text-xs text-ink-muted">
        Points show how much you take part. They have no cash value and can&apos;t be exchanged for
        money, vouchers or prizes.
      </p>
    </section>
  );
}

export default async function PointsPage({ searchParams }: Props) {
  const [sp, user] = await Promise.all([searchParams, getCurrentUser()]);
  const header = (
    <>
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Points" }]} />
      <h1 className="text-3xl font-bold">Your points</h1>
    </>
  );

  if (!user) {
    return (
      <div className="space-y-6">
        {header}
        <p>
          <Link
            href="/sign-in?next=%2Fpoints"
            className="font-medium text-brand-600 hover:underline"
          >
            Sign in
          </Link>{" "}
          to check in daily and collect points.
        </p>
        <HowToEarn />
      </div>
    );
  }

  const now = new Date();
  const summary = await points.summary(user.id, now);
  const earned = Number(typeof sp.earned === "string" ? sp.earned : NaN);

  return (
    <div className="space-y-8">
      {header}
      {Number.isInteger(earned) && earned > 0 ? (
        <Notice tone="success">Checked in: +{earned} points.</Notice>
      ) : null}
      {sp.notice === "already" ? (
        <Notice tone="success">You&apos;ve already checked in today. Come back tomorrow!</Notice>
      ) : null}

      <section className="flex flex-wrap items-center gap-6 rounded-2xl bg-gradient-to-br from-frame-900 to-frame-800 p-6 text-white">
        <div>
          <p className="text-sm text-white/70">Points</p>
          <p className="text-4xl font-black text-lime-400 tabular-nums">{summary.balance}</p>
        </div>
        <div>
          <p className="text-sm text-white/70">Streak</p>
          <p className="text-2xl font-bold tabular-nums">
            🔥 {summary.streak} day{summary.streak === 1 ? "" : "s"}
          </p>
        </div>
        <div className="ml-auto">
          {summary.checkedInToday ? (
            <p className="font-medium">✅ Checked in today</p>
          ) : (
            <form action={checkIn}>
              <button type="submit" className={primary}>
                Check in for today
              </button>
            </form>
          )}
        </div>
      </section>

      <HowToEarn />

      <section aria-labelledby="history-heading" className="space-y-2">
        <h2 id="history-heading" className="text-xl font-bold">
          Recent
        </h2>
        {summary.recent.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing yet. Check in to get started.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {summary.recent.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 p-3">
                <span>
                  {e.label}{" "}
                  <span className="text-xs text-ink-muted">{timeAgo(e.createdAt, now)}</span>
                </span>
                <span className="font-bold text-saving-600 tabular-nums">+{e.points}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
