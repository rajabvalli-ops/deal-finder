"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatVotes } from "@/lib/hot";

type Vote = -1 | 0 | 1;

type Props = {
  slug: string;
  /** Score from the (possibly cached) page; refreshed on load. */
  initialScore: number;
  vote: (input: {
    slug: string;
    value: Vote;
  }) => Promise<{ ok: true; score: number; myVote: Vote } | { ok: false; error: string }>;
  state: (input: {
    slug: string;
  }) => Promise<{ score: number; myVote: Vote; signedIn: boolean } | null>;
};

const base =
  "flex h-9 w-9 items-center justify-center rounded-full border text-lg transition disabled:opacity-60";

/** 🔥 hot / 🧊 cold voting on a deal, with its score. */
export function VoteButtons({ slug, initialScore, vote, state }: Props) {
  const [score, setScore] = useState(initialScore);
  const [myVote, setMyVote] = useState<Vote>(0);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [message, setMessage] = useState<"sign-in" | "error" | "slow-down" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    state({ slug })
      .then((s) => {
        if (cancelled || !s) return;
        setScore(s.score);
        setMyVote(s.myVote);
        setSignedIn(s.signedIn);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, state]);

  async function cast(value: Vote) {
    if (signedIn === false) {
      setMessage("sign-in");
      return;
    }
    const next: Vote = myVote === value ? 0 : value;
    setBusy(true);
    setMessage(null);
    try {
      const result = await vote({ slug, value: next });
      if (result.ok) {
        setScore(result.score);
        setMyVote(result.myVote);
      } else if (result.error === "SIGNED_OUT") {
        setSignedIn(false);
        setMessage("sign-in");
      } else {
        setMessage(result.error === "RATE_LIMITED" ? "slow-down" : "error");
      }
    } catch {
      setMessage("error");
    } finally {
      setBusy(false);
    }
  }

  const temperature = score > 0 ? "text-red-700" : score < 0 ? "text-sky-700" : "text-ink-muted";

  return (
    <div className="space-y-1">
      <div className="inline-flex items-center gap-2 rounded-full border border-line px-1.5 py-1">
        <button
          type="button"
          className={`${base} ${myVote === -1 ? "border-sky-600 bg-sky-50" : "border-transparent hover:bg-surface-muted"}`}
          aria-label="Vote cold"
          aria-pressed={myVote === -1}
          disabled={busy}
          onClick={() => cast(-1)}
        >
          🧊
        </button>
        <span
          className={`min-w-10 text-center font-bold tabular-nums ${temperature}`}
          aria-live="polite"
          aria-label={`Score ${formatVotes(score)}`}
        >
          {formatVotes(score)}
        </span>
        <button
          type="button"
          className={`${base} ${myVote === 1 ? "border-red-600 bg-red-50" : "border-transparent hover:bg-surface-muted"}`}
          aria-label="Vote hot"
          aria-pressed={myVote === 1}
          disabled={busy}
          onClick={() => cast(1)}
        >
          🔥
        </button>
      </div>
      {message === "sign-in" ? (
        <p className="text-sm">
          <Link
            href={`/sign-in?next=${encodeURIComponent(`/deals/${slug}`)}`}
            className="font-medium text-brand-600 hover:underline"
          >
            Sign in to vote
          </Link>
        </p>
      ) : null}
      {message === "error" ? (
        <p role="alert" className="text-sm text-red-700">
          That didn&apos;t work. Please try again.
        </p>
      ) : null}
      {message === "slow-down" ? (
        <p role="alert" className="text-sm text-red-700">
          You&apos;re voting very fast. Try again in a few minutes.
        </p>
      ) : null}
    </div>
  );
}
