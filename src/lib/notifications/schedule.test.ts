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
