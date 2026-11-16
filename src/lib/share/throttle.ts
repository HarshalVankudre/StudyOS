/**
 * Per-address throttles of the public share routes (/s/<token> and its
 * images), per instance and in memory: generous for people reading and
 * practising, tight enough that one address cannot hammer the database or
 * the storage bucket through a link. Keyed by lib/ops/client-ip's
 * rateLimitKey (an IPv6 client by its /64).
 *
 * A fixed window per key (from its first request) with a count, so a key
 * costs a few bytes however generous the limit; the least recently used
 * keys are forgotten past `maxKeys`.
 */

export const SHARE_THROTTLE_WINDOW_MS = 10 * 60 * 1000;
/** Shared pages one address may open per window. */
export const SHARE_PAGE_VIEWS_PER_WINDOW = 120;
/** Shared-page images one address may load per window. */
export const SHARE_ASSET_REQUESTS_PER_WINDOW = 600;

export interface WindowLimiterOptions {
  limit: number;
  windowMs: number;
  /** Keys tracked at most (the least recently used are dropped). */
  maxKeys?: number;
  now?: () => number;
}

/** `allow(key)`: true (and counted) while the key is under its limit in the current window. */
export function createWindowLimiter(opts: WindowLimiterOptions): (key: string) => boolean {
  const windows = new Map<string, { start: number; count: number }>();
  const maxKeys = opts.maxKeys ?? 20_000;
  const now = opts.now ?? (() => Date.now());
  return function allow(key: string): boolean {
    const t = now();
    let entry = windows.get(key);
    if (!entry || t - entry.start >= opts.windowMs) entry = { start: t, count: 0 };
    // Re-inserted on every hit: the Map's order is least recently used first.
    windows.delete(key);
    windows.set(key, entry);
    while (windows.size > maxKeys) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
    if (entry.count >= opts.limit) return false;
    entry.count += 1;
    return true;
  };
}

/** One request for a shared page (/s/<token>) from `key`. */
export const allowSharePageView = createWindowLimiter({
  limit: SHARE_PAGE_VIEWS_PER_WINDOW,
  windowMs: SHARE_THROTTLE_WINDOW_MS,
});

/** One request for a shared page's image from `key`. */
export const allowShareAssetRequest = createWindowLimiter({
  limit: SHARE_ASSET_REQUESTS_PER_WINDOW,
  windowMs: SHARE_THROTTLE_WINDOW_MS,
});
