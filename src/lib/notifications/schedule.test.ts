import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, fromRow, mergePreferences, minuteToTime, normalizeLeads, preferencesInputSchema, timeToMinute, toRow } from "./preferences";
import {
  GRACE_MS,
  STREAK_MINUTE,
  afterQuietHours,
  dueSlots,
  inQuietHours,
  localClock,
  nextSlotAfter,
  safeTimeZone,
  slotsForDay,
  weekdayOf,
  zonedInstant,
  type ScheduleSettings,
} from "./schedule";

const settings = (overrides: Partial<ScheduleSettings> = {}): ScheduleSettings => ({
  ...DEFAULT_PREFERENCES,
  ...overrides,
});
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("zonedInstant: a local wall time on a local day", () => {
  it("handles zones on both sides of UTC, and half- and quarter-hour offsets", () => {
    expect(iso(zonedInstant("2026-11-12", 8 * 60, "UTC"))).toBe("2026-11-12T08:00:00.000Z");
    expect(iso(zonedInstant("2026-11-12", 8 * 60, "America/Los_Angeles"))).toBe("2026-11-12T16:00:00.000Z");
    expect(iso(zonedInstant("2026-11-12", 8 * 60, "Asia/Kolkata"))).toBe("2026-11-12T02:30:00.000Z");
    expect(iso(zonedInstant("2026-11-12", 8 * 60, "Asia/Kathmandu"))).toBe("2026-11-12T02:15:00.000Z");
    // Kiritimati is UTC+14: 08:00 there is still the previous UTC day.
    expect(iso(zonedInstant("2026-11-12", 8 * 60, "Pacific/Kiritimati"))).toBe("2026-11-11T18:00:00.000Z");
  });

  it("follows daylight saving: the same 08:00 is a different UTC hour across a change", () => {
    // New York: EDT (UTC-4) until 1 Nov 2026, EST (UTC-5) after.
    expect(iso(zonedInstant("2026-10-31", 8 * 60, "America/New_York"))).toBe("2026-10-31T12:00:00.000Z");
    expect(iso(zonedInstant("2026-11-01", 8 * 60, "America/New_York"))).toBe("2026-11-01T13:00:00.000Z");
    // Berlin: CET (UTC+1) until 29 Mar 2026, CEST (UTC+2) after.
    expect(iso(zonedInstant("2026-03-28", 8 * 60, "Europe/Berlin"))).toBe("2026-03-28T07:00:00.000Z");
    expect(iso(zonedInstant("2026-03-29", 8 * 60, "Europe/Berlin"))).toBe("2026-03-29T06:00:00.000Z");
    // Southern hemisphere: Sydney starts DST on 4 Oct 2026 (UTC+10 -> +11).
    expect(iso(zonedInstant("2026-10-03", 8 * 60, "Australia/Sydney"))).toBe("2026-10-02T22:00:00.000Z");
    expect(iso(zonedInstant("2026-10-04", 8 * 60, "Australia/Sydney"))).toBe("2026-10-03T21:00:00.000Z");
  });

  it("moves a time that does not exist (spring forward) past the gap", () => {
    // 02:30 never happens in New York on 8 Mar 2026 (02:00 -> 03:00): 03:30 EDT.
    const t = zonedInstant("2026-03-08", 2 * 60 + 30, "America/New_York");
    expect(iso(t)).toBe("2026-03-08T07:30:00.000Z");
    expect(localClock(t, "America/New_York")).toEqual({ date: "2026-03-08", minute: 3 * 60 + 30 });
    // Berlin 29 Mar 2026, 02:30 -> 03:30 CEST.
    expect(localClock(zonedInstant("2026-03-29", 150, "Europe/Berlin"), "Europe/Berlin").minute).toBe(210);
  });

  it("uses the first of a time that happens twice (fall back)", () => {
    // 01:30 happens twice in New York on 1 Nov 2026: first in EDT.
    expect(iso(zonedInstant("2026-11-01", 90, "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
    // Lord Howe Island shifts by only 30 minutes (05 Apr 2026, 02:00 -> 01:30).
    expect(iso(zonedInstant("2026-04-05", 105, "Australia/Lord_Howe"))).toBe("2026-04-04T14:45:00.000Z");
  });

  it("round-trips every quarter hour of a DST-change day", () => {
    for (const zone of ["America/New_York", "Europe/London", "Australia/Sydney"]) {
      for (const day of ["2026-03-08", "2026-03-29", "2026-10-04", "2026-10-25", "2026-11-01"]) {
        for (let minute = 0; minute < 1440; minute += 15) {
          const local = localClock(zonedInstant(day, minute, zone), zone);
          // Either exactly that wall time, or (inside a gap) up to an hour later the same day.
          expect(local.date).toBe(day);
          expect(local.minute - minute).toBeGreaterThanOrEqual(0);
          expect(local.minute - minute).toBeLessThanOrEqual(60);
        }
      }
    }
  });

  it("treats an unknown zone as UTC", () => {
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(safeTimeZone("")).toBe("UTC");
    expect(safeTimeZone("Europe/Paris")).toBe("Europe/Paris");
  });
});

describe("quiet hours", () => {
  const quiet = { quietEnabled: true, quietStart: 22 * 60, quietEnd: 7 * 60 };

  it("wraps around midnight", () => {
    expect(inQuietHours(23 * 60, quiet)).toBe(true);
    expect(inQuietHours(3 * 60, quiet)).toBe(true);
    expect(inQuietHours(7 * 60, quiet)).toBe(false);
    expect(inQuietHours(21 * 60 + 59, quiet)).toBe(false);
    expect(inQuietHours(23 * 60, { ...quiet, quietEnabled: false })).toBe(false);
  });

  it("works for a daytime window too", () => {
    const lectures = { quietEnabled: true, quietStart: 9 * 60, quietEnd: 12 * 60 };
    expect(inQuietHours(10 * 60, lectures)).toBe(true);
    expect(inQuietHours(8 * 60, lectures)).toBe(false);
  });

  it("delays a moment to the end of quiet hours the same day, or skips it", () => {
    expect(afterQuietHours(6 * 60, quiet, true)).toBe(7 * 60);
    expect(afterQuietHours(23 * 60, quiet, true)).toBeNull(); // the end is tomorrow
    expect(afterQuietHours(20 * 60, quiet, true)).toBe(20 * 60);
    expect(afterQuietHours(6 * 60, quiet, false)).toBeNull();
  });
});

describe("slots: when each kind is due", () => {
  it("lists the day's moments in time order, in the student's zone", () => {
    const slots = slotsForDay("2026-11-12", settings({ timeZone: "Europe/Berlin" }));
    expect(slots.map((s) => [s.kind, iso(s.at)])).toEqual([
      ["daily", "2026-11-12T07:00:00.000Z"],
      ["deadline", "2026-11-12T17:00:00.000Z"],
      ["streak", "2026-11-12T19:00:00.000Z"],
    ]);
  });

  it("leaves out kinds that are switched off, and the streak inside quiet hours", () => {
    const slots = slotsForDay(
      "2026-11-12",
      settings({ dailyEnabled: false, quietStart: 19 * 60, quietEnd: 7 * 60 }),
    );
    expect(slots.map((s) => s.kind)).toEqual(["deadline"]);
    expect(STREAK_MINUTE).toBe(20 * 60);
  });

  it("moves a daily time inside quiet hours to their end", () => {
    const slots = slotsForDay("2026-11-12", settings({ dailyMinute: 6 * 60 }));
    expect(iso(slots[0].at)).toBe("2026-11-12T07:00:00.000Z");
  });

  it("is due from its moment for the grace period, then no longer", () => {
    const s = settings({ timeZone: "America/New_York" }); // daily 08:00 = 13:00Z in November
    expect(dueSlots(s, new Date("2026-11-12T12:59:00Z"))).toEqual([]);
    expect(dueSlots(s, new Date("2026-11-12T13:00:00Z")).map((x) => x.kind)).toEqual(["daily"]);
    expect(dueSlots(s, new Date(Date.parse("2026-11-12T13:00:00Z") + GRACE_MS)).map((x) => x.kind)).toEqual(["daily"]);
    expect(dueSlots(s, new Date(Date.parse("2026-11-12T13:00:00Z") + GRACE_MS + 1000))).toEqual([]);
  });

  it("never sends yesterday's moment after local midnight", () => {
    const s = settings({ timeZone: "UTC", quietEnabled: false, dailyMinute: 23 * 60 + 50, deadlineEnabled: false, streakEnabled: false });
    expect(dueSlots(s, new Date("2026-11-13T00:10:00Z"))).toEqual([]);
  });

  it("finds the next moment, across midnight and a DST change", () => {
    const s = settings({ timeZone: "America/New_York", deadlineEnabled: false, streakEnabled: false });
    // Evening of 31 Oct (EDT): next is 08:00 EST on 1 Nov = 13:00Z.
    expect(iso(nextSlotAfter(s, new Date("2026-11-01T01:00:00Z")))).toBe("2026-11-01T13:00:00.000Z");
    expect(iso(nextSlotAfter(s, new Date("2026-11-01T13:00:00Z")))).toBe("2026-11-02T13:00:00.000Z");
    expect(nextSlotAfter(settings({ dailyEnabled: false, deadlineEnabled: false, streakEnabled: false }), new Date())).toBeNull();
  });
});

describe("preferences", () => {
  it("keeps only offered lead times, longest first, without repeats", () => {
    expect(normalizeLeads([1, 7, 7, 4, 2, 30])).toEqual([7, 2, 1]);
  });

  it("defaults to a week, two days and the evening before; exams start two weeks out", () => {
    expect(DEFAULT_PREFERENCES.deadlineLeads).toEqual([7, 2, 1]);
    expect(DEFAULT_PREFERENCES.examLeads[0]).toBeGreaterThan(DEFAULT_PREFERENCES.deadlineLeads[0]);
    expect(DEFAULT_PREFERENCES.deadlineMinute).toBeGreaterThanOrEqual(17 * 60);
  });

  it("validates a partial update and round-trips through the stored row", () => {
    const parsed = preferencesInputSchema.parse({ dailyMinute: 450, examLeads: [3, 14], timeZone: "Asia/Tokyo", locale: "ja" });
    const next = mergePreferences(DEFAULT_PREFERENCES, parsed);
    expect(next).toMatchObject({ dailyMinute: 450, examLeads: [14, 3], timeZone: "Asia/Tokyo", locale: "ja" });
    expect(fromRow(toRow(next))).toEqual(next);
    expect(preferencesInputSchema.safeParse({ dailyMinute: 1440 }).success).toBe(false);
    expect(preferencesInputSchema.safeParse({ somethingElse: true }).success).toBe(false);
  });

  it("reads damaged rows tolerantly", () => {
    const row = { ...toRow(DEFAULT_PREFERENCES), deadlineLeads: "not json", timeZone: "Nowhere/Land", locale: "xx", dailyMinute: 99999 };
    expect(fromRow(row)).toMatchObject({ deadlineLeads: [7, 2, 1], timeZone: "UTC", locale: "en", dailyMinute: 480 });
  });

  it("converts times for the time inputs", () => {
    expect(minuteToTime(7 * 60 + 5)).toBe("07:05");
    expect(timeToMinute("18:30")).toBe(1110);
    expect(timeToMinute("25:00")).toBeNull();
  });
});

describe("weekly recap: once a week, on the chosen local day and time", () => {
  /** Only the recap on, so each test sees its slot alone. */
  const weekly = (overrides: Partial<ScheduleSettings> = {}) =>
    settings({
      dailyEnabled: false,
      deadlineEnabled: false,
      streakEnabled: false,
      weeklyEnabled: true,
      ...overrides,
    });
  // 15 November 2026 is a Sunday.
  const SUNDAY = "2026-11-15";

  it("reads the weekday from the local day itself", () => {
    expect(weekdayOf(SUNDAY)).toBe(0);
    expect(weekdayOf("2026-11-16")).toBe(1);
    expect(weekdayOf("2026-11-12")).toBe(4);
    expect(weekdayOf("2024-02-29")).toBe(4);
    expect(weekdayOf("2026-11-21")).toBe(6);
  });

  it("is off by default, Sunday at 18:00 once turned on", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ weeklyEnabled: false, weeklyDay: 0, weeklyMinute: 18 * 60 });
    // Existing students keep exactly the moments they had.
    expect(slotsForDay(SUNDAY, settings()).map((s) => s.kind)).toEqual(["daily", "deadline", "streak"]);
    const slots = slotsForDay(SUNDAY, weekly({ timeZone: "Europe/Berlin" }));
    expect(slots.map((s) => [s.kind, s.localDate, iso(s.at)])).toEqual([["weekly", SUNDAY, "2026-11-15T17:00:00.000Z"]]);
  });

  it("happens only on the chosen weekday", () => {
    const s = weekly({ timeZone: "Europe/Berlin" });
    for (const day of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]) {
      expect(slotsForDay(day, s), day).toEqual([]);
    }
    // A Wednesday at 07:30 in Tokyo: the evening before in UTC.
    const wednesday = weekly({ timeZone: "Asia/Tokyo", weeklyDay: 3, weeklyMinute: 7 * 60 + 30 });
    expect(slotsForDay(SUNDAY, wednesday)).toEqual([]);
    expect(iso(slotsForDay("2026-11-18", wednesday)[0].at)).toBe("2026-11-17T22:30:00.000Z");
  });

  it("follows the student's own week, not the server's: Sunday evening in Los Angeles is Monday in UTC", () => {
    const la = weekly({ timeZone: "America/Los_Angeles" });
    expect(iso(nextSlotAfter(la, new Date("2026-11-15T12:00:00Z")))).toBe("2026-11-16T02:00:00.000Z");
    // Monday 01:00 UTC is still Sunday 17:00 there: not yet.
    expect(dueSlots(la, new Date("2026-11-16T01:00:00Z"))).toEqual([]);
    expect(dueSlots(la, new Date("2026-11-16T02:00:00Z")).map((x) => [x.kind, x.localDate])).toEqual([["weekly", SUNDAY]]);
    // UTC+14: Sunday 18:00 is Sunday 04:00 UTC.
    expect(iso(slotsForDay(SUNDAY, weekly({ timeZone: "Pacific/Kiritimati" }))[0].at)).toBe("2026-11-15T04:00:00.000Z");
  });

  it("keeps the local time across daylight saving changes", () => {
    // New York leaves EDT on Sunday 1 Nov 2026: 18:00 is 22:00Z the Sunday before, 23:00Z on the day.
    const ny = weekly({ timeZone: "America/New_York" });
    expect(iso(slotsForDay("2026-10-25", ny)[0].at)).toBe("2026-10-25T22:00:00.000Z");
    expect(iso(nextSlotAfter(ny, new Date("2026-10-25T22:00:00Z")))).toBe("2026-11-01T23:00:00.000Z");
    // Berlin enters CEST on Sunday 29 Mar 2026.
    const berlin = weekly({ timeZone: "Europe/Berlin" });
    expect(iso(nextSlotAfter(berlin, new Date("2026-03-22T17:00:00Z")))).toBe("2026-03-29T16:00:00.000Z");
    // A recap set inside the skipped hour (02:30 on 8 Mar 2026 in New York) arrives just after it.
    const early = weekly({ timeZone: "America/New_York", weeklyMinute: 2 * 60 + 30, quietEnabled: false });
    expect(iso(slotsForDay("2026-03-08", early)[0].at)).toBe("2026-03-08T07:30:00.000Z");
  });

  it("finds next week's recap once this week's has passed", () => {
    const s = weekly({ timeZone: "Europe/Berlin" });
    expect(iso(nextSlotAfter(s, new Date("2026-11-15T16:59:00Z")))).toBe("2026-11-15T17:00:00.000Z");
    expect(iso(nextSlotAfter(s, new Date("2026-11-15T17:00:00Z")))).toBe("2026-11-22T17:00:00.000Z");
    // With the daily note on too, the next moment is tomorrow morning.
    expect(iso(nextSlotAfter({ ...s, dailyEnabled: true }, new Date("2026-11-15T17:00:00Z")))).toBe("2026-11-16T07:00:00.000Z");
  });

  it("is still sent late the same evening after a missed run, but never after local midnight", () => {
    const s = weekly({ timeZone: "Europe/Berlin", quietEnabled: false });
    // 21:30 in Berlin: three and a half hours late, beyond the usual grace.
    expect(Date.parse("2026-11-15T20:30:00Z") - Date.parse("2026-11-15T17:00:00Z")).toBeGreaterThan(GRACE_MS);
    expect(dueSlots(s, new Date("2026-11-15T20:30:00Z")).map((x) => x.kind)).toEqual(["weekly"]);
    expect(dueSlots(s, new Date("2026-11-15T22:59:00Z")).map((x) => x.kind)).toEqual(["weekly"]);
    // 00:01 on Monday in Berlin.
    expect(dueSlots(s, new Date("2026-11-15T23:01:00Z"))).toEqual([]);
    // The daily note keeps its usual grace period.
    const daily = settings({ timeZone: "Europe/Berlin", quietEnabled: false, deadlineEnabled: false, streakEnabled: false });
    expect(dueSlots(daily, new Date("2026-11-15T10:30:00Z"))).toEqual([]);
  });

  it("follows quiet hours like the other notes: waits for their end, or is skipped", () => {
    const morning = weekly({ timeZone: "UTC", weeklyMinute: 6 * 60 });
    expect(iso(slotsForDay(SUNDAY, morning)[0].at)).toBe("2026-11-15T07:00:00.000Z");
    const late = weekly({ timeZone: "UTC", weeklyMinute: 23 * 60 });
    expect(slotsForDay(SUNDAY, late)).toEqual([]);
    expect(nextSlotAfter(late, new Date("2026-11-12T12:00:00Z"))).toBeNull();
  });
});

describe("weekly recap preferences", () => {
  it("validates the switch, the weekday and the time", () => {
    expect(preferencesInputSchema.parse({ weeklyEnabled: true, weeklyDay: 3, weeklyMinute: 450 })).toEqual({
      weeklyEnabled: true,
      weeklyDay: 3,
      weeklyMinute: 450,
    });
    expect(preferencesInputSchema.safeParse({ weeklyDay: 0 }).success).toBe(true);
    expect(preferencesInputSchema.safeParse({ weeklyDay: 6 }).success).toBe(true);
    for (const bad of [
      { weeklyDay: 7 },
      { weeklyDay: -1 },
      { weeklyDay: 2.5 },
      { weeklyDay: "sunday" },
      { weeklyMinute: 1440 },
      { weeklyMinute: -1 },
      { weeklyEnabled: "yes" },
      { weeklyEnabled: 1 },
    ]) {
      expect(preferencesInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("round-trips through the stored row and reads damaged or older rows as off", () => {
    const next = mergePreferences(DEFAULT_PREFERENCES, preferencesInputSchema.parse({ weeklyEnabled: true, weeklyDay: 5, weeklyMinute: 1200 }));
    expect(fromRow(toRow(next))).toEqual(next);
    const damaged = { ...toRow(next), weeklyDay: 9, weeklyMinute: -5 };
    expect(fromRow(damaged)).toMatchObject({ weeklyEnabled: true, weeklyDay: 0, weeklyMinute: 18 * 60 });
    // A row written before the recap existed has none of its columns.
    const older: Record<string, unknown> = { ...toRow(next) };
    for (const column of ["weeklyEnabled", "weeklyDay", "weeklyMinute"]) delete older[column];
    expect(fromRow(older as unknown as ReturnType<typeof toRow>)).toMatchObject({ weeklyEnabled: false, weeklyDay: 0, weeklyMinute: 1080 });
  });
});
