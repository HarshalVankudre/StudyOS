import { describe, expect, it } from "vitest";
import { assignmentLikeTitle, breakLikeTitle, looksLikeCoursework, looksLikeGeneralCalendar } from "./coursework";
import { readFeed, type FeedEvent } from "./normalize";

const ev = (over: Partial<FeedEvent>): FeedEvent => ({ key: over.title ?? "k", title: "Thing", when: { date: "2026-11-20" }, role: "event", ...over });

describe("looksLikeCoursework", () => {
  it("counts deadlines the platform marks, assignment-like titles and course codes", () => {
    expect(looksLikeCoursework(ev({ title: "Untitled item", role: "deadline" }))).toBe(true);
    expect(looksLikeCoursework(ev({ title: "Homework 11" }))).toBe(true);
    expect(looksLikeCoursework(ev({ title: "HW3" }))).toBe(true);
    expect(looksLikeCoursework(ev({ title: "Midterm Exam", course: "MATH 221-02 FA26" }))).toBe(true);
    expect(looksLikeCoursework(ev({ title: "Group meeting", course: "CHEM 210-01 FA26" }))).toBe(true);
    expect(looksLikeCoursework(ev({ title: "Klausur Analysis" }))).toBe(true);
    expect(looksLikeCoursework(ev({ title: "期末考试" }))).toBe(true);
    expect(looksLikeCoursework(ev({ title: "レポート提出" }))).toBe(true);
    expect(looksLikeCoursework(ev({ title: "اختبار قصير" }))).toBe(true);
  });

  it("leaves out events covering several days, even with a course code", () => {
    expect(looksLikeCoursework(ev({ title: "Field trip", course: "GEO 101", days: 3 }))).toBe(false);
    expect(looksLikeCoursework(ev({ title: "Project week", days: 5 }))).toBe(false);
  });

  it("leaves out holidays, breaks and cancellations", () => {
    expect(looksLikeCoursework(ev({ title: "Reading week - no lectures", course: "MATH 221-02 FA26" }))).toBe(false);
    expect(looksLikeCoursework(ev({ title: "Thanksgiving Day" }))).toBe(false);
    expect(looksLikeCoursework(ev({ title: "Spring Break" }))).toBe(false);
    expect(looksLikeCoursework(ev({ title: "Tag der Deutschen Einheit (Feiertag)" }))).toBe(false);
    expect(looksLikeCoursework(ev({ title: "Lab cancelled", course: "CHEM 210" }))).toBe(false);
  });

  it("leaves out ordinary sessions unless the title also names graded work", () => {
    expect(looksLikeCoursework(ev({ title: "Lecture 12", course: "CS 101" }))).toBe(false);
    expect(looksLikeCoursework(ev({ title: "Office hours", course: "CS 101" }))).toBe(false);
    expect(looksLikeCoursework(ev({ title: "Pre-lecture quiz", course: "CS 101" }))).toBe(true);
  });

  it("leaves out personal events and availability start dates", () => {
    expect(looksLikeCoursework(ev({ title: "Dentist" }))).toBe(false);
    expect(looksLikeCoursework(ev({ title: "Study group" }))).toBe(false);
    expect(looksLikeCoursework(ev({ title: "Quiz 4", role: "opening" }))).toBe(false);
  });

  it("matches whole words only", () => {
    expect(assignmentLikeTitle("Labor Day")).toBe(false);
    expect(assignmentLikeTitle("Finally free")).toBe(false);
    expect(assignmentLikeTitle("Lab 4 report")).toBe(true);
    expect(breakLikeTitle("Breakout session")).toBe(false);
  });
});

describe("looksLikeGeneralCalendar", () => {
  const holidays = (n: number) =>
    Array.from({ length: n }, (_, i) => ev({ key: `h${i}`, title: ["New Year's Day", "Labour Day", "Christmas Day", "Diwali"][i % 4] }));

  it("flags a public-holiday calendar", () => {
    expect(looksLikeGeneralCalendar(holidays(147))).toBe(true);
  });

  it("does not flag a course feed, even with a reading week in it", () => {
    const course = [
      ev({ key: "1", title: "Problem Set 5", role: "deadline" }),
      ev({ key: "2", title: "Homework 11", role: "deadline" }),
      ev({ key: "3", title: "Midterm Exam", course: "MATH 221" }),
      ev({ key: "4", title: "Reading week", days: 5 }),
      ev({ key: "5", title: "Lab Safety Quiz", role: "deadline" }),
    ];
    expect(looksLikeGeneralCalendar(course)).toBe(false);
  });

  it("does not warn about a tiny calendar, and counts a repeating event once", () => {
    expect(looksLikeGeneralCalendar(holidays(3))).toBe(false);
    const lectures = Array.from({ length: 40 }, (_, i) => ev({ key: `l${i}`, title: "CS 101 Lecture", series: "lec" }));
    const work = [ev({ key: "a", title: "Essay 1" }), ev({ key: "b", title: "Essay 2" }), ev({ key: "c", title: "Quiz" })];
    expect(looksLikeGeneralCalendar([...lectures, ...work, ev({ key: "d", title: "Dentist" })])).toBe(false);
  });
});

describe("reading an event's length", () => {
  const ics = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\n${body}END:VCALENDAR\r\n`;
  const vevent = (uid: string, lines: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${uid}\r\n${lines}END:VEVENT\r\n`;

  it("counts all-day dates (DTEND exclusive), timed lengths and DURATION", () => {
    const read = readFeed(
      ics(
        vevent("week", "DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261205\r\n") +
          vevent("oneday", "DTSTART;VALUE=DATE:20261126\r\nDTEND;VALUE=DATE:20261127\r\n") +
          vevent("exam", "DTSTART:20261126T090000Z\r\nDTEND:20261126T110000Z\r\n") +
          vevent("trip", "DTSTART:20261126T090000Z\r\nDURATION:P2DT2H\r\n") +
          vevent("due", "DTSTART:20261126T235900Z\r\n"),
      ),
      { now: Date.parse("2026-11-12T12:00:00Z") },
    );
    if (!read.ok) throw new Error(read.error);
    const days = Object.fromEntries(read.feed.events.map((e) => [e.key, e.days ?? 1]));
    expect(days).toEqual({ week: 5, oneday: 1, exam: 1, trip: 3, due: 1 });
  });
});
