/**
 * Small per-instance sliding-window limiter for unauthenticated, low-value
 * endpoints (client error reports). Per-instance is enough here: the goal is to
 * stop a loop or a flood from filling the logs, not exact global accounting.
 */
export function createMemoryRateLimiter(opts: {
  limit: number;
  windowMs: number;
  /** Cap on tracked keys so a key-spraying client cannot grow memory without bound. */
  maxKeys?: number;
  now?: () => number;
}) {
  const hits = new Map<string, number[]>();
  const maxKeys = opts.maxKeys ?? 5_000;
  const now = opts.now ?? Date.now;

  return function allow(key: string): boolean {
    const t = now();
    const since = t - opts.windowMs;
    const recent = (hits.get(key) ?? []).filter((x) => x > since);
    if (recent.length >= opts.limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.delete(key);
    hits.set(key, recent);
    while (hits.size > maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
    return true;
  };
}
