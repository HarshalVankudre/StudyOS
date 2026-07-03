import { describe, expect, it } from "vitest";
import { computeStreak } from "./streak";

describe("computeStreak", () => {
  const today = "2026-07-03";

  it("is zero with no study days", () => {
    expect(computeStreak([], today)).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    expect(computeStreak(["2026-07-01", "2026-07-02", "2026-07-03"], today)).toBe(3);
  });

  it("keeps the streak alive if studied yesterday but not yet today", () => {
    expect(computeStreak(["2026-07-01", "2026-07-02"], today)).toBe(2);
  });

  it("is zero once the last study day is before yesterday", () => {
    expect(computeStreak(["2026-06-30", "2026-07-01"], today)).toBe(0);
  });

  it("stops at the first gap", () => {
    // studied today and yesterday, gap, then earlier — streak is 2
    expect(
      computeStreak(["2026-06-29", "2026-07-02", "2026-07-03"], today),
    ).toBe(2);
  });

  it("dedupes multiple reviews on the same day", () => {
    expect(
      computeStreak(["2026-07-03", "2026-07-03", "2026-07-02"], today),
    ).toBe(2);
  });

  it("handles a single day (today)", () => {
    expect(computeStreak(["2026-07-03"], today)).toBe(1);
  });

  it("crosses month boundaries", () => {
    expect(
      computeStreak(["2026-06-30", "2026-07-01"], "2026-07-01"),
    ).toBe(2);
  });
});
