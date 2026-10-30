import { humanise } from "@/lib/format";

const TONES: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-100 text-amber-900",
  DETECTED: "bg-amber-100 text-amber-900",
  APPROVED: "bg-sky-100 text-sky-900",
  PUBLISHED: "bg-emerald-100 text-emerald-900",
  ACTIVE: "bg-emerald-100 text-emerald-900",
  SUCCEEDED: "bg-emerald-100 text-emerald-900",
  PARTIAL: "bg-amber-100 text-amber-900",
  PAUSED: "bg-amber-100 text-amber-900",
  RUNNING: "bg-sky-100 text-sky-900",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONES[status] ?? "bg-surface-muted text-ink-muted"}`}
    >
      {humanise(status)}
    </span>
  );
}
