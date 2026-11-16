import { describe, expect, it } from "vitest";
import { createWindowLimiter } from "./throttle";
import { createTtlCache } from "./view-cache";

describe("createWindowLimiter", () => {
  it("allows `limit` requests per key and window, then refuses until the window ends", () => {
    let t = 0;
    const allow = createWindowLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect([allow("a"), allow("a"), allow("a"), allow("a")]).toEqual([true, true, true, false]);
    expect(allow("b")).toBe(true);
    t = 999;
    expect(allow("a")).toBe(false);
    t = 1000;
    expect(allow("a")).toBe(true);
  });

  it("forgets the least recently used keys past maxKeys", () => {
    const allow = createWindowLimiter({ limit: 1, windowMs: 1000, maxKeys: 2, now: () => 0 });
    expect(allow("a")).toBe(true);
    expect(allow("b")).toBe(true);
    expect(allow("a")).toBe(false); // a is now the most recent
    expect(allow("c")).toBe(true); // b is forgotten
    expect(allow("a")).toBe(false);
    expect(allow("b")).toBe(true);
  });
});

describe("createTtlCache", () => {
  it("returns a value until its time to live is over", () => {
    let t = 0;
    const cache = createTtlCache<string>({ ttlMs: 30, maxEntries: 10, maxBytes: 100, now: () => t });
    cache.set("k", "v", 5);
    t = 29;
    expect(cache.get("k")).toBe("v");
    t = 30;
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });

  it("drops the oldest entries past its entry and byte bounds, and never keeps an oversized value", () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 2, maxBytes: 10, now: () => 0 });
    cache.set("a", 1, 4);
    cache.set("b", 2, 4);
    cache.set("c", 3, 4);
    expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual([undefined, 2, 3]);
    cache.set("d", 4, 9);
    expect([cache.get("b"), cache.get("c"), cache.get("d")]).toEqual([undefined, undefined, 4]);
    cache.set("huge", 5, 11);
    expect(cache.get("huge")).toBeUndefined();
    expect(cache.bytes).toBe(9);
  });

  it("replaces a key's value and its size", () => {
    const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 5, maxBytes: 100, now: () => 0 });
    cache.set("k", "one", 10);
    cache.set("k", "two", 20);
    expect(cache.get("k")).toBe("two");
    expect(cache.bytes).toBe(20);
    cache.delete("k");
    expect(cache.size).toBe(0);
  });
});
