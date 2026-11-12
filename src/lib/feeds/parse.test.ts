import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ICS_LIMITS, parseContentLine, parseIcs, unescapeText, unfoldLines } from "./ical";
import { eventDay, readFeed, type FeedEvent, type FeedSnapshot } from "./normalize";
import { resolveZone, wallTimeToUtc } from "./timezones";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const fixture = (name: string) => readFileSync(path.join(process.cwd(), "src/lib/feeds/fixtures", name), "utf8");

function read(text: string, feedUrl?: string): FeedSnapshot {
  const result = readFeed(text, { now: NOW, feedUrl });
  if (!result.ok) throw new Error(result.error);
  return result.feed;
}

const byTitle = (feed: FeedSnapshot, title: string): FeedEvent => {
  const found = feed.events.find((e) => e.title === title);
  if (!found) throw new Error(`no event "${title}" in ${feed.events.map((e) => e.title).join(" | ")}`);
  return found;
};

const cal = (...body: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//Test//EN", ...body, "END:VCALENDAR"].join("\r\n");

const vevent = (...props: string[]) => ["BEGIN:VEVENT", ...props, "END:VEVENT"].join("\r\n");

describe("content lines", () => {
  it("unfolds continuation lines (space or tab) across CRLF, LF and CR endings", () => {
    expect(unfoldLines("SUMMARY:Hello\r\n  wor\r\n\tld\r\nUID:1")).toEqual(["SUMMARY:Hello world", "UID:1"]);
    expect(unfoldLines("A:1\nB:2\rC:3")).toEqual(["A:1", "B:2", "C:3"]);
    expect(unfoldLines("﻿BEGIN:VCALENDAR")).toEqual(["BEGIN:VCALENDAR"]);
  });

  it("parses quoted parameters containing ; and :", () => {
    const line = parseContentLine('DTSTART;TZID="Eastern Standard Time";X-NOTE="a:b;c":20261114T235900');
    expect(line).toEqual({
      name: "DTSTART",
      params: { TZID: ["Eastern Standard Time"], "X-NOTE": ["a:b;c"] },
      value: "20261114T235900",
    });
    expect(parseContentLine("no colon here")).toBeNull();
    expect(parseContentLine('X;P="unterminated:1')).toBeNull();
  });

  it("unescapes text values", () => {
    expect(unescapeText("Lab 9\\, part 2\\; bring notes\\nRoom 4\\\\B")).toBe("Lab 9, part 2; bring notes\nRoom 4\\B");
  });

  it("bounds hostile input: line count, line length and component count", () => {
    const longLine = `SUMMARY:${"x".repeat(100_000)}`;
    const lines = unfoldLines(`${longLine}\r\n${" y".repeat(50_000)}`);
    expect(lines[0].length).toBeLessThanOrEqual(ICS_LIMITS.maxLineChars);

    const many = Array.from({ length: ICS_LIMITS.maxComponents + 50 }, (_, i) =>
      vevent(`UID:e${i}`, "DTSTART;VALUE=DATE:20261201", `SUMMARY:Item ${i}`),
    );
    const parsed = parseIcs(cal(...many));
    expect(parsed?.components.length).toBe(ICS_LIMITS.maxComponents);
    expect(parsed?.warnings.has("too_many_events")).toBe(true);
  });

  it("ignores malformed lines and drops only events whose date cannot be read", () => {
    const text = cal(
      "garbage line without colon",
      vevent("UID:ok", "SUMMARY:Fine", "DTSTART;VALUE=DATE:20261201", ";;;:::"),
      vevent("UID:bad", "SUMMARY:Broken date", "DTSTART:2026-12-01"),
      vevent("UID:bad2", "SUMMARY:Impossible date", "DTSTART;VALUE=DATE:20260231"),
    );
    const feed = read(text);
    expect(feed.events.map((e) => e.title)).toEqual(["Fine"]);
    expect(feed.warnings).toContain("bad_dates");
  });

  it("refuses text that is not a calendar, and StudyOS's own feed", () => {
    expect(readFeed("<!doctype html><html><body>Sign in</body></html>")).toEqual({ ok: false, error: "not_calendar" });
    expect(readFeed("")).toEqual({ ok: false, error: "not_calendar" });
    expect(readFeed(cal().replace("PRODID:-//Test//Test//EN", "PRODID:-//StudyOS//Deadlines//EN"))).toEqual({
      ok: false,
      error: "studyos_feed",
    });
  });

  it("returns an empty list for a calendar with no events", () => {
    expect(read(cal()).events).toEqual([]);
  });
});

describe("Canvas feed", () => {
  const feed = read(fixture("canvas.ics"), "https://canvas.university.edu/feeds/calendars/user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk.ics");

  it("detects Canvas and reads the course code from the trailing brackets", () => {
    expect(feed.platform).toBe("canvas");
    const essay = byTitle(feed, "Essay 2: Argument Analysis");
    expect(essay.course).toBe("ENG 102-01 FA26");
    expect(essay.role).toBe("deadline");
    expect(essay.key).toBe("event-assignment-99881");
    expect(essay.link).toBe(
      "https://canvas.university.edu/calendar?include_contexts=course_4521&month=11&year=2026#assignment_99881",
    );
  });

  it("unescapes and unfolds summaries and treats calendar events as events", () => {
    expect(byTitle(feed, "Lab 9: Recursion, Part 2").course).toBe("CS101-001-FA26");
    const exam = byTitle(feed, "Midterm Exam");
    expect(exam.role).toBe("event");
    expect(exam.course).toBe("MATH 201");
    expect(exam.when).toEqual({ date: "2026-11-23" });
  });

  it("keeps recent past assignments within the history window", () => {
    expect(byTitle(feed, "Reading Response 1").when).toEqual({ at: Date.parse("2026-10-08T03:59:00Z") });
  });

  it("puts a 23:59 deadline on the student's own calendar day", () => {
    const essay = byTitle(feed, "Essay 2: Argument Analysis");
    // 2026-11-14 04:59 UTC is 23:59 on the 13th in New York, the 14th in Berlin and Tokyo.
    expect(eventDay(essay.when, "America/New_York")).toBe("2026-11-13");
    expect(eventDay(essay.when, "America/Los_Angeles")).toBe("2026-11-13");
    expect(eventDay(essay.when, "Europe/Berlin")).toBe("2026-11-14");
    expect(eventDay(essay.when, "Asia/Tokyo")).toBe("2026-11-14");
  });
});

describe("Moodle feed", () => {
  const exportUrl =
    "https://moodle.university.edu/calendar/export_execute.php?userid=1234&authtoken=9f8e7d6c5b4a39281706f5e4d3c2b1a0&preset_what=all&preset_time=recentupcoming";
  const feed = read(fixture("moodle.ics"), exportUrl);

  it("reads the course from CATEGORIES and strips Moodle's 'is due' / 'closes'", () => {
    expect(feed.platform).toBe("moodle");
    const lab = byTitle(feed, "Lab Report 3");
    expect(lab.course).toBe("CHEM101");
    expect(lab.role).toBe("deadline");
    const quiz = byTitle(feed, "Quiz 4");
    expect(quiz.course).toBe("PSY 100 Introduction to Psychology");
    expect(quiz.role).toBe("deadline");
  });

  it("marks 'opens' events as openings, not deadlines", () => {
    expect(byTitle(feed, "Quiz 4 opens").role).toBe("opening");
  });

  it("takes the item link from the description only when it is on the platform", () => {
    expect(byTitle(feed, "Lab Report 3").link).toBe("https://moodle.university.edu/mod/assign/view.php?id=1201");
  });

  it("never lets the secret export link ride along", () => {
    const slides = byTitle(feed, "Group presentation slides");
    expect(slides.link).toBeUndefined();
    expect(JSON.stringify(feed)).not.toContain("9f8e7d6c5b4a39281706f5e4d3c2b1a0");
  });
});

describe("Google Calendar feed", () => {
  const feed = read(fixture("google.ics"));
  const lectures = feed.events.filter((e) => e.series === "7kq3f1m2abcdefg@google.com");

  it("expands a weekly class within the window, honouring EXDATE, UNTIL and DST", () => {
    expect(feed.platform).toBe("google");
    expect(lectures.length).toBeGreaterThan(20);
    const keys = lectures.map((e) => e.key.split("#")[1]);
    // 10:00 EDT (UTC-4) in September, 10:00 EST (UTC-5) after November 1.
    expect(keys).toContain("20260908T140000Z");
    expect(keys).toContain("20261110T150000Z");
    // Thanksgiving is excluded; nothing after UNTIL (Dec 10 is the last Thursday).
    expect(keys).not.toContain("20261126T150000Z");
    expect(keys).toContain("20261210T150000Z");
    expect(keys).not.toContain("20261215T150000Z");
  });

  it("applies a moved occurrence (RECURRENCE-ID) under the original slot's key", () => {
    const moved = feed.events.find((e) => e.key === "7kq3f1m2abcdefg@google.com#20261119T150000Z");
    expect(moved?.title).toBe("CS 101 Lecture (moved to afternoon)");
    expect(moved?.when).toEqual({ at: Date.parse("2026-11-19T19:00:00Z") });
  });

  it("reads an all-day deadline with a bracketed course", () => {
    const ps = byTitle(feed, "Problem Set 5 due");
    expect(ps.when).toEqual({ date: "2026-11-20" });
    expect(ps.course).toBe("MATH 201");
    expect(ps.role).toBe("deadline");
    // An all-day date is the same day everywhere.
    expect(eventDay(ps.when, "Pacific/Auckland")).toBe("2026-11-20");
    expect(eventDay(ps.when, "Pacific/Honolulu")).toBe("2026-11-20");
  });

  it("skips StudyOS's own events coming back (echo) and cancelled events", () => {
    expect(feed.echoes).toBe(1);
    expect(feed.events.some((e) => e.title.startsWith("Essay 2"))).toBe(false);
    expect(feed.events.some((e) => e.title === "Study group")).toBe(false);
  });

  it("reads a UTC time near midnight on the student's day", () => {
    const proposal = byTitle(feed, "Final project proposal");
    expect(eventDay(proposal.when, "America/New_York")).toBe("2026-11-13");
    expect(eventDay(proposal.when, "Europe/London")).toBe("2026-11-14");
  });
});

describe("other platforms", () => {
  it("Brightspace: course from LOCATION, ' - Due' stripped, availability start is an opening", () => {
    const feed = read(
      cal(
        "X-WR-CALNAME:Brightspace Calendar",
        vevent("UID:d2l-1", "SUMMARY:Lab 3 - Due", "LOCATION:BIO 110 - Cell Biology", "DTSTART:20261119T045900Z"),
        vevent("UID:d2l-2", "SUMMARY:Quiz 2 - Availability Starts", "LOCATION:BIO 110 - Cell Biology", "DTSTART:20261116T130000Z"),
      ).replace("PRODID:-//Test//Test//EN", "PRODID:-//Desire2Learn Inc//D2L Calendar//EN"),
    );
    expect(feed.platform).toBe("brightspace");
    expect(byTitle(feed, "Lab 3")).toMatchObject({ course: "BIO 110 - Cell Biology", role: "deadline" });
    expect(byTitle(feed, "Quiz 2 - Availability Starts").role).toBe("opening");
  });

  it("Blackboard: a course-code prefix becomes the course", () => {
    const feed = read(
      cal(vevent("UID:bb-1", "SUMMARY:HIST-210-002: Primary source analysis", "DTSTART:20261121T045900Z")).replace(
        "PRODID:-//Test//Test//EN",
        "PRODID:-//Blackboard Inc//Blackboard Learn//EN",
      ),
    );
    expect(feed.platform).toBe("blackboard");
    expect(byTitle(feed, "Primary source analysis").course).toBe("HIST-210-002");
  });

  it("Outlook: Windows time zone names resolve", () => {
    const feed = read(
      cal(
        "BEGIN:VTIMEZONE",
        "TZID:Eastern Standard Time",
        "BEGIN:STANDARD",
        "DTSTART:16010101T020000",
        "TZOFFSETFROM:-0400",
        "TZOFFSETTO:-0500",
        "END:STANDARD",
        "END:VTIMEZONE",
        vevent("UID:o-1", "SUMMARY:Thesis draft due", 'DTSTART;TZID="Eastern Standard Time":20261116T233000'),
      ).replace("PRODID:-//Test//Test//EN", "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN"),
    );
    expect(feed.platform).toBe("outlook");
    expect(byTitle(feed, "Thesis draft due").when).toEqual({ at: Date.parse("2026-11-17T04:30:00Z") });
  });
});

describe("time zones and all-day dates around midnight", () => {
  it("resolves IANA, decorated, Windows and offset-only TZIDs", () => {
    expect(resolveZone("Europe/Berlin")).toEqual({ zone: "Europe/Berlin" });
    expect(resolveZone("/mozilla.org/20070129_1/Europe/Berlin")).toEqual({ zone: "Europe/Berlin" });
    expect(resolveZone("W. Europe Standard Time")).toEqual({ zone: "Europe/Berlin" });
    expect(resolveZone("(UTC-05:00) Eastern Time (US & Canada)")).toEqual({ offsetMinutes: -300 });
    expect(resolveZone("Custom zone", { standardOffset: 60 })).toEqual({ offsetMinutes: 60 });
    expect(resolveZone("Custom zone")).toBeNull();
  });

  it("converts wall times across daylight-saving changes", () => {
    // 2026-03-08 is the US spring-forward day; 02:30 does not exist and moves forward.
    const gap = wallTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, { zone: "America/New_York" });
    expect(new Date(gap).toISOString()).toBe("2026-03-08T07:30:00.000Z");
    const winter = wallTimeToUtc({ year: 2026, month: 12, day: 1, hour: 23, minute: 59, second: 0 }, { zone: "America/New_York" });
    expect(new Date(winter).toISOString()).toBe("2026-12-02T04:59:00.000Z");
  });

  it("a TZID deadline at 23:30 stays on its day for students in that zone, not for students east of it", () => {
    const feed = read(cal(vevent("UID:z", "SUMMARY:Late lab", "DTSTART;TZID=America/Los_Angeles:20261120T233000")));
    const late = byTitle(feed, "Late lab");
    expect(eventDay(late.when, "America/Los_Angeles")).toBe("2026-11-20");
    expect(eventDay(late.when, "America/New_York")).toBe("2026-11-21");
  });

  it("a deadline at exactly 00:00 is read literally (the start of that day)", () => {
    const feed = read(cal(vevent("UID:m", "SUMMARY:Midnight", "DTSTART;TZID=Europe/Berlin:20261121T000000")));
    expect(eventDay(byTitle(feed, "Midnight").when, "Europe/Berlin")).toBe("2026-11-21");
  });

  it("floating times keep their wall day; X-WR-TIMEZONE gives them a zone when present", () => {
    const floating = read(cal(vevent("UID:f", "SUMMARY:Floating", "DTSTART:20261120T233000")));
    expect(byTitle(floating, "Floating").when).toEqual({ local: "2026-11-20T23:30:00" });
    expect(eventDay(byTitle(floating, "Floating").when, "Asia/Tokyo")).toBe("2026-11-20");

    const zoned = read(cal("X-WR-TIMEZONE:America/Chicago", vevent("UID:f", "SUMMARY:Floating", "DTSTART:20261120T233000")));
    expect(eventDay(byTitle(zoned, "Floating").when, "America/Chicago")).toBe("2026-11-20");
    expect(eventDay(byTitle(zoned, "Floating").when, "Europe/Paris")).toBe("2026-11-21");
  });

  it("an all-day VTODO due date is read from DUE", () => {
    const feed = read(cal(["BEGIN:VTODO", "UID:t", "SUMMARY:Reading log", "DUE;VALUE=DATE:20261122", "STATUS:COMPLETED", "END:VTODO"].join("\r\n")));
    expect(byTitle(feed, "Reading log")).toMatchObject({ when: { date: "2026-11-22" }, completed: true });
  });
});

describe("recurring events are bounded", () => {
  it("a daily rule from decades ago yields a bounded number of occurrences inside the window", () => {
    const feed = read(cal(vevent("UID:r", "SUMMARY:Standup", "DTSTART:19900101T090000Z", "RRULE:FREQ=DAILY")));
    expect(feed.events.length).toBe(ICS_LIMITS.maxOccurrencesPerSeries);
    const first = feed.events[0].when as { at: number };
    expect(first.at).toBeGreaterThanOrEqual(NOW - 121 * 86_400_000);
  });

  it("COUNT and INTERVAL are honoured", () => {
    const feed = read(
      cal(vevent("UID:c", "SUMMARY:Quiz", "DTSTART;VALUE=DATE:20261102", "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3")),
    );
    expect(feed.events.map((e) => e.when)).toEqual([{ date: "2026-11-02" }, { date: "2026-11-16" }, { date: "2026-11-30" }]);
    expect(feed.events.every((e) => e.series === "c")).toBe(true);
  });

  it("monthly rules skip months without that day (they do not count toward COUNT)", () => {
    const feed = read(cal(vevent("UID:mo", "SUMMARY:Rent", "DTSTART;VALUE=DATE:20261031", "RRULE:FREQ=MONTHLY;COUNT=4")));
    expect(feed.events.map((e) => (e.when as { date: string }).date)).toEqual([
      "2026-10-31",
      "2026-12-31",
      "2027-01-31",
      "2027-03-31",
    ]);
  });

  it("an unsupported rule degrades to its first occurrence", () => {
    const feed = read(
      cal(vevent("UID:u", "SUMMARY:Last Friday", "DTSTART;VALUE=DATE:20261127", "RRULE:FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1")),
    );
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0]).toMatchObject({ key: "u", series: "u", when: { date: "2026-11-27" } });
    expect(feed.warnings).toContain("unsupported_recurrence");
  });

  it("events without a UID get a stable key", () => {
    const text = cal(vevent("SUMMARY:No uid", "DTSTART;VALUE=DATE:20261201"));
    expect(read(text).events[0].key).toBe(read(text).events[0].key);
    expect(read(text).events[0].key).toMatch(/^nouid-/);
  });
});
