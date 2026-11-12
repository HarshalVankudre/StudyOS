import { describe, expect, it } from "vitest";
import { FREEZE_EVERY, MAX_FREEZES, computeStreak, streakStatus } from "./streak";
import { dayAtOffset, dayRange, shiftDay } from "./days";

const today = "2026-07-03";
/** `n` consecutive study days ending on `last`. */
function run(last: string, n: number): string[] {
  return dayRange(shiftDay(last, -(n - 1)), last);
}

describe("streakStatus — basic streak", () => {
  it("is zero with no study days", () => {
    expect(streakStatus([], today)).toMatchObject({ current: 0, longest: 0, atRisk: false });
  });

  it("counts consecutive days ending today", () => {
    const s = streakStatus(["2026-07-01", "2026-07-02", "2026-07-03"], today);
    expect(s.current).toBe(3);
    expect(s.studiedToday).toBe(true);
    expect(s.atRisk).toBe(false);
  });

  it("keeps the streak alive if studied yesterday but not yet today, and warns", () => {
    const s = streakStatus(["2026-07-01", "2026-07-02"], today);
    expect(s.current).toBe(2);
    expect(s.studiedToday).toBe(false);
    expect(s.atRisk).toBe(true);
  });

  it("ends a short streak (no freeze earned yet) after a missed day", () => {
    const s = streakStatus(["2026-06-30", "2026-07-01"], today);
    expect(s.current).toBe(0);
    expect(s.longest).toBe(2);
    expect(s.ended).toBeNull(); // too short to make a fuss about
  });

  it("dedupes, ignores order and future days, and crosses month boundaries", () => {
    expect(computeStreak(["2026-07-01", "2026-06-30", "2026-07-01", "2026-07-09"], "2026-07-01")).toBe(2);
  });
});

describe("streakStatus — freezes", () => {
  it(`earns a freeze every ${FREEZE_EVERY} study days, up to ${MAX_FREEZES}`, () => {
    expect(streakStatus(run(today, FREEZE_EVERY - 1), today).freezes).toBe(0);
    expect(streakStatus(run(today, FREEZE_EVERY), today).freezes).toBe(1);
    const long = streakStatus(run(today, FREEZE_EVERY * 5), today);
    expect(long.freezes).toBe(MAX_FREEZES);
    expect(long.towardFreeze).toBe(0);
  });

  it("one missed day does not wipe a week-long streak", () => {
    // Studied 10 days up to 2026-07-01, missed 07-02, studying today.
    const days = [...run("2026-07-01", 10), today];
    const s = streakStatus(days, today);
    expect(s.current).toBe(11); // frozen day bridges, does not count
    expect(s.frozenDays).toEqual(["2026-07-02"]);
    expect(s.freezes).toBe(0); // the one earned freeze was spent
    expect(s.ended).toBeNull();
  });

  it("a freeze covers yesterday even before the student studies today", () => {
    const s = streakStatus(run("2026-07-01", 7), today);
    expect(s.current).toBe(7);
    expect(s.frozenDays).toEqual(["2026-07-02"]);
    expect(s.atRisk).toBe(true); // no freeze left for today
  });

  it("two banked freezes cover two missed days", () => {
    const days = [...run("2026-06-30", 14), today];
    const s = streakStatus(days, today);
    expect(s.frozenDays).toEqual(["2026-07-01", "2026-07-02"]);
    expect(s.current).toBe(15);
  });

  it("ends the streak once freezes run out, and reports it kindly", () => {
    // 8 days (1 freeze), then 2 missed days.
    const s = streakStatus(run("2026-06-30", 8), today);
    expect(s.current).toBe(0);
    expect(s.longest).toBe(8);
    expect(s.ended).toEqual({ length: 8, on: "2026-07-02" });
  });

  it("stops mentioning an ended streak after a week", () => {
    const s = streakStatus(run("2026-06-10", 8), today);
    expect(s.ended).toBeNull();
    expect(s.longest).toBe(8);
  });

  it("is not at risk while a freeze is banked", () => {
    const s = streakStatus(run("2026-07-02", 9), today);
    expect(s.freezes).toBe(1);
    expect(s.atRisk).toBe(false);
  });
});

describe("study days across time zones and day boundaries", () => {
  it("buckets a late-evening review into the student's local day (UTC-7)", () => {
    // 23:30 on July 2 in Los Angeles (PDT, offset +420) is 06:30 UTC July 3.
    const instant = new Date("2026-07-03T06:30:00Z");
    expect(dayAtOffset(instant, 420)).toBe("2026-07-02");
    expect(dayAtOffset(instant, 0)).toBe("2026-07-03");
  });

  it("buckets an early-morning review east of UTC (UTC+9)", () => {
    // 00:30 on July 3 in Tokyo (offset -540) is 15:30 UTC July 2.
    expect(dayAtOffset(new Date("2026-07-02T15:30:00Z"), -540)).toBe("2026-07-03");
  });

  it("evening + next-evening reviews are consecutive local days even across UTC midnight", () => {
    const offset = 420; // UTC-7
    const days = [
      dayAtOffset(new Date("2026-07-02T04:00:00Z"), offset), // Jul 1, 21:00 local
      dayAtOffset(new Date("2026-07-03T05:59:00Z"), offset), // Jul 2, 22:59 local
    ];
    expect(days).toEqual(["2026-07-01", "2026-07-02"]);
    expect(streakStatus(days, dayAtOffset(new Date("2026-07-03T08:00:00Z"), offset)).current).toBe(2);
  });

  it("clamps an absurd client offset to a real time zone", () => {
    expect(dayAtOffset(new Date("2026-07-03T12:00:00Z"), 100_000)).toBe("2026-07-02");
    expect(dayAtOffset(new Date("2026-07-03T12:00:00Z"), Number.NaN)).toBe("2026-07-03");
  });

  it("handles leap days and year ends", () => {
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(streakStatus(["2026-12-31", "2027-01-01"], "2027-01-01").current).toBe(2);
  });
});
