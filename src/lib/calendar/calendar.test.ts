import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { workspaceEvents } from "./events";
import { buildIcs, escapeText, foldLine } from "./ics";

function workspace(): Workspace {
  return {
    id: "w1",
    name: "Fall",
    databases: [
      {
        id: "db1",
        name: "Assignments",
        properties: [
          { id: "t", name: "Assignment", type: "text" },
          {
            id: "course",
            name: "Course",
            type: "select",
            options: [{ id: "cs", label: "CS 101" }],
          },
          { id: "due", name: "Due", type: "date" },
        ],
        rows: [
          { id: "r1", cells: { t: "Midterm", course: "cs", due: "2026-09-14" } },
          { id: "r2", cells: { t: "Essay", due: "2026-10-01T00:00:00Z" } },
          { id: "r3", cells: { t: "No date row" } }, // no due → skipped
        ],
        views: [],
      },
      {
        id: "db2",
        name: "Notes",
        properties: [{ id: "n", name: "Note", type: "text" }], // no date prop
        rows: [{ id: "r9", cells: { n: "hi" } }],
        views: [],
      },
    ],
    pages: [],
  };
}

describe("workspaceEvents", () => {
  it("extracts one event per dated row, resolving the course label", () => {
    const events = workspaceEvents(workspace());
    expect(events).toHaveLength(2);
    const midterm = events.find((e) => e.summary.startsWith("Midterm"))!;
    expect(midterm.date).toBe("2026-09-14");
    expect(midterm.summary).toBe("Midterm · CS 101");
    expect(midterm.description).toBe("Assignments · Due");
    expect(midterm.uid).toContain("w1-db1-r1-due");
  });

  it("normalizes an ISO datetime to an all-day date", () => {
    const essay = workspaceEvents(workspace()).find((e) =>
      e.summary.startsWith("Essay"),
    )!;
    expect(essay.date).toBe("2026-10-01");
  });

  it("skips rows without a valid date and databases without a date property", () => {
    const events = workspaceEvents(workspace());
    expect(events.some((e) => e.summary.includes("No date"))).toBe(false);
    expect(events.some((e) => e.uid.includes("db2"))).toBe(false);
  });

  it("gives every event a stable, unique UID", () => {
    const events = workspaceEvents(workspace());
    const uids = events.map((e) => e.uid);
    expect(new Set(uids).size).toBe(uids.length);
    expect(workspaceEvents(workspace())[0].uid).toBe(events[0].uid); // stable
  });
});

describe("escapeText", () => {
  it("escapes commas, semicolons, backslashes, and newlines", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });
});

describe("foldLine", () => {
  it("leaves short lines untouched", () => {
    expect(foldLine("SUMMARY:hi")).toBe("SUMMARY:hi");
  });
  it("folds long lines with CRLF + space and stays within 75 octets", () => {
    const folded = foldLine("X:" + "a".repeat(200));
    for (const physical of folded.split("\r\n")) {
      expect(physical.length).toBeLessThanOrEqual(75);
    }
    // Unfolding (drop CRLF+space) restores the original.
    expect(folded.replace(/\r\n /g, "")).toBe("X:" + "a".repeat(200));
  });
});

describe("buildIcs", () => {
  const now = new Date("2026-07-03T12:00:00Z");

  it("emits a valid VCALENDAR wrapper with the calendar name", () => {
    const ics = buildIcs([], { name: "My deadlines", now });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("X-WR-CALNAME:My deadlines");
    expect(ics).toContain("\r\n"); // CRLF line endings
  });

  it("emits an all-day VEVENT per event with escaped fields", () => {
    const ics = buildIcs(
      [
        {
          uid: "u1@studyos",
          date: "2026-09-14",
          summary: "Midterm; CS",
          description: "Assignments · Due",
        },
      ],
      { name: "Cal", now },
    );
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:u1@studyos");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260914");
    expect(ics).toContain("SUMMARY:Midterm\\; CS"); // semicolon escaped
    expect(ics).toContain("DTSTAMP:20260703T120000Z");
    expect(ics).toContain("END:VEVENT");
  });

  it("omits DESCRIPTION when absent", () => {
    const ics = buildIcs(
      [{ uid: "u@x", date: "2026-01-01", summary: "New Year" }],
      { name: "C", now },
    );
    expect(ics).not.toContain("DESCRIPTION:");
  });
});
