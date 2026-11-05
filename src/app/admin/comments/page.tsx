import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { comments } from "@/server/services/comments";
import { ActionMessages } from "../_lib/messages";
import { param, type SearchParams } from "../_lib/params";
import { moderateComment } from "./actions";

export const metadata = { title: "Comments" };

const button = "rounded-md border border-line px-3 py-1 font-medium hover:border-brand-600";

export default async function AdminCommentsPage({ searchParams }: { searchParams: SearchParams }) {
  const [sp, list] = await Promise.all([searchParams, comments.listForAdmin()]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Comments</h1>
      <ActionMessages notice={param(sp, "notice")} error={param(sp, "error")} />
      <p className="text-sm text-ink-muted">
        The latest 200 comments. Hiding one removes it from the deal page at once; the author
        isn&apos;t told.
      </p>
      {list.length === 0 ? (
        <p className="text-sm text-ink-muted">No comments yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {list.map((c) => (
            <li
              key={c.id}
              className={`flex flex-wrap items-start justify-between gap-3 p-3 ${c.status === "HIDDEN" ? "bg-surface-muted" : ""}`}
            >
              <div className="min-w-0 space-y-1">
                <p className="text-xs text-ink-muted">
                  {c.user.email} · {formatDateTime(c.createdAt)} ·{" "}
                  <Link
                    href={`/admin/deals/${c.deal.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    {c.deal.title}
                  </Link>
                  {c.status === "HIDDEN" ? " · Hidden" : ""}
                </p>
                <p className="break-words whitespace-pre-line">{c.body}</p>
              </div>
              <form action={moderateComment}>
                <input type="hidden" name="commentId" value={c.id} />
                <input
                  type="hidden"
                  name="action"
                  value={c.status === "HIDDEN" ? "show" : "hide"}
                />
                <button type="submit" className={button}>
                  {c.status === "HIDDEN" ? "Show" : "Hide"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
