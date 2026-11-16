import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/dictionaries/en";
import { describeChange, formatMinutes, formatPercent, periodKey } from "./format";

const base = { hasPrevious: true, period: "30d" as const, copy: en, show: (n: number) => String(n) };

describe("insights formatting", () => {
  it("writes durations with the Today view's words and the student's digits", () => {
    expect(formatMinutes(0, en, "en")).toBe("0 min");
    expect(formatMinutes(59.6, en, "en")).toBe("1 h");
    expect(formatMinutes(152, en, "en")).toBe("2 h 30 min");
    expect(formatMinutes(1_500 * 60, en, "en")).toBe("1,500 h");
    const ar = getDictionary("ar");
    expect(formatMinutes(25, ar, "ar")).toBe(`${new Intl.NumberFormat("ar").format(25)} د`);
  });

  it("describes a change up, down, unchanged, or with nothing to compare", () => {
    expect(describeChange({ current: 30, previous: 10, change: 20 }, base)).toBe("Up 20 from the 30 days before");
    // A quieter stretch is stated plainly, not as a failure.
    expect(describeChange({ current: 5, previous: 8, change: -3 }, base)).toBe("Down 3 from the 30 days before");
    expect(describeChange({ current: 5, previous: 5, change: 0 }, base)).toBe("Same as the 30 days before");
    expect(describeChange({ current: 5, previous: 0, change: 5 }, { ...base, hasPrevious: false })).toBe(
      en.insights.noPrevious,
    );
    expect(describeChange({ current: 0.8, previous: null, change: null }, base)).toBe(en.insights.noPrevious);
  });

  it("treats a rate that moved under half a point as unchanged", () => {
    const pct = (r: number) => formatPercent(r, "en");
    expect(describeChange({ current: 0.801, previous: 0.8, change: 0.001 }, { ...base, show: pct, rate: true })).toBe(
      "Same as the 30 days before",
    );
    expect(describeChange({ current: 0.85, previous: 0.8, change: 0.05 }, { ...base, show: pct, rate: true })).toBe(
      "Up 5% from the 30 days before",
    );
  });

  it("maps periods to dictionary keys", () => {
    expect([periodKey("7d"), periodKey("30d"), periodKey("90d")]).toEqual(["d7", "d30", "d90"]);
  });
});
