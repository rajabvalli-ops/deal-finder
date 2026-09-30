const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});
const dateOnly = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Europe/London",
});

/** "5 Jun 2026, 13:00" in UK time. */
export function formatDateTime(date: Date | null | undefined): string {
  return date ? dateTime.format(date) : "—";
}

export function formatDate(date: Date | null | undefined): string {
  return date ? dateOnly.format(date) : "—";
}

/** Value for <input type="datetime-local">, in UTC (the admin form treats it as UTC). */
export function toDateTimeLocalValue(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 16) : "";
}

/** "PENDING_REVIEW" → "Pending review". */
export function humanise(code: string): string {
  const text = code.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
