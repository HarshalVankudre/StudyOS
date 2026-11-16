import { describe, expect, it } from "vitest";
import {
  FOCUS_CLOCK_SKEW_MS,
  FOCUS_LABEL_MAX,
  FOCUS_MAX_AGE_MS,
  FOCUS_MAX_SECONDS,
  cleanFocusLabel,
  emptyFocusSummary,
  focusStreak,
  plausibleStart,
  storableSeconds,
  summarizeFocus,
} from "./focus";

const NOW = Date.parse("2026-11-13T12:00:00Z");

describe("plausibleStart", () => {
  it("accepts the last day, with a little clock skew into the future", () => {
    expect(plausibleStart(NOW - 25 * 60_000, NOW)).toBe(true);
    expect(plausibleStart(NOW - FOCUS_MAX_AGE_MS, NOW)).toBe(true);
    expect(plausibleStart(NOW + FOCUS_CLOCK_SKEW_MS, NOW)).toBe(true);
  });

  it("refuses older starts, starts in the future and nonsense", () => {
    expect(plausibleStart(NOW - FOCUS_MAX_AGE_MS - 1, NOW)).toBe(false);
    expect(plausibleStart(NOW + FOCUS_CLOCK_SKEW_MS + 1, NOW)).toBe(false);
    expect(plausibleStart(Number.NaN, NOW)).toBe(false);
  });
});

describe("storableSeconds", () => {
  const started = NOW - 30 * 60_000;

  it("keeps whole seconds of a normal session", () => {
    expect(storableSeconds(1500.7, started, NOW)).toBe(1500);
  });

  it("does not store sessions under a minute", () => {
    expect(storableSeconds(59, started, NOW)).toBeNull();
    expect(storableSeconds(60, started, NOW)).toBe(60);
    expect(storableSeconds(Number.NaN, started, NOW)).toBeNull();
  });

  it("cuts to three hours, and to the time that really passed (plus skew)", () => {
    expect(storableSeconds(10 * 3600, NOW - 20 * 3600_000, NOW)).toBe(FOCUS_MAX_SECONDS);
    // Started 30 minutes ago: at most 30 minutes (+ the skew allowance).
    expect(storableSeconds(3 * 3600, started, NOW)).toBe(30 * 60 + FOCUS_CLOCK_SKEW_MS / 1000);
    // Started "just now": nothing to keep.
    expect(storableSeconds(1500, NOW + FOCUS_CLOCK_SKEW_MS, NOW)).toBeNull();
  });
});

describe("cleanFocusLabel", () => {
  it("flattens whitespace and control characters, and empties to null", () => {
    expect(cleanFocusLabel("  Chapter\n4\treading \u0000 ")).toBe("Chapter 4 reading");
    expect(cleanFocusLabel("   ")).toBeNull();
    expect(cleanFocusLabel(undefined)).toBeNull();
  });

  it("cuts to the limit without splitting a character", () => {
    const long = "😀".repeat(FOCUS_LABEL_MAX + 10);
    const cut = cleanFocusLabel(long)!;
    expect(Array.from(cut)).toHaveLength(FOCUS_LABEL_MAX);
    expect(cut.isWellFormed()).toBe(true);
  });
});

describe("focusStreak", () => {
  it("counts days in a row back from today", () => {
    expect(focusStreak(["2026-11-11", "2026-11-12", "2026-11-13"], "2026-11-13")).toBe(3);
  });

  it("keeps yesterday's streak while today is not over", () => {
    expect(focusStreak(["2026-11-11", "2026-11-12"], "2026-11-13")).toBe(2);
  });

  it("ends at a missed day", () => {
    expect(focusStreak(["2026-11-10", "2026-11-12", "2026-11-13"], "2026-11-13")).toBe(2);
    expect(focusStreak(["2026-11-10", "2026-11-11"], "2026-11-13")).toBe(0);
    expect(focusStreak([], "2026-11-13")).toBe(0);
  });

  it("runs across month and year ends (calendar days, not 24-hour steps)", () => {
    expect(focusStreak(["2026-12-30", "2026-12-31", "2027-01-01"], "2027-01-01")).toBe(3);
    // The day clocks change (Europe, 2026-10-25) is still one day.
    expect(focusStreak(["2026-10-24", "2026-10-25", "2026-10-26"], "2026-10-26")).toBe(3);
  });
});

describe("summarizeFocus", () => {
  it("adds sessions up per local day: today, the last 7 days and the streak", () => {
    const summary = summarizeFocus(
      [
        { localDate: "2026-11-13", seconds: 1500 },
        { localDate: "2026-11-13", seconds: 600 },
        { localDate: "2026-11-12", seconds: 3000 },
        { localDate: "2026-11-07", seconds: 900 },
        // Older than the week: counts for nothing shown but the streak.
        { localDate: "2026-11-06", seconds: 900 },
      ],
      "2026-11-13",
    );
    expect(summary.today).toBe("2026-11-13");
    expect(summary.todayMinutes).toBe(35);
    expect(summary.week.map((d) => d.date)).toEqual([
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
    ]);
    expect(summary.week.map((d) => d.minutes)).toEqual([15, 0, 0, 0, 0, 50, 35]);
    expect(summary.weekMinutes).toBe(100);
    expect(summary.streak).toBe(2);
  });

  it("rounds minutes from the day's total seconds", () => {
    const summary = summarizeFocus(
      [
        { localDate: "2026-11-13", seconds: 89 },
        { localDate: "2026-11-13", seconds: 61 },
      ],
      "2026-11-13",
    );
    // 150 s is 2.5 min: rounded once from the total, not per session.
    expect(summary.todayMinutes).toBe(3);
  });

  it("ignores days after today, malformed days and empty rows", () => {
    const summary = summarizeFocus(
      [
        { localDate: "2026-11-14", seconds: 1500 },
        { localDate: "yesterday", seconds: 1500 },
        { localDate: "2026-11-12", seconds: 0 },
        { localDate: "2026-11-12", seconds: Number.NaN },
      ],
      "2026-11-13",
    );
    expect(summary).toEqual(emptyFocusSummary("2026-11-13"));
    expect(summary.streak).toBe(0);
    expect(summary.week).toHaveLength(7);
  });

  it("follows the student's calendar across a month end", () => {
    const summary = summarizeFocus([{ localDate: "2026-10-31", seconds: 600 }], "2026-11-02");
    expect(summary.week[4]).toEqual({ date: "2026-10-31", minutes: 10 });
    expect(summary.streak).toBe(0);
  });
});
