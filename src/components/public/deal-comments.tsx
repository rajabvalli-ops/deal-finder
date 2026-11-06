"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/voucher-price";

const MAX_LENGTH = 1000;

export type CommentItem = {
  id: string;
  author: string;
  body: string;
  createdAt: Date;
  mine: boolean;
};

type Props = {
  slug: string;
  list: (input: {
    slug: string;
  }) => Promise<{ items: CommentItem[]; total: number; signedIn: boolean } | null>;
  post: (input: {
    slug: string;
    body: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  remove: (input: { commentId: string }) => Promise<{ ok: boolean }>;
};

const ERRORS: Record<string, string> = {
  INVALID: "Write something first (up to 1,000 characters).",
  RATE_LIMITED: "You're commenting very fast. Try again in a few minutes.",
  NOT_FOUND: "This deal is no longer live, so it can't take comments.",
};

/** Comments on a deal: read by anyone, written by signed-in users. */
export function DealComments({ slug, list, post, remove }: Props) {
  const [data, setData] = useState<{
    items: CommentItem[];
    total: number;
    signedIn: boolean;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reloads after posting or deleting.
  const load = useCallback(async () => {
    try {
      setData(await list({ slug }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [list, slug]);

  useEffect(() => {
    let cancelled = false;
    list({ slug })
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [list, slug]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await post({ slug, body });
      if (result.ok) {
        setBody("");
        await load();
      } else if (result.error === "SIGNED_OUT") {
        setData((d) => (d ? { ...d, signedIn: false } : d));
      } else {
        setError(ERRORS[result.error] ?? "That didn't work. Please try again.");
      }
    } catch {
      setError("That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteComment(id: string) {
    if ((await remove({ commentId: id })).ok) await load();
  }

  const now = new Date();
  const signInHref = `/sign-in?next=${encodeURIComponent(`/deals/${slug}`)}`;

  return (
    <section id="comments" aria-labelledby="comments-heading" className="space-y-4">
      <h2 id="comments-heading" className="text-xl font-bold">
        Comments{data && data.total > 0 ? ` (${data.total})` : ""}
      </h2>

      {data === null && !failed ? <p className="text-ink-muted">Loading comments…</p> : null}
      {failed ? <p className="text-ink-muted">Comments couldn&apos;t be loaded.</p> : null}

      {data?.signedIn ? (
        <form onSubmit={submit} className="space-y-2">
          <label htmlFor="comment-body" className="block text-sm font-medium">
            Add a comment
          </label>
          <textarea
            id="comment-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={MAX_LENGTH}
            required
            placeholder="Got one? Price changed? Tell others."
            className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || body.trim() === ""}
              className="rounded-md bg-lime-400 px-4 py-2 text-sm font-bold text-black hover:bg-lime-300 disabled:opacity-60"
            >
              Post comment
            </button>
            {error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            ) : null}
          </div>
        </form>
      ) : data ? (
        <p className="text-sm">
          <Link href={signInHref} className="font-medium text-brand-600 hover:underline">
            Sign in to comment
          </Link>
        </p>
      ) : null}

      {data && data.items.length === 0 ? (
        <p className="text-sm text-ink-muted">No comments yet.</p>
      ) : null}
      {data && data.items.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {data.items.map((c) => (
            <li key={c.id} className="space-y-1 p-3">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-semibold">{c.author}</span>
                <span className="text-xs text-ink-muted">
                  {timeAgo(new Date(c.createdAt), now)}
                </span>
                {c.mine ? (
                  <button
                    type="button"
                    onClick={() => deleteComment(c.id)}
                    className="ml-auto text-xs text-red-700 hover:underline"
                  >
                    Delete
                  </button>
                ) : null}
              </p>
              <p className="text-sm break-words whitespace-pre-line">{c.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
