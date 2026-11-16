import { describe, expect, it } from "vitest";
import { shiftDay } from "./days";
import {
  BEST_TIME_MIN_SESSIONS,
  activityBuckets,
  buildInsights,
  focusRhythm,
  hourInZone,
  insightsCsv,
  insightsCsvFilename,
  isStudyDay,
  parsePeriod,
  periodWindows,
  timeOfDay,
  type FocusStart,
  type InsightsInput,
  type StudyDayInput,
} from "./insights";

const TODAY = "2026-11-13";

function study(localDate: string, o: Partial<StudyDayInput> = {}): StudyDayInput {
  return {
    localDate,
    reviews: 0,
    practice: 0,
    newCards: 0,
    reviewTotal: 0,
    reviewPassed: 0,
    quizAnswers: 0,
    quizCorrect: 0,
    ...o,
  };
}

function input(o: Partial<InsightsInput> = {}): InsightsInput {
  return {
    period: "7d",
    today: TODAY,
    timeZone: "UTC",
    studyDays: [],
    focusDays: [],
    courseStudy: [],
    courseFocus: [],
    courses: [],
    focusStarts: [],
    streakDays: [],
    ...o,
  };
}

/** `n` consecutive days ending `last`. */
function run(last: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftDay(last, -(n - 1 - i)));
}

describe("parsePeriod and periodWindows", () => {
  it("reads 7, 30 and 90 days and defaults to 7", () => {
    expect(parsePeriod("30d")).toBe("30d");
    expect(parsePeriod(["90d", "7d"])).toBe("90d");
    for (const bad of [undefined, null, "", "1y", "7", 7, ["x"]]) expect(parsePeriod(bad)).toBe("7d");
  });

  it("ends the period today and puts the previous one right before it, same length", () => {
    expect(periodWindows("7d", TODAY)).toEqual({
      current: { from: "2026-11-07", to: TODAY, days: 7 },
      previous: { from: "2026-10-31", to: "2026-11-06", days: 7 },
    });
    // Calendar arithmetic: the DST change on 1 November (US) or 25 October (EU) moves nothing.
    const w = periodWindows("90d", TODAY);
    expect(w.current.from).toBe("2026-08-16");
    expect(w.previous).toEqual({ from: "2026-05-18", to: "2026-08-15", days: 90 });
  });
});

describe("buildInsights", () => {
  it("handles a brand-new student with no data at all", () => {
    const r = buildInsights(input());
    expect(r.perDay).toHaveLength(7);
    expect(r.perDay.every((d) => !d.active && d.focusMinutes === 0)).toBe(true);
    expect(r.totals).toMatchObject({ focusMinutes: 0, activeDays: 0, cards: 0, recallRate: null, quizAccuracy: null });
    expect(r.comparison.hasPrevious).toBe(false);
    expect(r.comparison.recallRate.change).toBeNull();
    expect(r.courses).toEqual([]);
    expect(r.rhythm).toMatchObject({ sessions: 0, best: null });
    expect(r.streak.current).toBe(0);
    expect(r.everStudied).toBe(false);
  });

  it("adds up the period and counts a day active for any review, practice, quiz answer or focus", () => {
    const r = buildInsights(
      input({
        studyDays: [
          study("2026-11-08", { reviews: 20, newCards: 5, reviewTotal: 10, reviewPassed: 8 }),
          study("2026-11-09", { practice: 6 }),
          study("2026-11-10", { quizAnswers: 4, quizCorrect: 3 }),
          // A row with nothing in it is not activity.
          study("2026-11-11"),
        ],
        focusDays: [
          { localDate: "2026-11-12", seconds: 25 * 60, sessions: 1 },
          { localDate: TODAY, seconds: 90, sessions: 1 },
        ],
      }),
    );
    expect(r.perDay.map((d) => d.active)).toEqual([false, true, true, true, false, true, true]);
    expect(r.totals).toMatchObject({
      activeDays: 5,
      cards: 26,
      newCards: 5,
      focusSessions: 2,
      // 1500 s + 90 s = 26.5 min: rounded on the total, not per day.
      focusMinutes: 27,
      recallRate: 0.8,
      quizAccuracy: 0.75,
    });
    expect(r.perDay.at(-1)).toMatchObject({ date: TODAY, focusMinutes: 2, focusSessions: 1 });
  });

  it("never divides by zero and never reports more right than asked", () => {
    const r = buildInsights(
      input({
        studyDays: [
          study("2026-11-10", { reviews: 5, reviewTotal: 0, reviewPassed: 0, quizAnswers: 0, quizCorrect: 0 }),
          study("2026-11-11", { quizAnswers: 2, quizCorrect: 9, reviewTotal: 3, reviewPassed: 7 }),
        ],
      }),
    );
    expect(r.totals.quizAccuracy).toBe(1);
    expect(r.totals.recallRate).toBe(1);
    const none = buildInsights(input({ studyDays: [study("2026-11-10", { reviews: 5 })] }));
    expect(none.totals.recallRate).toBeNull();
    expect(none.totals.quizAccuracy).toBeNull();
  });

  it("ignores rows outside both periods, malformed days and bad numbers", () => {
    const r = buildInsights(
      input({
        studyDays: [
          study("2026-10-01", { reviews: 100 }),
          study("2026-11-14", { reviews: 100 }),
          study("not-a-day", { reviews: 100 }),
          study("2026-11-12", { reviews: Number.NaN, practice: -4, quizAnswers: Infinity }),
        ],
        focusDays: [{ localDate: "2026-11-12", seconds: -60, sessions: 1 }],
      }),
    );
    expect(r.totals.cards).toBe(0);
    expect(r.totals.activeDays).toBe(0);
    expect(r.previousTotals.cards).toBe(0);
  });

  it("compares with the period before, and says when there is nothing to compare with", () => {
    const r = buildInsights(
      input({
        studyDays: [
          study("2026-11-10", { reviews: 30, reviewTotal: 10, reviewPassed: 9 }),
          study("2026-11-02", { reviews: 10, reviewTotal: 10, reviewPassed: 6 }),
          study("2026-11-03", { reviews: 5 }),
        ],
        focusDays: [
          { localDate: "2026-11-12", seconds: 50 * 60, sessions: 2 },
          { localDate: "2026-11-01", seconds: 30 * 60, sessions: 1 },
        ],
      }),
    );
    expect(r.comparison.hasPrevious).toBe(true);
    expect(r.comparison.focusMinutes).toEqual({ current: 50, previous: 30, change: 20 });
    expect(r.comparison.activeDays).toEqual({ current: 2, previous: 3, change: -1 });
    expect(r.comparison.cards).toEqual({ current: 30, previous: 15, change: 15 });
    expect(r.comparison.recallRate.change).toBeCloseTo(0.3);
    // No quizzes on either side: no rate to compare.
    expect(r.comparison.quizAccuracy).toEqual({ current: null, previous: null, change: null });

    const fresh = buildInsights(input({ studyDays: [study("2026-11-10", { reviews: 3 })] }));
    expect(fresh.comparison.hasPrevious).toBe(false);
    expect(fresh.comparison.cards).toEqual({ current: 3, previous: 0, change: 3 });
  });

  it("uses the study hub's streak: forgiving gaps with freezes, ended by an uncovered gap", () => {
    // A week earns a freeze, so one missed day (Nov 6) keeps the streak.
    const covered = buildInsights(input({ streakDays: [...run("2026-11-05", 8), ...run(TODAY, 7)] }));
    expect(covered.streak.current).toBe(15);
    expect(covered.streak.longest).toBe(15);
    expect(covered.streak.frozenDays).toEqual(["2026-11-06"]);

    // Too short to earn a freeze: a two-day gap ends it, the best is kept.
    const ended = buildInsights(input({ streakDays: [...run("2026-11-08", 4), ...run("2026-11-12", 2)] }));
    expect(ended.streak.current).toBe(2);
    expect(ended.streak.longest).toBe(4);
    // Nothing yet today: today is not over, so it still counts from yesterday.
    expect(ended.streak.studiedToday).toBe(false);
    expect(ended.everStudied).toBe(true);
  });

  it("counts a study day like the study hub (reviews, practice or quiz; focus alone is not one)", () => {
    expect(isStudyDay({ reviews: 1 })).toBe(true);
    expect(isStudyDay({ practice: 2 })).toBe(true);
    expect(isStudyDay({ quizAnswers: 1 })).toBe(true);
    expect(isStudyDay({ reviews: 0, practice: 0, quizAnswers: 0 })).toBe(false);
    expect(isStudyDay({})).toBe(false);
  });

  it("groups per course, puts trashed courses and focus without a course under Other, and sorts by time", () => {
    const r = buildInsights(
      input({
        studyDays: [study("2026-11-10", { reviews: 1 })],
        courses: [
          { id: "bio", name: "Biology", icon: "🧬" },
          { id: "math", name: "Calculus", icon: null },
          { id: "art", name: "Art history", icon: "🎨" },
          { id: "idle", name: "Nothing yet", icon: null },
        ],
        courseStudy: [
          { workspaceId: "bio", reviews: 10, practice: 2, quizAnswers: 4, quizCorrect: 3 },
          { workspaceId: "math", reviews: 40, practice: 0, quizAnswers: 0, quizCorrect: 0 },
          { workspaceId: "art", reviews: 0, practice: 0, quizAnswers: 5, quizCorrect: 5 },
          { workspaceId: "trashed", reviews: 7, practice: 0, quizAnswers: 2, quizCorrect: 1 },
          { workspaceId: "idle", reviews: 0, practice: 0, quizAnswers: 0, quizCorrect: 0 },
        ],
        courseFocus: [
          { workspaceId: "bio", seconds: 30 * 60 },
          { workspaceId: "math", seconds: 60 * 60 },
          { workspaceId: null, seconds: 100 * 60 },
          { workspaceId: "trashed", seconds: 20 * 60 },
        ],
        focusDays: [{ localDate: "2026-11-10", seconds: 210 * 60, sessions: 4 }],
      }),
    );
    expect(r.courses.map((c) => c.id)).toEqual(["math", "bio", "art", null]);
    expect(r.courses[0]).toMatchObject({ name: "Calculus", focusMinutes: 60, cards: 40, quizAccuracy: null });
    expect(r.courses[1]).toMatchObject({ name: "Biology", icon: "🧬", focusMinutes: 30, cards: 12, quizAccuracy: 0.75 });
    expect(r.courses[2]).toMatchObject({ name: "Art history", focusMinutes: 0, quizAccuracy: 1 });
    // Other: focus about nothing (100 min) plus the trashed course (20 min, 7 cards, 1 of 2).
    expect(r.courses[3]).toMatchObject({ name: null, focusMinutes: 120, cards: 7, quizAnswers: 2, quizAccuracy: 0.5 });
    expect(r.courses[3].focusShare).toBeCloseTo(120 / 210);
    expect(r.courses[0].focusShare).toBeCloseTo(60 / 210);
  });
});

describe("time of day", () => {
  it("splits the day into morning, afternoon, evening and night", () => {
    expect([4, 5, 11, 12, 16, 17, 21, 22, 0].map(timeOfDay)).toEqual([
      "night",
      "morning",
      "morning",
      "afternoon",
      "afternoon",
      "evening",
      "evening",
      "night",
      "night",
    ]);
  });

  it("reads the hour in the student's zone, with the offset of that very day (DST)", () => {
    // 14:00 UTC in November is 09:00 in New York (EST, UTC-5).
    expect(hourInZone(new Date("2026-11-13T14:00:00Z"), "America/New_York")).toBe(9);
    // 16:30 UTC on 8 March 2026, the day DST starts, is 12:30 EDT (UTC-4), not 11:30.
    expect(hourInZone(new Date("2026-03-08T16:30:00Z"), "America/New_York")).toBe(12);
    // A day ahead of UTC: 13:30 UTC is 22:30 in Tokyo.
    expect(hourInZone(new Date("2026-11-13T13:30:00Z"), "Asia/Tokyo")).toBe(22);
    // Midnight reads as 0, never 24.
    expect(hourInZone(new Date("2026-11-13T05:00:00Z"), "America/New_York")).toBe(0);
    expect(hourInZone(new Date("2026-11-13T14:00:00Z"), "Not/AZone")).toBe(14);
    expect(hourInZone(new Date("nope"), "UTC")).toBeNull();
  });

  it("names the best time only from enough sessions, in the student's zone", () => {
    const at = (iso: string, minutes = 25): FocusStart => ({ startedAt: new Date(iso), seconds: minutes * 60 });
    // Evenings in Berlin (CET, UTC+1): 18:00–20:00 UTC is 19:00–21:00 local.
    const evenings = [
      at("2026-11-09T18:00:00Z"),
      at("2026-11-10T19:00:00Z"),
      at("2026-11-11T18:30:00Z"),
      at("2026-11-12T08:00:00Z", 10),
    ];
    const few = focusRhythm(evenings, "Europe/Berlin");
    expect(few.sessions).toBe(BEST_TIME_MIN_SESSIONS - 1);
    expect(few.best).toBeNull();
    expect(few.parts).toEqual({ morning: 10, afternoon: 0, evening: 75, night: 0 });
    // 18:00Z and 18:30Z both start in Berlin's 19:00 hour.
    expect(few.hours[19]).toBe(50);
    expect(few.hours[20]).toBe(25);
    expect(few.hours[9]).toBe(10);

    const enough = focusRhythm([...evenings, at("2026-11-13T20:00:00Z")], "Europe/Berlin");
    expect(enough.sessions).toBe(BEST_TIME_MIN_SESSIONS);
    expect(enough.best).toBe("evening");
    // The very same instants read in Tokyo (UTC+9) fall in the small hours.
    expect(focusRhythm([...evenings, at("2026-11-13T20:00:00Z")], "Asia/Tokyo").best).toBe("night");
  });

  it("names nothing on a tie or without focus time", () => {
    const at = (iso: string): FocusStart => ({ startedAt: new Date(iso), seconds: 1200 });
    const tie = focusRhythm(
      [at("2026-11-09T08:00:00Z"), at("2026-11-10T08:00:00Z"), at("2026-11-11T14:00:00Z"), at("2026-11-12T14:00:00Z"), at("2026-11-13T02:00:00Z"), at("2026-11-13T03:00:00Z")],
      "UTC",
    );
    expect(tie.sessions).toBe(6);
    expect(tie.best).toBeNull();
    const broken = focusRhythm([{ startedAt: new Date("nope"), seconds: 600 }, { startedAt: new Date(), seconds: 0 }], "UTC");
    expect(broken.sessions).toBe(0);
  });
});

describe("activityBuckets", () => {
  it("is one column per day for 7 and 30 days", () => {
    const r = buildInsights(input({ period: "30d", focusDays: [{ localDate: TODAY, seconds: 600, sessions: 1 }] }));
    const buckets = activityBuckets(r.perDay, "30d");
    expect(buckets).toHaveLength(30);
    expect(buckets.at(-1)).toEqual({ from: TODAY, to: TODAY, focusMinutes: 10, cards: 0 });
  });

  it("is one column per week for 90 days, the last one ending today", () => {
    const r = buildInsights(
      input({
        period: "90d",
        studyDays: [study("2026-11-07", { reviews: 4 }), study(TODAY, { practice: 3 }), study("2026-08-16", { reviews: 2 })],
        focusDays: [
          { localDate: "2026-11-08", seconds: 30, sessions: 1 },
          { localDate: "2026-11-09", seconds: 45, sessions: 1 },
        ],
      }),
    );
    const buckets = activityBuckets(r.perDay, "90d");
    expect(buckets).toHaveLength(13);
    expect(buckets.at(-1)).toEqual({ from: "2026-11-07", to: TODAY, focusMinutes: 1, cards: 7 });
    // 90 = 12 full weeks + 6 days: the first column is the short one.
    expect(buckets[0]).toEqual({ from: "2026-08-16", to: "2026-08-21", focusMinutes: 0, cards: 2 });
  });
});

describe("insightsCsv", () => {
  const labels = {
    date: "Date",
    focusMinutes: "Focus minutes",
    focusSessions: "Focus sessions",
    cards: "Cards reviewed",
    newCards: "New cards",
    recallRate: "Recall rate (%)",
    quizAnswers: "Quiz answers",
    quizCorrect: "Quiz answers right",
  };

  it("writes one plain row per day of the period, with a header", () => {
    const r = buildInsights(
      input({
        studyDays: [study("2026-11-12", { reviews: 12, newCards: 3, reviewTotal: 7, reviewPassed: 6, quizAnswers: 4, quizCorrect: 3 })],
        focusDays: [{ localDate: "2026-11-12", seconds: 1520, sessions: 2 }],
      }),
    );
    const csv = insightsCsv(r.perDay, labels);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(9); // header, 7 days, final line break
    expect(lines[0]).toBe("Date,Focus minutes,Focus sessions,Cards reviewed,New cards,Recall rate (%),Quiz answers,Quiz answers right");
    expect(lines[1]).toBe("2026-11-07,0,0,0,0,,0,0");
    expect(lines[6]).toBe("2026-11-12,25,2,12,3,85.7,4,3");
    expect(lines[7]).toBe("2026-11-13,0,0,0,0,,0,0");
    expect(lines[8]).toBe("");
  });

  it("quotes headers that need it", () => {
    const csv = insightsCsv([], { ...labels, date: "Day, local", cards: 'Cards "seen"', quizCorrect: "Right; total" });
    expect(csv.slice(1).split("\r\n")[0]).toBe(
      '"Day, local",Focus minutes,Focus sessions,"Cards ""seen""",New cards,Recall rate (%),Quiz answers,"Right; total"',
    );
  });

  it("names the file after the period and the day", () => {
    expect(insightsCsvFilename("30d", TODAY)).toBe("studyos-insights-30d-2026-11-13.csv");
    expect(insightsCsvFilename("7d", "../../x")).toBe("studyos-insights-7d-export.csv");
  });
});
