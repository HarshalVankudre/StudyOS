import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { mergeWorkspaceEvents, rowEventSummaries, workspaceEvents } from "./events";
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
    // Recognisable in a calendar app: which workspace, database and column.
    expect(midterm.description).toBe("Fall · Assignments · Due");
    expect(midterm.categories).toEqual(["CS 101", "Fall"]);
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

  it("skips malformed dates instead of emitting an invalid event", () => {
    const ws: Workspace = {
      id: "w",
      name: "w",
      databases: [
        {
          id: "d",
          name: "Assignments",
          properties: [
            { id: "t", name: "T", type: "text" },
            { id: "due", name: "Due", type: "date" },
          ],
          rows: [
            { id: "r1", cells: { t: "Bad", due: "2026-99-99" } },
            { id: "r2", cells: { t: "Rollover", due: "2026-13-40" } },
            { id: "r3", cells: { t: "Good", due: "2026-09-14" } },
          ],
          views: [],
        },
      ],
      pages: [],
    };
    const events = workspaceEvents(ws);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Good");
  });
});

describe("completed items", () => {
  function withStatus(): Workspace {
    const ws = workspace();
    const db = ws.databases[0];
    db.properties.push({
      id: "st",
      name: "Status",
      type: "status",
      options: [
        { id: "todo", label: "To do" },
        { id: "done", label: "Done", color: "green" },
      ],
    });
    db.rows[0].cells.st = "done"; // Midterm is finished
    db.rows[1].cells.st = "todo";
    return ws;
  }

  it("are left out by default", () => {
    expect(workspaceEvents(withStatus()).map((e) => e.title)).toEqual(["Essay"]);
  });

  it("are included on request, marked done", () => {
    const events = workspaceEvents(withStatus(), { includeCompleted: true });
    expect(events.find((e) => e.title === "Midterm")).toMatchObject({
      summary: "✓ Midterm · CS 101",
      completed: true,
    });
    expect(events.find((e) => e.title === "Essay")!.summary).toBe("Essay");
  });
});

describe("course from a relation to a courses database", () => {
  it("names the related course when there is no select column", () => {
    const ws: Workspace = {
      id: "w",
      name: "Spring",
      pages: [],
      databases: [
        {
          id: "courses",
          name: "Courses",
          properties: [{ id: "cn", name: "Name", type: "text" }],
          rows: [{ id: "c1", cells: { cn: "Organic Chemistry" } }],
          views: [],
        },
        {
          id: "hw",
          name: "Homework",
          properties: [
            { id: "t", name: "Task", type: "text" },
            { id: "rel", name: "Course", type: "relation", relationDatabaseId: "courses" },
            { id: "due", name: "Due", type: "date" },
          ],
          rows: [{ id: "h1", cells: { t: "Lab report", rel: ["c1"], due: "2026-03-02" } }],
          views: [],
        },
      ],
    };
    const [event] = workspaceEvents(ws);
    expect(event.summary).toBe("Lab report · Organic Chemistry");
    expect(event.description).toBe("Spring · Homework · Due");
    // The import recognises every form of this title as StudyOS's own.
    expect(rowEventSummaries(ws, ws.databases[1], ws.databases[1].rows[0])).toEqual(
      expect.arrayContaining([
        "Lab report · Organic Chemistry",
        "Lab report · Organic Chemistry · Spring",
        "✓ Lab report · Organic Chemistry",
      ]),
    );
  });
});

describe("mergeWorkspaceEvents (the whole feed)", () => {
  const copyOf = (ws: Workspace, id: string, name: string): Workspace => ({
    ...structuredClone(ws),
    id,
    name,
  });

  it("one workspace: titles stay short", () => {
    expect(mergeWorkspaceEvents([workspace()]).map((e) => e.summary)).toEqual([
      "Midterm · CS 101",
      "Essay",
    ]);
  });

  it("an untouched duplicate does not double the feed; an edited row of the copy appears, named by its workspace", () => {
    const original = workspace();
    const copy = copyOf(original, "w2", "Fall (copy)");
    expect(mergeWorkspaceEvents([original, copy])).toHaveLength(2);

    copy.databases[0].rows[0].cells.due = "2026-09-21"; // the copy moved its midterm
    const events = mergeWorkspaceEvents([original, copy]);
    expect(events).toHaveLength(3);
    const midterms = events.filter((e) => e.title === "Midterm");
    expect(midterms.map((e) => e.summary).sort()).toEqual([
      "Midterm · CS 101 · Fall",
      "Midterm · CS 101 · Fall (copy)",
    ]);
    // The untouched essay still appears once, under the original.
    expect(events.filter((e) => e.title === "Essay")).toEqual([
      expect.objectContaining({ uid: expect.stringMatching(/^w1-/) }),
    ]);
    expect(new Set(events.map((e) => e.uid)).size).toBe(3);
  });

  it("two different workspaces: every title names its workspace", () => {
    const other: Workspace = { ...structuredClone(workspace()), id: "w9", name: "Spring" };
    other.databases[0].id = "dbX"; // a different workspace, not a copy
    const events = mergeWorkspaceEvents([workspace(), other]);
    expect(events).toHaveLength(4);
    expect(events.every((e) => e.summary.endsWith(` · ${e.workspaceName}`))).toBe(true);
  });

  it("writes the course and workspace as CATEGORIES in the ICS", () => {
    const ics = buildIcs(mergeWorkspaceEvents([workspace()]), { name: "C", now: new Date(0) });
    expect(ics).toContain("CATEGORIES:CS 101,Fall");
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

  it("folds by OCTETS and never splits a multibyte code point", () => {
    const enc = new TextEncoder();
    // Mix of 3-byte CJK and 4-byte emoji so byte length != code-unit length.
    const line = "SUMMARY:" + "课".repeat(40) + "📚".repeat(20);
    const folded = foldLine(line);
    for (const physical of folded.split("\r\n")) {
      expect(enc.encode(physical).length).toBeLessThanOrEqual(75);
    }
    // Unfolds losslessly — no replacement chars from a split surrogate.
    const unfolded = folded.replace(/\r\n /g, "");
    expect(unfolded).toBe(line);
    expect(unfolded).not.toContain("�");
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
