// Per-device quiet hours, in UK time (the site's audience), so they follow the clocks going
// forward and back. A window can cross midnight, e.g. 23 → 7.

export const UK_TIME_ZONE = "Europe/London";

/** The hour (0–23) in the UK at `at`. */
export function ukHour(at: Date): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).format(at);
  return Number(hour);
}

/**
 * True when `at` falls inside [start, end) in UK time. Equal start and end, or no window,
 * means never quiet.
 */
export function isQuietHour(
  window: { quietStartHour: number | null; quietEndHour: number | null },
  at: Date,
): boolean {
  const { quietStartHour: start, quietEndHour: end } = window;
  if (start === null || end === null || start === end) return false;
  const hour = ukHour(at);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** "23:00–07:00", or null without a window. */
export function formatQuietHours(window: {
  quietStartHour: number | null;
  quietEndHour: number | null;
}): string | null {
  const { quietStartHour: start, quietEndHour: end } = window;
  if (start === null || end === null || start === end) return null;
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${hh(start)}–${hh(end)}`;
}
