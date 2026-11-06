import type { DealLevel } from "./public-types";

// "App first": deals that will be posted to X are held back for a while after they become
// news, so people with notifications on hear first. Until then they show "Early access".

const ORDER: Record<DealLevel, number> = { NORMAL: 0, BIG_DROP: 1, PRICE_ERROR: 2 };

/** When the deal leaves early access (goes out on X), or null if it never is in it. */
export function earlyAccessUntil(
  deal: { level: DealLevel; publishedAt: Date | null; levelRaisedAt: Date | null },
  settings: { delayMinutes: number; minLevel: DealLevel },
): Date | null {
  if (settings.delayMinutes <= 0 || deal.publishedAt === null) return null;
  if (ORDER[deal.level] < ORDER[settings.minLevel]) return null;
  const news = Math.max(deal.publishedAt.getTime(), deal.levelRaisedAt?.getTime() ?? 0);
  return new Date(news + settings.delayMinutes * 60_000);
}

export function isEarlyAccess(
  deal: Parameters<typeof earlyAccessUntil>[0],
  settings: Parameters<typeof earlyAccessUntil>[1],
  now: Date,
): boolean {
  const until = earlyAccessUntil(deal, settings);
  return until !== null && now < until;
}
