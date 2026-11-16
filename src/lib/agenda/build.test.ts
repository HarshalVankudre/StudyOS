import { describe, expect, it } from "vitest";
import { buildDailyStudyPlan } from "@/lib/agents/daily-study/planner";
import { itemHref } from "@/lib/agents/daily-study/present";
import type { Database, DatabaseRow, Workspace } from "@/lib/workspace/types";
import { addDays } from "@/lib/workspace/view-logic";
import {
  AGENDA_DAYS,
  OVERDUE_DAYS,
  agendaHref,
  buildAgenda,
  collectAgendaItems,
  compareAgendaItems,
  parseAgendaParams,
  type AgendaCourse,
  type AgendaItem,
} from "./build";

const TODAY = "2026-11-13";

type RowSpec = { id: string; title: string; due: string; status?: "todo" | "done"; type?: "exam" | "hw"; course?: string };

function assignments(rows: RowSpec[], id = "assignments"): Database {
  return {
    id,
    name: "Assignments",
    properties: [
      { id: "title", name: "Assignment", type: "text" },
      { id: "due", name: "Due", type: "date" },
      {
        id: "status",
        name: "Status",
        type: "status",
        options: [
          { id: "todo", label: "To do" },
          { id: "done", label: "Done" },
        ],
      },
      {
        id: "type",
        name: "Type",
        type: "select",
        options: [
          { id: "exam", label: "Exam" },
          { id: "hw", label: "Homework" },
        ],
      },
      { id: "course", name: "Course", type: "text" },
    ],
    rows: rows.map(
      (r): DatabaseRow => ({
        id: r.id,
        cells: {
          title: r.title,
          due: r.due,
          status: r.status ?? "todo",
          ...(r.type ? { type: r.type } : {}),
          ...(r.course ? { course: r.course } : {}),
        },
      }),
    ),
    views: [{ id: "table", name: "Table", type: "table" }],
  };
}

function workspace(id: string, name: string, rows: RowSpec[], icon?: string): Workspace {
  return {
    id,
    name,
    ...(icon ? { icon } : {}),
    homePageId: "tracker",
    pages: [
      { id: "tracker", title: "Tracker", blocks: [{ id: "view", type: "database_view", databaseId: "assignments", viewId: "table" }] },
    ],
    databases: [assignments(rows)],
  };
}

const ids = (items: AgendaItem[]) => items.map((i) => i.id);

describe("collectAgendaItems", () => {
  it("keeps two weeks ahead and two weeks of open overdue work, nothing further", () => {
    const items = collectAgendaItems(
      [
        workspace("bio", "Biology", [
          { id: "too-old", title: "Old essay", due: addDays(TODAY, -OVERDUE_DAYS - 1) },
          { id: "oldest", title: "Lab write-up", due: addDays(TODAY, -OVERDUE_DAYS) },
          { id: "today", title: "Reading", due: TODAY },
          { id: "last", title: "Poster", due: addDays(TODAY, AGENDA_DAYS - 1) },
          { id: "too-far", title: "Portfolio", due: addDays(TODAY, AGENDA_DAYS) },
        ]),
      ],
      TODAY,
    );
    expect(ids(items).sort()).toEqual([
      "deadline:bio:assignments:last",
      "deadline:bio:assignments:oldest",
      "deadline:bio:assignments:today",
    ]);
  });

  it("keeps done work ahead (the page can show it) but never done or past exams as overdue", () => {
    const items = collectAgendaItems(
      [
        workspace("bio", "Biology", [
          { id: "done-ahead", title: "Problem set 4", due: addDays(TODAY, 2), status: "done" },
          { id: "done-past", title: "Problem set 3", due: addDays(TODAY, -2), status: "done" },
          { id: "past-exam", title: "Quiz week 9", due: addDays(TODAY, -1), type: "exam" },
          { id: "exam", title: "Midterm", due: addDays(TODAY, 5) },
        ]),
      ],
      TODAY,
    );
    expect(ids(items).sort()).toEqual(["deadline:bio:assignments:done-ahead", "exam:bio:assignments:exam"]);
    expect(items.find((i) => i.id.endsWith("done-ahead"))?.done).toBe(true);
    expect(items.find((i) => i.kind === "exam")?.title).toBe("Midterm");
  });

  it("agrees with Today: same ids, same exam reading, same deep links", () => {
    const workspaces = [
      workspace("bio", "Biology", [
        { id: "late", title: "Lab report", due: addDays(TODAY, -3) },
        { id: "soon", title: "Essay draft", due: addDays(TODAY, 1) },
        { id: "final", title: "Final", due: addDays(TODAY, 6), type: "exam" },
      ]),
    ];
    const plan = buildDailyStudyPlan({ workspaces, localDate: TODAY, dailyMinutes: 240 });
    const agenda = collectAgendaItems(workspaces, TODAY);

    for (const item of plan.items.filter((i) => i.kind === "deadline")) {
      const same = agenda.find((a) => a.id === item.id);
      expect(same, item.id).toBeDefined();
      expect(same?.href).toBe(itemHref(item));
      expect(same?.date).toBe(item.dueDate);
    }
    const [countdown] = plan.details.exams;
    const exam = agenda.find((a) => a.kind === "exam");
    expect(exam?.id).toBe(countdown.id);
    expect(exam?.date).toBe(countdown.date);
    expect(exam?.href).toBe(itemHref(countdown));
  });

  it("reads a written time, the workspace as the course, and a course column the title does not name", () => {
    const ws = workspace(
      "sem",
      "Fall semester",
      [
        { id: "a", title: "Chem lab", due: `${addDays(TODAY, 1)}T09:30`, course: "Chemistry" },
        { id: "b", title: "Chemistry quiz prep", due: `${addDays(TODAY, 1)}T00:00:00`, course: "Chemistry" },
        // A zoned time is not read (its day is taken as written, as everywhere).
        { id: "c", title: "Essay", due: `${addDays(TODAY, 2)}T23:59:00Z` },
      ],
      "🍂",
    );
    const [a, b, c] = ["a", "b", "c"].map((id) => collectAgendaItems([ws], TODAY).find((i) => i.id.endsWith(`:${id}`))!);
    expect(a).toMatchObject({
      time: "09:30",
      workspaceId: "sem",
      workspaceName: "Fall semester",
      workspaceIcon: "🍂",
      subject: "Chemistry",
      source: "Assignments",
    });
    expect(b.time).toBeNull();
    expect(b.subject).toBeNull();
    expect(c).toMatchObject({ date: addDays(TODAY, 2), time: null });
  });

  it("uses the plan's weight source to tell exams apart", () => {
    const ws = workspace("bio", "Biology", [{ id: "big", title: "Unit test", due: addDays(TODAY, 3), type: "hw" }]);
    expect(collectAgendaItems([ws], TODAY)[0].kind).toBe("deadline");
    // A type set to other work wins even over a heavy weight, as in the plan.
    expect(collectAgendaItems([ws], TODAY, { weightOf: () => 40 })[0].kind).toBe("deadline");
    const untyped = workspace("bio", "Biology", [{ id: "big", title: "Unit review", due: addDays(TODAY, 3) }]);
    expect(collectAgendaItems([untyped], TODAY, { weightOf: () => 40 })[0].kind).toBe("exam");
  });

  it("shows an exam registration as a deadline tagged as a formality, never as the exam", () => {
    const ws = workspace("mathe", "Mathe", [
      { id: "anm", title: "Prüfungsanmeldung Analysis", due: addDays(TODAY, 4) },
      { id: "kl", title: "Klausur Analysis", due: addDays(TODAY, 9) },
      { id: "ub", title: "Übungsblatt 5", due: addDays(TODAY, 2) },
    ]);
    const items = collectAgendaItems([ws], TODAY);
    const byRow = (id: string) => items.find((i) => i.id.endsWith(`:${id}`))!;
    expect(byRow("anm")).toMatchObject({ id: "deadline:mathe:assignments:anm", kind: "deadline", formality: true });
    expect(byRow("kl")).toMatchObject({ kind: "exam" });
    expect(byRow("kl").formality).toBeUndefined();
    expect(byRow("ub").formality).toBeUndefined();
  });
});

function agendaItem(o: Partial<AgendaItem> & Pick<AgendaItem, "id" | "date">): AgendaItem {
  return {
    kind: "deadline",
    title: o.id,
    time: null,
    done: false,
    workspaceId: "bio",
    workspaceName: "Biology",
    workspaceIcon: null,
    subject: null,
    source: "Assignments",
    href: `/app/bio?row=${o.id}`,
    ...o,
  };
}

const COURSES: AgendaCourse[] = [
  { id: "bio", name: "Biology", icon: "🧬" },
  { id: "art", name: "Art history", icon: null },
  { id: "quiet", name: "Chemistry", icon: null },
];

describe("buildAgenda", () => {
  const items = [
    agendaItem({ id: "tomorrow-b", date: addDays(TODAY, 1), title: "B reading" }),
    agendaItem({ id: "late-new", date: addDays(TODAY, -1) }),
    agendaItem({ id: "tomorrow-a", date: addDays(TODAY, 1), title: "A reading" }),
    agendaItem({ id: "tomorrow-exam", date: addDays(TODAY, 1), kind: "exam", title: "Z midterm" }),
    agendaItem({ id: "tomorrow-9", date: addDays(TODAY, 1), time: "09:00", title: "Y lab" }),
    agendaItem({ id: "tomorrow-8", date: addDays(TODAY, 1), time: "08:15", title: "X quiz" }),
    agendaItem({ id: "late-old", date: addDays(TODAY, -9) }),
    agendaItem({ id: "art-today", date: TODAY, workspaceId: "art", workspaceName: "Art history" }),
    agendaItem({ id: "done-today", date: TODAY, done: true }),
    agendaItem({ id: "next-week", date: addDays(TODAY, 8) }),
  ];

  it("puts overdue first, then every day; exams, then timed work by time, then the rest by title", () => {
    const agenda = buildAgenda(items, COURSES, TODAY, { course: null, showDone: false });
    expect(ids(agenda.overdue)).toEqual(["late-old", "late-new"]);
    expect(agenda.days).toHaveLength(AGENDA_DAYS);
    expect(agenda.days[0].date).toBe(TODAY);
    expect(agenda.days[13].date).toBe(addDays(TODAY, 13));
    expect(ids(agenda.days[0].items)).toEqual(["art-today"]);
    expect(ids(agenda.days[1].items)).toEqual(["tomorrow-exam", "tomorrow-8", "tomorrow-9", "tomorrow-a", "tomorrow-b"]);
    expect(ids(agenda.days[8].items)).toEqual(["next-week"]);
    expect(agenda.total).toBe(9);
  });

  it("shows done work only when asked", () => {
    const hidden = buildAgenda(items, COURSES, TODAY, { course: null, showDone: false });
    expect(ids(hidden.days[0].items)).not.toContain("done-today");
    const shown = buildAgenda(items, COURSES, TODAY, { course: null, showDone: true });
    expect(ids(shown.days[0].items)).toEqual(["art-today", "done-today"]);
    expect(shown.total).toBe(10);
  });

  it("filters to one course, and treats an unknown course as all of them", () => {
    const art = buildAgenda(items, COURSES, TODAY, { course: "art", showDone: false });
    expect(art.course?.name).toBe("Art history");
    expect(art.overdue).toEqual([]);
    expect(art.total).toBe(1);
    expect(ids(art.days[0].items)).toEqual(["art-today"]);

    const unknown = buildAgenda(items, COURSES, TODAY, { course: "someone-elses", showDone: false });
    expect(unknown.course).toBeNull();
    expect(unknown.total).toBe(9);
  });

  it("offers the courses with something to show (and the chosen one), by name", () => {
    const all = buildAgenda(items, COURSES, TODAY, { course: null, showDone: false });
    expect(all.courses.map((c) => c.id)).toEqual(["art", "bio"]);
    const quiet = buildAgenda(items, COURSES, TODAY, { course: "quiet", showDone: false });
    expect(quiet.courses.map((c) => c.id)).toEqual(["art", "bio", "quiet"]);
    expect(quiet.total).toBe(0);
  });

  it("places items by the student's local day, so the same row moves across midnight", () => {
    const row = [agendaItem({ id: "essay", date: "2026-11-14" })];
    // Berlin is already on the 14th while New York is still on the 13th.
    const berlin = buildAgenda(row, COURSES, "2026-11-14", { course: null, showDone: false });
    const newYork = buildAgenda(row, COURSES, "2026-11-13", { course: null, showDone: false });
    expect(ids(berlin.days[0].items)).toEqual(["essay"]);
    expect(ids(newYork.days[1].items)).toEqual(["essay"]);
    const later = buildAgenda(row, COURSES, "2026-11-15", { course: null, showDone: false });
    expect(ids(later.overdue)).toEqual(["essay"]);
  });

  it("orders deterministically on ties", () => {
    const a = agendaItem({ id: "a", date: TODAY, title: "Same" });
    const b = agendaItem({ id: "b", date: TODAY, title: "Same" });
    expect([b, a].sort(compareAgendaItems).map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("agenda URL parameters", () => {
  it("reads ?course and ?done, and writes them back", () => {
    expect(parseAgendaParams({})).toEqual({ course: null, showDone: false });
    expect(parseAgendaParams({ course: " bio ", done: "1" })).toEqual({ course: "bio", showDone: true });
    expect(parseAgendaParams({ course: ["art", "bio"], done: ["0"] })).toEqual({ course: "art", showDone: false });
    expect(parseAgendaParams({ course: "x".repeat(201) }).course).toBeNull();
    expect(agendaHref({ course: null, showDone: false })).toBe("/app/agenda");
    expect(agendaHref({ course: "a b", showDone: true })).toBe("/app/agenda?course=a+b&done=1");
  });
});
