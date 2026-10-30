import type { PriceStats } from "@/server/pricing";
import type { PriceSnapshot } from "@/server/db/repositories/product.repository";

export function toPriceSnapshot(stats: PriceStats, now: Date): PriceSnapshot {
  return {
    currentPrice: stats.current,
    previousPrice: stats.previous,
    lowestPrice: stats.lowest,
    highestPrice: stats.highest,
    avg7Price: stats.avg7,
    avg30Price: stats.avg30,
    avg90Price: stats.avg90,
    priceUpdatedAt: now,
  };
}
