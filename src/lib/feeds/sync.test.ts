import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repairWorkspace } from "@/lib/workspace/repair";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Database, DatabaseRow, Workspace } from "@/lib/workspace/types";
import { courseCode, detectMapping, matchCourse, type FeedMapping } from "./mapping";
import { readFeed, type FeedEvent, type FeedSnapshot } from "./normalize";
import { applyFeedEvents, classifyEvents, isDefaultSelected, pendingUpdates, rowsMissingFromFile, type ApplyOptions } from "./sync";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const TODAY = "2026-11-12";
const TZ = "America/New_York";
const FEED = "feed_canvas";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "src/lib/feeds/fixtures", name), "utf8");
function read(name: string, feedUrl?: string): FeedSnapshot {
  const result = readFeed(fixture(name), { now: NOW, feedUrl });
  if (!result.ok) throw new Error(result.error);
  return result.feed;
}

function assignments(rows: DatabaseRow[] = []): Database {
  return {
    id: "db-assign",
    name: "Assignments",
    properties: [
      { id: "a-name", name: "Assignment", type: "text" },
      {
        id: "a-course",
        name: "Course",
        type: "select",
        options: [
          { id: "co-cs101", label: "CS 101", color: "blue" },
          { id: "co-math201", label: "MATH 201", color: "violet" },
          { id: "co-eng102", label: "ENG 102", color: "amber" },
        ],
      },
      {
        id: "a-status",
        name: "Status",
        type: "status",
        options: [
          { id: "st-todo", label: "Not started", color: "zinc" },
          { id: "st-doing", label: "In progress", color: "amber" },
          { id: "st-done", label: "Done", color: "green" },
        ],
      },
      { id: "a-due", name: "Due", type: "date" },
      { id: "a-link", name: "Link", type: "url" },
    ],
    rows,
    views: [{ id: "v", name: "All", type: "table" }],
  };
}

function workspace(db: Database, extra: Database[] = []): Workspace {
  return { id: "ws1", name: "Fall", pages: [], databases: [db, ...extra] };
}

let counter = 0;
const ids = () => `id-${++counter}`;

function opts(mapping: FeedMapping, over: Partial<ApplyOptions> = {}): ApplyOptions {
  return {
    databaseId: "db-assign",
    feedId: FEED,
    mapping,
    today: TODAY,
    timeZone: TZ,
    mode: "import",
    newColumns: {
      due: { id: "new-due", name: "Due" },
      course: { id: "new-course", name: "Course" },
      link: { id: "new-link", name: "Link" },
    },
    newId: ids,
    ...over,
  };
}

const rowByKey = (ws: Workspace, key: string) => ws.databases[0].rows.find((r) => r.source?.key === key);
const defaults = (events: FeedEvent[]) => new Set(events.filter((e) => isDefaultSelected(e, TODAY, TZ)).map((e) => e.key));

describe("mapping", () => {
  it("detects title, due date, course, link and status columns", () => {
    expect(detectMapping(assignments())).toEqual({
      title: "a-name",
      due: "a-due",
      course: "a-course",
      link: "a-link",
      status: "a-status",
    });
  });

  it("offers a new due column when the database has no date", () => {
    const db: Database = { id: "d", name: "Notes", properties: [{ id: "t", name: "Name", type: "text" }], rows: [], views: [] };
    expect(detectMapping(db)).toMatchObject({ title: "t", due: "new", course: null, link: null, status: null });
  });

  it("matches course codes and names across the shapes platforms use", () => {
    expect(courseCode("CS101-001-FA26")).toBe("CS 101");
    expect(courseCode("ENG 102-01 FA26")).toBe("ENG 102");
    expect(courseCode("MATH-2410H: Calculus")).toBe("MATH 2410H");
    const labels = ["CS 101", "Introduction to Psychology", "ENG 102"];
    expect(matchCourse("CS101-001-FA26", labels)).toBe(0);
    expect(matchCourse("eng 102", labels)).toBe(2);
    expect(matchCourse("Introduction to Psychology (PSY 100)", labels)).toBe(1);
    expect(matchCourse("HIST 210", labels)).toBe(-1);
  });
});

describe("first import", () => {
  const feed = read("canvas.ics");

  it("adds the chosen events with title, local due day, course, link and an open status", () => {
    const ws = workspace(assignments());
    const mapping = detectMapping(ws.databases[0]);
    const result = applyFeedEvents(ws, feed.events, opts(mapping, { selected: defaults(feed.events) }));

    // Past assignments are not chosen by default.
    expect(rowByKey(ws, "event-assignment-99001")).toBeUndefined();
    const essay = rowByKey(ws, "event-assignment-99881")!;
    expect(essay.cells).toEqual({
      "a-name": "Essay 2: Argument Analysis",
      "a-due": "2026-11-13", // 23:59 New York time, not the UTC date
      "a-course": "co-eng102", // "ENG 102-01 FA26" matched the existing option
      "a-link": "https://canvas.university.edu/calendar?include_contexts=course_4521&month=11&year=2026#assignment_99881",
      "a-status": "st-todo",
    });
    expect(essay.source).toMatchObject({ kind: "ical", feed: FEED, key: "event-assignment-99881" });
    expect(rowByKey(ws, "event-assignment-99902")!.cells["a-course"]).toBe("co-cs101");
    expect(rowByKey(ws, "event-calendar-event-5512")!.cells["a-course"]).toBe("co-math201");
    expect(result.changes.filter((c) => c.kind === "added")).toHaveLength(4);
    expect(result.considered).toHaveLength(feed.events.length);
    // The result is a valid workspace.
    expect(safeParseWorkspace(ws).success).toBe(true);
  });

  it("creates a course option when the feed's course is new", () => {
    const ws = workspace(assignments());
    const moodle = read("moodle.ics");
    applyFeedEvents(ws, moodle.events, opts(detectMapping(ws.databases[0]), { selected: defaults(moodle.events) }));
    const course = ws.databases[0].properties.find((p) => p.id === "a-course")!;
    expect(course.options!.map((o) => o.label)).toEqual(["CS 101", "MATH 201", "ENG 102", "CHEM 101", "PSY 100", "HIST 210"]);
    // Two events of one new course share the created option.
    const rows = ws.databases[0].rows;
    const psy = course.options!.find((o) => o.label === "PSY 100")!.id;
    expect(rows.filter((r) => r.cells["a-course"] === psy)).toHaveLength(1); // "opens" was not chosen
  });

  it("creates missing columns the student asked for", () => {
    const db: Database = { id: "db-assign", name: "Todo", properties: [{ id: "t", name: "Task", type: "text" }], rows: [], views: [] };
    const ws = workspace(db);
    const result = applyFeedEvents(
      ws,
      feed.events,
      opts({ title: "t", due: "new", course: "new", link: null, status: null }, { selected: defaults(feed.events) }),
    );
    expect(db.properties.map((p) => [p.id, p.type])).toEqual([
      ["t", "text"],
      ["new-due", "date"],
      ["new-course", "select"],
    ]);
    expect(result.mapping).toMatchObject({ due: "new-due", course: "new-course" });
    expect(rowByKey(ws, "event-assignment-99881")!.cells["new-due"]).toBe("2026-11-13");
  });

  it("is deterministic when replayed on a newer workspace (the editor may re-run it)", () => {
    const ws1 = workspace(assignments());
    const ws2 = workspace(assignments());
    const mapping = detectMapping(ws1.databases[0]);
    applyFeedEvents(ws1, feed.events, opts(mapping, { selected: defaults(feed.events) }));
    applyFeedEvents(ws2, feed.events, opts(mapping, { selected: defaults(feed.events) }));
    const shape = (ws: Workspace) => ws.databases[0].rows.map((r) => [r.source?.key, r.cells["a-name"], r.cells["a-due"]]);
    expect(shape(ws1)).toEqual(shape(ws2));
  });

  it("never puts the feed link into the workspace (which the AI reads)", () => {
    const secret = "https://canvas.university.edu/feeds/calendars/user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk.ics";
    const withSecret = readFeed(fixture("canvas.ics"), { now: NOW, feedUrl: secret });
    if (!withSecret.ok) throw new Error();
    const ws = workspace(assignments());
    applyFeedEvents(ws, withSecret.feed.events, opts(detectMapping(ws.databases[0]), { selected: defaults(withSecret.feed.events) }));
    const json = JSON.stringify(ws);
    expect(json).not.toContain("user_8hT3kQ0aZx1Yc2Vb7Nn4Mm5Ll6Kk");
    expect(json).not.toContain("/feeds/calendars/");
  });
});

describe("re-sync", () => {
  const canvas = read("canvas.ics");
  const mapping = detectMapping(assignments());

  function imported(): Workspace {
    const ws = workspace(assignments());
    applyFeedEvents(ws, canvas.events, opts(mapping, { selected: defaults(canvas.events) }));
    return ws;
  }
  const seenAfterImport = new Set(canvas.events.map((e) => e.key));
  const sync = (ws: Workspace, events: FeedEvent[], over: Partial<ApplyOptions> = {}) =>
    applyFeedEvents(ws, events, opts(mapping, { mode: "sync", seen: seenAfterImport, horizonDay: canvas.horizonDay, ...over }));

  const edit = (events: FeedEvent[], key: string, patch: Partial<FeedEvent>) =>
    events.map((e) => (e.key === key ? { ...e, ...patch } : e));

  it("follows changed titles and dates at the source", () => {
    const ws = imported();
    const moved = edit(canvas.events, "event-assignment-99881", {
      title: "Essay 2: Argument Analysis (revised)",
      when: { at: Date.parse("2026-11-18T04:59:00Z") },
    });
    const result = sync(ws, moved);
    expect(rowByKey(ws, "event-assignment-99881")!.cells).toMatchObject({
      "a-name": "Essay 2: Argument Analysis (revised)",
      "a-due": "2026-11-17",
    });
    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: "updated", key: "event-assignment-99881", fields: ["title", "due"] }),
    );
  });

  it("never overwrites a field the student edited, but still follows the others", () => {
    const ws = imported();
    const row = rowByKey(ws, "event-assignment-99881")!;
    row.cells["a-name"] = "Essay 2 (my notes: ask TA)";
    row.cells["a-status"] = "st-doing";
    const moved = edit(canvas.events, "event-assignment-99881", {
      title: "Essay 2 renamed",
      when: { at: Date.parse("2026-11-18T04:59:00Z") },
    });
    const result = sync(ws, moved);
    expect(row.cells["a-name"]).toBe("Essay 2 (my notes: ask TA)");
    expect(row.cells["a-status"]).toBe("st-doing");
    expect(row.cells["a-due"]).toBe("2026-11-17");
    expect(result.keptEdits).toBe(1);
  });

  it("adds new events and does not re-add skipped ones or rows the student deleted", () => {
    const ws = imported();
    // The student deletes one imported row.
    ws.databases[0].rows = ws.databases[0].rows.filter((r) => r.source?.key !== "event-assignment-99902");
    const fresh: FeedEvent = {
      key: "event-assignment-100500",
      title: "Lab 10",
      when: { at: Date.parse("2026-12-05T04:59:00Z") },
      course: "CS101-001-FA26",
      role: "deadline",
    };
    const result = sync(ws, [...canvas.events, fresh]);
    expect(rowByKey(ws, "event-assignment-100500")?.cells["a-name"]).toBe("Lab 10");
    expect(rowByKey(ws, "event-assignment-99902")).toBeUndefined();
    expect(rowByKey(ws, "event-assignment-99001")).toBeUndefined(); // skipped (past) at import
    expect(result.changes.map((c) => c.kind)).toEqual(["added"]);
    expect(result.considered).toEqual(["event-assignment-100500"]);
  });

  it("flags a row whose event vanished, never deletes it, and clears the flag when it returns", () => {
    const ws = imported();
    const before = ws.databases[0].rows.length;
    const without = canvas.events.filter((e) => e.key !== "event-assignment-99950");
    const result = sync(ws, without);
    expect(ws.databases[0].rows).toHaveLength(before);
    expect(rowByKey(ws, "event-assignment-99950")!.source!.missingSince).toBe(TODAY);
    expect(result.changes).toEqual([{ kind: "flagged", key: "event-assignment-99950", title: "Lab 9: Recursion, Part 2" }]);

    // Syncing again does not flag twice; the event coming back clears it.
    expect(sync(ws, without).changes).toEqual([]);
    const back = sync(ws, canvas.events);
    expect(rowByKey(ws, "event-assignment-99950")!.source!.missingSince).toBeUndefined();
    expect(back.changes.map((c) => c.kind)).toEqual(["restored"]);
  });

  it("does not flag rows older than the feed reaches, or rows from another feed", () => {
    const ws = imported();
    ws.databases[0].rows.push(
      { id: "old", cells: { "a-name": "Old", "a-due": "2026-01-10" }, source: { kind: "ical", feed: FEED, key: "gone-old" } },
      { id: "other", cells: { "a-name": "Other", "a-due": "2026-11-20" }, source: { kind: "ical", feed: "feed_other", key: "x" } },
    );
    expect(sync(ws, canvas.events).changes).toEqual([]);
  });

  it("relinks a row that lost its link instead of duplicating it", () => {
    const ws = imported();
    const row = rowByKey(ws, "event-assignment-99881")!;
    delete row.source; // e.g. the AI agent rewrote the database
    const result = sync(ws, canvas.events);
    expect(ws.databases[0].rows.filter((r) => r.cells["a-name"] === "Essay 2: Argument Analysis")).toHaveLength(1);
    expect((row as DatabaseRow).source?.key).toBe("event-assignment-99881");
    expect(result.changes.map((c) => c.kind)).toEqual(["linked"]);
  });

  it("an uploaded file's rows are adopted by a connected feed with the same events", () => {
    const ws = workspace(assignments());
    applyFeedEvents(ws, canvas.events, opts(mapping, { feedId: "file", selected: defaults(canvas.events) }));
    const count = ws.databases[0].rows.length;
    applyFeedEvents(ws, canvas.events, opts(mapping, { selected: defaults(canvas.events) }));
    expect(ws.databases[0].rows).toHaveLength(count);
    expect(rowByKey(ws, "event-assignment-99881")!.source!.feed).toBe(FEED);
  });

  it("re-importing a file in which only a date changed offers that change and applies it when ticked", () => {
    const ws = workspace(assignments());
    applyFeedEvents(ws, canvas.events, opts(mapping, { feedId: "file", selected: defaults(canvas.events) }));
    const moved = edit(canvas.events, "event-assignment-99881", { when: { at: Date.parse("2026-11-19T04:59:00Z") } });

    const pending = pendingUpdates(ws, "db-assign", moved, mapping, TZ);
    expect([...pending.keys()]).toEqual(["event-assignment-99881"]);
    expect(pending.get("event-assignment-99881")).toEqual({ fields: ["due"], due: { from: "2026-11-13", to: "2026-11-18" } });
    // Nothing new: the preview's status alone would say "already in table".
    expect(classifyEvents(ws, "db-assign", moved, mapping, TZ).get("event-assignment-99881")).toBe("inTable");

    // Left unticked, the row keeps its date.
    const skipped = applyFeedEvents(ws, moved, opts(mapping, { feedId: "file", selected: new Set() }));
    expect(skipped.changes).toEqual([]);
    expect(rowByKey(ws, "event-assignment-99881")!.cells["a-due"]).toBe("2026-11-13");

    // Ticked, it follows the calendar, with no new event in the file.
    const applied = applyFeedEvents(ws, moved, opts(mapping, { feedId: "file", selected: new Set(pending.keys()) }));
    expect(applied.changes).toEqual([
      { kind: "updated", key: "event-assignment-99881", title: "Essay 2: Argument Analysis", fields: ["due"] },
    ]);
    expect(rowByKey(ws, "event-assignment-99881")!.cells["a-due"]).toBe("2026-11-18");
    expect(pendingUpdates(ws, "db-assign", moved, mapping, TZ).size).toBe(0);
  });

  it("does not offer a change to a field the student edited", () => {
    const ws = imported();
    rowByKey(ws, "event-assignment-99881")!.cells["a-due"] = "2026-11-15";
    const moved = edit(canvas.events, "event-assignment-99881", { when: { at: Date.parse("2026-11-19T04:59:00Z") } });
    expect(pendingUpdates(ws, "db-assign", moved, mapping, TZ).size).toBe(0);
  });

  it("an uploaded file never flags rows missing from it (a file may be partial), and counts them for the preview", () => {
    const ws = workspace(assignments());
    applyFeedEvents(ws, canvas.events, opts(mapping, { feedId: "file", selected: defaults(canvas.events) }));
    const partial = canvas.events.filter((e) => e.key !== "event-assignment-99950");
    const result = applyFeedEvents(ws, partial, opts(mapping, { feedId: "file", selected: new Set() }));
    expect(result.changes).toEqual([]);
    expect(rowByKey(ws, "event-assignment-99950")!.source!.missingSince).toBeUndefined();
    expect(rowsMissingFromFile(ws, "db-assign", partial, mapping, TODAY)).toBe(1);
    expect(rowsMissingFromFile(ws, "db-assign", canvas.events, mapping, TODAY)).toBe(0);
    // A different calendar file says nothing about these rows.
    const other: FeedEvent = { key: "x@holidays", title: "Thanksgiving Day", when: { date: "2026-11-26" }, role: "event" };
    expect(rowsMissingFromFile(ws, "db-assign", [other], mapping, TODAY)).toBe(0);
  });

  it("pre-selects coursework only: a multi-day reading week is not a deadline", () => {
    const week: FeedEvent = { key: "rw", title: "Reading week - no lectures", when: { date: "2026-11-30" }, course: "MATH 221", role: "event", days: 5 };
    const dentist: FeedEvent = { key: "dn", title: "Dentist", when: { at: Date.parse("2026-11-20T15:00:00Z") }, role: "event" };
    expect(isDefaultSelected(week, TODAY, TZ)).toBe(false);
    expect(isDefaultSelected(dentist, TODAY, TZ)).toBe(false);
    // A connected feed does not add them on its own either.
    const ws = imported();
    const result = sync(ws, [...canvas.events, week, dentist]);
    expect(result.changes).toEqual([]);
    expect(result.considered).toEqual(["rw", "dn"]);
  });

  it("repeating events are only added when the student follows them", () => {
    const google = read("google.ics");
    const ws = workspace(assignments());
    const seen = new Set<string>();
    applyFeedEvents(ws, google.events, opts(mapping, { mode: "sync", seen }));
    expect(ws.databases[0].rows.some((r) => r.cells["a-name"] === "CS 101 Lecture")).toBe(false);

    const ws2 = workspace(assignments());
    applyFeedEvents(ws2, google.events, opts(mapping, { mode: "sync", seen, series: new Set(["7kq3f1m2abcdefg@google.com"]) }));
    const lectures = ws2.databases[0].rows.filter((r) => r.source?.key.startsWith("7kq3f1m2abcdefg@google.com#"));
    expect(lectures.length).toBeGreaterThan(5);
    expect(lectures.every((r) => String(r.cells["a-due"]) >= TODAY)).toBe(true);
  });
});

describe("echo: StudyOS's own feed coming back through Google Calendar", () => {
  it("does not duplicate rows StudyOS published, even when Google rewrote the UID", () => {
    const db = assignments([
      { id: "row-essay", cells: { "a-name": "Essay 2", "a-course": "co-eng102", "a-due": "2026-11-13" } },
      { id: "row-quiz", cells: { "a-name": "Reading quiz", "a-course": "co-cs101", "a-due": "2026-11-13" } },
    ]);
    const ws = workspace(db);
    const google = read("google.ics");
    const mapping = detectMapping(db);
    const status = classifyEvents(ws, db.id, google.events, mapping, TZ);
    const quizKey = "copied-by-google-123@google.com";
    expect(status.get(quizKey)).toBe("echo");

    applyFeedEvents(ws, google.events, opts(mapping, { selected: new Set(google.events.map((e) => e.key)) }));
    expect(db.rows.filter((r) => String(r.cells["a-name"]).startsWith("Reading quiz"))).toHaveLength(1);
    expect(db.rows.filter((r) => String(r.cells["a-name"]).startsWith("Essay 2"))).toHaveLength(1);
    // The student's own rows were not taken over by the import.
    expect(db.rows.find((r) => r.id === "row-quiz")!.source).toBeUndefined();
  });

  it("also recognises the titles the feed gives with the workspace's name or a done mark", () => {
    const db = assignments([
      { id: "row-quiz", cells: { "a-name": "Reading quiz", "a-course": "co-cs101", "a-due": "2026-11-13" } },
    ]);
    const ws = workspace(db);
    const google = read("google.ics");
    const quiz = google.events.find((e) => e.key === "copied-by-google-123@google.com")!;
    const variants = [
      { ...quiz, key: "named@google.com", title: "Reading quiz · CS 101 · Fall" },
      { ...quiz, key: "done@google.com", title: "✓ Reading quiz · CS 101" },
    ];
    const status = classifyEvents(ws, db.id, variants, detectMapping(db), TZ);
    expect(status.get("named@google.com")).toBe("echo");
    expect(status.get("done@google.com")).toBe("echo");
    applyFeedEvents(ws, variants, opts(detectMapping(db), { selected: new Set(variants.map((e) => e.key)) }));
    expect(db.rows).toHaveLength(1);
  });
});

describe("course as a relation to a Courses database", () => {
  it("matches a course row by its code column and creates missing courses as rows", () => {
    const courses: Database = {
      id: "db-courses",
      name: "Courses",
      properties: [
        { id: "c-name", name: "Course", type: "text" },
        { id: "c-code", name: "Code", type: "text" },
      ],
      rows: [{ id: "c1", cells: { "c-name": "Intro to Programming", "c-code": "CS 101" } }],
      views: [],
    };
    const db: Database = {
      id: "db-assign",
      name: "Assignments",
      properties: [
        { id: "n", name: "Name", type: "text" },
        { id: "d", name: "Due date", type: "date" },
        { id: "c", name: "Class", type: "relation", relationDatabaseId: "db-courses" },
      ],
      rows: [],
      views: [],
    };
    const ws = workspace(db, [courses]);
    const canvas = read("canvas.ics");
    const mapping = detectMapping(db);
    expect(mapping.course).toBe("c");
    applyFeedEvents(ws, canvas.events, opts(mapping, { selected: defaults(canvas.events) }));
    expect(rowByKey(ws, "event-assignment-99902")!.cells.c).toEqual(["c1"]);
    expect(courses.rows.map((r) => r.cells["c-name"])).toEqual(["Intro to Programming", "ENG 102", "MATH 201"]);
    expect(safeParseWorkspace(ws).success).toBe(true);
  });

  it("matches courses against a large Courses table without rebuilding its labels per event", () => {
    const courses: Database = {
      id: "db-courses",
      name: "Courses",
      properties: [{ id: "c-name", name: "Course", type: "text" }],
      rows: Array.from({ length: 20_000 }, (_, i) => ({ id: `c${i}`, cells: { "c-name": `Course ${i}` } })),
      views: [],
    };
    courses.rows.push({ id: "cs", cells: { "c-name": "CS 101" } });
    const db: Database = {
      id: "db-assign",
      name: "Assignments",
      properties: [
        { id: "n", name: "Name", type: "text" },
        { id: "d", name: "Due date", type: "date" },
        { id: "c", name: "Class", type: "relation", relationDatabaseId: "db-courses" },
      ],
      rows: [],
      views: [],
    };
    const ws = workspace(db, [courses]);
    const events: FeedEvent[] = Array.from({ length: 400 }, (_, i) => ({
      key: `e${i}`,
      title: `Essay ${i}`,
      when: { date: "2026-12-01" },
      course: "CS 101",
      role: "deadline",
    }));
    const t0 = performance.now();
    applyFeedEvents(ws, events, opts(detectMapping(db), { selected: new Set(events.map((e) => e.key)) }));
    const ms = performance.now() - t0;
    expect(db.rows).toHaveLength(400);
    expect(db.rows.every((r) => JSON.stringify(r.cells.c) === '["cs"]')).toBe(true);
    // Was 400 label rebuilds over 20,000 rows; now one. Generous bound.
    expect(ms).toBeLessThan(3_000);
  }, 60_000);
});

describe("model compatibility", () => {
  it("documents without row sources still load, and a damaged source is repaired, not fatal", () => {
    const ws = workspace(
      assignments([
        { id: "plain", cells: { "a-name": "Mine" } },
        {
          id: "damaged",
          cells: { "a-name": "Imported" },
          source: { kind: "ical", feed: "f1", key: "uid-1", synced: { title: 42 } } as never,
        },
        { id: "unusable", cells: { "a-name": "Broken link" }, source: { kind: "ical", feed: 7 } as never },
      ]),
    );
    const repaired = repairWorkspace(ws);
    const rows = repaired!.workspace.databases[0].rows;
    expect(rows.map((r) => r.id)).toEqual(["plain", "damaged", "unusable"]);
    expect(rows[1].source).toEqual({ kind: "ical", feed: "f1", key: "uid-1" });
    expect(rows[2].source).toBeUndefined();
  });
});
