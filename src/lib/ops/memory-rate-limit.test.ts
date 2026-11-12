import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "./memory-rate-limit";

describe("memory rate limiter", () => {
  it("allows up to the limit per window, then recovers", () => {
    let t = 0;
    const allow = createMemoryRateLimiter({ limit: 2, windowMs: 1_000, now: () => t });
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
    expect(allow("b")).toBe(true);
    t = 1_001;
    expect(allow("a")).toBe(true);
  });

  it("bounds the number of tracked keys", () => {
    const allow = createMemoryRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    allow("a");
    allow("b");
    allow("c"); // evicts "a"
    expect(allow("a")).toBe(true);
  });
});
