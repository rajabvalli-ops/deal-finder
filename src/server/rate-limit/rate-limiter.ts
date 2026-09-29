export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** When the current window ends. */
  resetAt: Date;
};

/**
 * Limits how often a key (e.g. an IP hash + route) may act. Implementations must be safe
 * under concurrent calls. The in-memory one suits development and single instances; a
 * shared store (database or Redis) is needed across serverless instances.
 */
export interface RateLimiter {
  consume(key: string, now?: Date): Promise<RateLimitResult>;
}

/** Fixed-window counter held in process memory. */
export function createMemoryRateLimiter(options: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000 } = options;
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError("limit must be a positive integer");
  if (!Number.isInteger(windowMs) || windowMs < 1)
    throw new RangeError("windowMs must be a positive integer");
  const windows = new Map<string, { start: number; count: number }>();

  return {
    async consume(key, now = new Date()) {
      const t = now.getTime();
      let entry = windows.get(key);
      if (!entry || t >= entry.start + windowMs) {
        if (!entry && windows.size >= maxKeys) {
          // Bound memory: drop expired windows, then the oldest if still full.
          for (const [k, w] of windows) if (t >= w.start + windowMs) windows.delete(k);
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value!);
        }
        entry = { start: t, count: 0 };
        windows.set(key, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= limit,
        remaining: Math.max(0, limit - entry.count),
        resetAt: new Date(entry.start + windowMs),
      };
    },
  };
}
