import { TimeAgo } from "@/components/ui/time-ago";

/** "170 live · prices checked 39 seconds ago", with a pulsing dot. */
export function LiveLine({ count, lastCheckedAt }: { count: number; lastCheckedAt: Date | null }) {
  return (
    <p className="flex items-center gap-2 font-medium">
      <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-75 motion-reduce:hidden" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-lime-400" />
      </span>
      <span>
        {count} live
        {lastCheckedAt ? (
          <>
            {" · "}
            <TimeAgo date={lastCheckedAt} prefix="prices checked " />
          </>
        ) : null}
      </span>
    </p>
  );
}
