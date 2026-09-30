import type { Availability } from "@/server/pricing";

export const DEFAULT_HEARTBEAT_MS = 24 * 3_600_000;

type Observation = {
  price: number;
  currency: string;
  availability: Availability;
  observedAt: Date;
};

/**
 * Price history is written when something changes, plus a "heartbeat" at least daily so the
 * pricing engine can tell "unchanged" from "not observed" (see maxObservationGapMs).
 */
export function shouldRecordObservation(
  latest: Observation | null,
  next: Omit<Observation, "observedAt">,
  now: Date,
  heartbeatMs: number = DEFAULT_HEARTBEAT_MS,
): boolean {
  if (!latest) return true;
  if (now.getTime() < latest.observedAt.getTime()) return false; // never write history out of order
  return (
    latest.price !== next.price ||
    latest.currency !== next.currency ||
    latest.availability !== next.availability ||
    now.getTime() - latest.observedAt.getTime() >= heartbeatMs
  );
}
