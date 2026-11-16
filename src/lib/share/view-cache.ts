/**
 * A small in-memory cache with a time to live and two bounds: how many
 * entries it holds and roughly how many bytes they take. Per instance; the
 * shared-page loader (public-share.ts) keeps computed public views in one,
 * keyed by token AND workspace version, so an edit is a new key at once and
 * the TTL only bounds how long an unchanged page is reused.
 */

export interface TtlCacheOptions {
  ttlMs: number;
  maxEntries: number;
  /** Budget for the sum of the `bytes` given to set (an estimate is fine). */
  maxBytes: number;
  now?: () => number;
}

export interface TtlCache<V> {
  /** The live value for `key`, or undefined (missing or expired). */
  get(key: string): V | undefined;
  /** Store `value` (`bytes`: its rough size). A value larger than the whole budget is not kept. */
  set(key: string, value: V, bytes: number): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
  readonly bytes: number;
}

export function createTtlCache<V>(opts: TtlCacheOptions): TtlCache<V> {
  const entries = new Map<string, { value: V; expiresAt: number; bytes: number }>();
  const now = opts.now ?? (() => Date.now());
  let total = 0;

  const remove = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    total -= entry.bytes;
    entries.delete(key);
  };

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        remove(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, bytes) {
      remove(key);
      const size = Math.max(0, Math.ceil(bytes));
      if (size > opts.maxBytes) return;
      entries.set(key, { value, expiresAt: now() + opts.ttlMs, bytes: size });
      total += size;
      // Oldest first: Map keeps insertion order.
      while (entries.size > opts.maxEntries || total > opts.maxBytes) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        remove(oldest);
      }
    },
    delete: remove,
    clear() {
      entries.clear();
      total = 0;
    },
    get size() {
      return entries.size;
    },
    get bytes() {
      return total;
    },
  };
}
