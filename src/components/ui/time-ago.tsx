"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/voucher-price";

/**
 * "3 minutes ago" that stays current while the page is open. Pages are cached, so the text
 * rendered on the server can be a few minutes old; the browser corrects it straight away.
 */
export function TimeAgo({ date, prefix = "" }: { date: Date; prefix?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  return (
    <time dateTime={new Date(date).toISOString()} suppressHydrationWarning>
      {prefix}
      {timeAgo(new Date(date), now ?? new Date())}
    </time>
  );
}
