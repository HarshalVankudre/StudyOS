/**
 * Calendars as German universities publish them: a Moodle site running in
 * German, and the semester dates (registration windows, re-enrolment) most
 * universities offer as a calendar file.
 */
import { describe, expect, it } from "vitest";
import { looksLikeCoursework } from "./coursework";
import { eventDay, readFeed, type FeedEvent, type FeedSnapshot } from "./normalize";

const NOW = Date.parse("2026-11-12T12:00:00Z");

function read(text: string): FeedSnapshot {
  const result = readFeed(text, { now: NOW });
  if (!result.ok) throw new Error(result.error);
  return result.feed;
}

const byTitle = (feed: FeedSnapshot, title: string): FeedEvent => {
  const found = feed.events.find((e) => e.title === title);
  if (!found) throw new Error(`no event "${title}" in ${feed.events.map((e) => e.title).join(" | ")}`);
  return found;
};

const cal = (prodId: string, ...body: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${prodId}`, ...body, "END:VCALENDAR"].join("\r\n");
const vevent = (...props: string[]) => ["BEGIN:VEVENT", ...props, "END:VEVENT"].join("\r\n");

const MOODLE = "-//Moodle Pty Ltd//NONSGML Moodle Version 2024100700//EN";

describe("a Moodle site running in German", () => {
  // The wording of Moodle's German language pack: mod_assign calendardue
  // "{$a} ist fällig.", mod_quiz quizeventcloses "{$a} endet" and
  // quizeventopens "{$a} beginnt".
  const feed = read(
    cal(
      MOODLE,
      vevent("UID:1@moodle.uni-example.de", "DTSTART:20261120T225900Z", "SUMMARY:Übungsblatt 5 ist fällig.", "CATEGORIES:Analysis I"),
      vevent("UID:2@moodle.uni-example.de", "DTSTART:20261124T100000Z", "SUMMARY:Testat 2 endet", "CATEGORIES:Physik"),
      vevent("UID:3@moodle.uni-example.de", "DTSTART:20261117T080000Z", "SUMMARY:Testat 2 beginnt", "CATEGORIES:Physik"),
    ),
  );

  it("reads 'ist fällig.' and 'endet' as deadlines and takes the phrase off the title", () => {
    expect(feed.platform).toBe("moodle");
    const sheet = byTitle(feed, "Übungsblatt 5");
    expect(sheet.role).toBe("deadline");
    expect(sheet.course).toBe("Analysis I");
    expect(byTitle(feed, "Testat 2").role).toBe("deadline");
    expect(looksLikeCoursework(sheet)).toBe(true);
  });

  it("reads 'beginnt' as the start of a window, not a deadline", () => {
    const opens = byTitle(feed, "Testat 2 beginnt");
    expect(opens.role).toBe("opening");
    expect(looksLikeCoursework(opens)).toBe(false);
  });
});

describe("a university's semester dates", () => {
  const feed = read(
    cal(
      "-//Example Universität//Semestertermine//DE",
      // An all-day window: DTEND is the day after the last day.
      vevent("UID:reg", "DTSTART;VALUE=DATE:20261201", "DTEND;VALUE=DATE:20270116", "SUMMARY:Prüfungsanmeldung Wintersemester"),
      vevent("UID:back", "DTSTART;VALUE=DATE:20270115", "DTEND;VALUE=DATE:20270216", "SUMMARY:Rückmeldung zum Sommersemester"),
      vevent("UID:dereg", "DTSTART;VALUE=DATE:20270127", "SUMMARY:Abmeldefrist Klausur Analysis I"),
      vevent("UID:break", "DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20270107", "SUMMARY:Weihnachtsferien"),
      vevent("UID:start", "DTSTART;VALUE=DATE:20270412", "SUMMARY:Vorlesungsbeginn"),
      vevent("UID:hand", "DTSTART;VALUE=DATE:20270301", "SUMMARY:Abgabe Hausarbeit Soziologie"),
    ),
  );

  it("turns a registration window into a deadline on the day it closes", () => {
    const registration = byTitle(feed, "Prüfungsanmeldung Wintersemester");
    expect(eventDay(registration.when, "Europe/Berlin")).toBe("2027-01-15");
    expect(registration.role).toBe("deadline");
    expect(registration.days).toBeUndefined();
    expect(looksLikeCoursework(registration)).toBe(true);

    const back = byTitle(feed, "Rückmeldung zum Sommersemester");
    expect(eventDay(back.when, "Europe/Berlin")).toBe("2027-02-15");
    expect(looksLikeCoursework(back)).toBe(true);
  });

  it("offers a one-day administrative deadline for import like coursework", () => {
    const dereg = byTitle(feed, "Abmeldefrist Klausur Analysis I");
    expect(eventDay(dereg.when, "Europe/Berlin")).toBe("2027-01-27");
    expect(dereg.role).toBe("deadline");
    expect(looksLikeCoursework(dereg)).toBe(true);
  });

  it("leaves holidays and other multi-day events as they were", () => {
    const holidays = byTitle(feed, "Weihnachtsferien");
    expect(eventDay(holidays.when, "Europe/Berlin")).toBe("2026-12-24");
    expect(holidays.days).toBe(14);
    expect(looksLikeCoursework(holidays)).toBe(false);
    expect(looksLikeCoursework(byTitle(feed, "Vorlesungsbeginn"))).toBe(false);
  });

  it("reads German deadline words on a plain calendar entry", () => {
    const paper = byTitle(feed, "Abgabe Hausarbeit Soziologie");
    expect(paper.role).toBe("deadline");
    expect(looksLikeCoursework(paper)).toBe(true);
  });

  it("keeps the same sync key for a window whatever day it is filed under", () => {
    expect(byTitle(feed, "Prüfungsanmeldung Wintersemester").key).toBe("reg");
  });
});
