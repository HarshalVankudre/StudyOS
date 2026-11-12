import { describe, expect, it } from "vitest";
import type {
  Database,
  DatabaseRow,
  Flashcard,
  Page,
  QuizBlock,
  Workspace,
} from "@/lib/workspace/types";
import { addDays } from "@/lib/workspace/view-logic";
import { buildDailyStudyPlan, isReviewDay, planSourcesKey, visiblePlanItems, type PreviousPlan } from "./planner";
import { classifyExam } from "./classify";
import type { DailyStudyPlanItem } from "./types";

const TODAY = "2026-11-12";

function assignments(rows: { id: string; title: string; due: string; status?: "todo" | "done"; weight?: number; type?: "exam" | "hw" }[]): Database {
  return {
    id: "assignments",
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
          { id: "doing", label: "In progress" },
          { id: "done", label: "Done" },
        ],
      },
      { id: "weight", name: "Weight %", type: "number" },
      {
        id: "type",
        name: "Type",
        type: "select",
        options: [
          { id: "exam", label: "Exam" },
          { id: "hw", label: "Homework" },
        ],
      },
    ],
    rows: rows.map(
      (r): DatabaseRow => ({
        id: r.id,
        cells: {
          title: r.title,
          due: r.due,
          status: r.status ?? "todo",
          ...(r.weight !== undefined ? { weight: r.weight } : {}),
          ...(r.type ? { type: r.type } : {}),
        },
      }),
    ),
    views: [{ id: "table", name: "Table", type: "table" }],
  };
}

function trackerPage(): Page {
  return {
    id: "tracker",
    title: "Tracker",
    blocks: [{ id: "view", type: "database_view", databaseId: "assignments", viewId: "table" }],
  };
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return { id: "ws-1", name: "Semester HQ", pages: [], databases: [], ...overrides };
}

function card(id: string, overrides: Partial<Flashcard> = {}): Flashcard {
  return { id, front: `Q ${id}`, back: `A ${id}`, ...overrides };
}

function reviewed(id: string, dueAt: string): Flashcard {
  return card(id, { state: "review", reps: 3, intervalDays: 4, dueAt, stability: 4, difficulty: 5 });
}

function plan(workspaces: Workspace[], extra: Partial<Parameters<typeof buildDailyStudyPlan>[0]> = {}) {
  return buildDailyStudyPlan({ workspaces, localDate: TODAY, dailyMinutes: 120, ...extra });
}

describe("planner: deadlines", () => {
  it("prioritises due-today and overdue work, skips done rows, and links to the exact row", () => {
    const result = plan([
      workspace({
        pages: [trackerPage()],
        databases: [
          assignments([
            { id: "later", title: "Reading log", due: addDays(TODAY, 6) },
            { id: "today", title: "Lab report", due: TODAY },
            { id: "late", title: "Essay outline", due: addDays(TODAY, -2) },
            { id: "done", title: "Old problem set", due: TODAY, status: "done" },
          ]),
        ],
      }),
    ], { dailyMinutes: 180 });

    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain("deadline:ws-1:assignments:done");
    expect(ids.slice(0, 2)).toEqual([
      "deadline:ws-1:assignments:today",
      "deadline:ws-1:assignments:late",
    ]);
    const today = result.items[0];
    expect(today.mode).toBe("finish");
    expect(today.reason.code).toBe("due_today");
    expect(today.target).toEqual({
      workspaceId: "ws-1",
      pageId: "tracker",
      databaseId: "assignments",
      rowId: "today",
    });
    expect(today.startHere).toBe(true);
    expect(result.items.find((i) => i.id.endsWith(":late"))?.reason).toMatchObject({ code: "overdue", days: -2 });
    // Further out: a work session, not "finish".
    expect(result.items.find((i) => i.id.endsWith(":later"))?.mode).toBe("session");
  });

  it("fits the daily time and gives every item a time estimate", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      title: `Problem set ${i}`,
      due: addDays(TODAY, (i % 3) + 1),
    }));
    const result = plan([workspace({ pages: [trackerPage()], databases: [assignments(rows)] })], {
      dailyMinutes: 60,
    });
    const total = result.items.reduce((sum, i) => sum + i.minutes, 0);
    expect(total).toBeLessThanOrEqual(60);
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) expect(item.minutes).toBeGreaterThanOrEqual(10);
    expect(result.details.budgetMinutes).toBe(60);
  });

  it("is deterministic", () => {
    const ws = [workspace({ pages: [trackerPage()], databases: [assignments([{ id: "a", title: "Essay", due: addDays(TODAY, 3) }])] })];
    expect(plan(ws)).toEqual(plan(ws));
  });

  it("uses today's time override and keeps finished items when rebuilding", () => {
    const ws = [
      workspace({
        pages: [trackerPage()],
        databases: [
          assignments([
            { id: "a", title: "Essay", due: addDays(TODAY, 1) },
            { id: "b", title: "Worksheet", due: addDays(TODAY, 2) },
          ]),
        ],
      }),
    ];
    const first = plan(ws);
    const done = { ...first.items[0], completed: true };
    const rebuilt = plan(ws, { todayMinutes: 15, current: { items: [done] } });
    expect(rebuilt.details).toMatchObject({ budgetMinutes: 15, budgetOverride: true });
    expect(rebuilt.items.find((i) => i.id === done.id)?.completed).toBe(true);
    const open = rebuilt.items.filter((i) => !i.completed);
    expect(open.reduce((s, i) => s + i.minutes, 0)).toBeLessThanOrEqual(15);
  });
});

describe("planner: flashcards", () => {
  it("never counts cards with an empty side as due", () => {
    const deck: Page = {
      id: "bio",
      title: "Biology",
      blocks: [
        {
          id: "deck",
          type: "flashcards",
          title: "Cells",
          cards: [
            reviewed("ok", addDays(TODAY, -1)),
            { ...reviewed("blank-back", addDays(TODAY, -1)), back: "  " },
            { ...card("blank-front"), front: "" },
          ],
        },
        {
          id: "empty-deck",
          type: "flashcards",
          title: "Drafts",
          cards: [{ ...card("x"), back: "" }],
        },
      ],
    };
    const result = plan([workspace({ pages: [deck] })]);
    const items = result.items.filter((i) => i.kind === "flashcards");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      dueCount: 1,
      mode: "study",
      reason: { code: "cards_due", count: 1 },
      target: { workspaceId: "ws-1", pageId: "bio", blockId: "deck" },
    });
  });

  it("caps new cards per session and ranks reviews above new cards", () => {
    const pages: Page[] = [
      {
        id: "p1",
        title: "Chem",
        blocks: [{ id: "new-deck", type: "flashcards", cards: Array.from({ length: 40 }, (_, i) => card(`n${i}`)) }],
      },
      {
        id: "p2",
        title: "Bio",
        blocks: [{ id: "due-deck", type: "flashcards", cards: [reviewed("r1", TODAY)] }],
      },
    ];
    const result = plan([workspace({ pages })]);
    expect(result.items[0].target.blockId).toBe("due-deck");
    const fresh = result.items.find((i) => i.target.blockId === "new-deck");
    expect(fresh).toMatchObject({ dueCount: 10, reason: { code: "new_cards" } });
  });
});

describe("planner: roll-forward after missed days", () => {
  const ws = [
    workspace({
      pages: [trackerPage()],
      databases: [
        assignments([
          { id: "essay", title: "Essay", due: addDays(TODAY, 5) },
          { id: "lab", title: "Lab", due: addDays(TODAY, 4) },
        ]),
      ],
    }),
  ];

  function previous(items: Partial<DailyStudyPlanItem>[], date = addDays(TODAY, -3)): PreviousPlan {
    return {
      localDate: date,
      progress: {},
      items: items.map((i) => ({
        id: i.id!,
        completed: i.completed ?? false,
        kind: "deadline",
        mode: i.mode ?? "session",
        minutes: i.minutes ?? 30,
        ...(i.carry ? { carry: i.carry } : {}),
        ...(i.ledgerKey ? { ledgerKey: i.ledgerKey } : {}),
      })),
    };
  }

  it("rolls unfinished items forward with a boost and gentle bookkeeping", () => {
    const fresh = plan(ws);
    expect(fresh.items[0].id).toBe("deadline:ws-1:assignments:lab");

    const result = plan(ws, {
      previous: previous([{ id: "deadline:ws-1:assignments:essay" }]),
    });
    expect(result.items[0].id).toBe("deadline:ws-1:assignments:essay");
    expect(result.items[0].carry).toEqual({ from: addDays(TODAY, -3), count: 1 });
    expect(result.details).toMatchObject({ previousDate: addDays(TODAY, -3), carried: 1 });
  });

  it("shrinks an item to a small restart after several roll-forwards", () => {
    const result = plan(ws, {
      previous: previous([
        { id: "deadline:ws-1:assignments:essay", carry: { from: addDays(TODAY, -1), count: 2 } },
      ], addDays(TODAY, -1)),
    });
    const essay = result.items.find((i) => i.id.endsWith(":essay"))!;
    expect(essay.carry?.count).toBe(3);
    expect(essay.minutes).toBeLessThanOrEqual(15);
  });

  it("does not carry finished items, and counts finished sessions toward the effort left", () => {
    const key = "ws-1:assignments:essay";
    const before = plan(ws).items.find((i) => i.id.endsWith(":essay"))!;
    const result = plan(ws, {
      previous: previous([
        { id: "deadline:ws-1:assignments:essay", completed: true, minutes: 60, ledgerKey: key },
      ]),
    });
    const essay = result.items.find((i) => i.id.endsWith(":essay"))!;
    expect(essay.carry).toBeUndefined();
    expect(result.details.progress[key]).toBe(60);
    expect(essay.reason.effortMinutes!).toBe(before.reason.effortMinutes! - 60);
  });

  it("ignores a 'previous' plan that is not earlier than today", () => {
    const result = plan(ws, { previous: previous([{ id: "deadline:ws-1:assignments:essay" }], TODAY) });
    expect(result.items.some((i) => i.carry)).toBe(false);
    expect(result.details.previousDate).toBeUndefined();
  });
});

describe("planner: honest workload", () => {
  it("warns early when what is due cannot fit the daily time, and says what to start", () => {
    const ws = [
      workspace({
        pages: [trackerPage()],
        databases: [
          assignments([
            { id: "p1", title: "Research project", due: addDays(TODAY, 3) },
            { id: "p2", title: "History essay", due: addDays(TODAY, 4) },
            { id: "r1", title: "Reading chapter 4", due: addDays(TODAY, 2) },
          ]),
        ],
      }),
    ];
    const tight = plan(ws, { dailyMinutes: 30 });
    expect(tight.details.workload).toMatchObject({ overloaded: true });
    const w = tight.details.workload!;
    expect(w.neededMinutes).toBeGreaterThan(w.availableMinutes);
    expect(w.startToday[0]).toMatch(/Research project|History essay/);
    // The suggestion is on today's plan with a "start early" reason.
    expect(tight.items.some((i) => i.reason.code === "start_early")).toBe(true);

    const roomy = plan(ws, { dailyMinutes: 240 });
    expect(roomy.details.workload).toBeNull();
  });
});

describe("planner: exams", () => {
  function examWorkspace(examTitle: string, days: number, extra: { weight?: number; type?: "exam" } = {}) {
    const quiz: QuizBlock = {
      id: "bio-quiz",
      type: "quiz",
      title: "Biology practice",
      questions: [
        { id: "q1", kind: "true_false", prompt: "Cells have walls?", answerBool: false },
        { id: "q2", kind: "mcq", prompt: "Powerhouse?", choices: ["Mitochondria", "Golgi"], answerIndex: 0 },
      ],
    };
    return workspace({
      pages: [
        trackerPage(),
        {
          id: "bio",
          title: "Biology",
          blocks: [
            { id: "bio-deck", type: "flashcards", title: "Biology cards", cards: [reviewed("c1", TODAY), reviewed("c2", addDays(TODAY, 9))] },
            quiz,
          ],
        },
        {
          id: "chem",
          title: "Chemistry",
          blocks: [{ id: "chem-deck", type: "flashcards", title: "Chem cards", cards: [reviewed("k1", TODAY)] }],
        },
      ],
      databases: [assignments([{ id: "exam", title: examTitle, due: addDays(TODAY, days), ...extra }])],
    });
  }

  it("counts down to exams and plans review backwards, pointing at that course's deck and quiz", () => {
    const result = plan([examWorkspace("Biology midterm", 3)]);
    expect(result.details.exams).toEqual([
      expect.objectContaining({ title: "Biology midterm", days: 3, date: addDays(TODAY, 3), major: true }),
    ]);
    const deck = result.items.find((i) => i.kind === "exam");
    expect(deck).toMatchObject({
      target: { pageId: "bio", blockId: "bio-deck" },
      reason: { code: "exam_review", days: 3, examTitle: "Biology midterm" },
      mode: "study",
    });
    const quiz = result.items.find((i) => i.kind === "quiz");
    expect(quiz?.target.blockId).toBe("bio-quiz");
    // The plain review item for the Biology deck is folded into exam prep;
    // the unrelated Chemistry deck stays a normal review.
    expect(result.items.filter((i) => i.target.blockId === "bio-deck")).toHaveLength(1);
    expect(result.items.some((i) => i.kind === "flashcards" && i.target.blockId === "chem-deck")).toBe(true);
    // An exam is never a plain deadline.
    expect(result.items.some((i) => i.kind === "deadline")).toBe(false);
  });

  it("spaces review days backwards from the exam", () => {
    expect([1, 2, 3, 5, 7, 10, 14, 21].every((d) => isReviewDay(d, false))).toBe(true);
    expect([4, 6, 8, 9, 15].some((d) => isReviewDay(d, false))).toBe(false);
    expect(isReviewDay(6, true)).toBe(true);

    const offDay = plan([examWorkspace("Quiz on cells (exam)", 4)]);
    expect(offDay.items.some((i) => i.kind === "exam" || i.kind === "quiz")).toBe(false);
    expect(offDay.details.exams).toHaveLength(1);

    const examDay = plan([examWorkspace("Biology exam", 0)]);
    expect(examDay.items[0]).toMatchObject({ kind: "exam", reason: { code: "exam_today" } });
  });

  it("treats a heavily weighted row as a major exam", () => {
    const result = plan([examWorkspace("Biology project", 6, { weight: 30 })]);
    expect(result.details.exams[0]).toMatchObject({ major: true });
    expect(result.items.some((i) => i.kind === "exam")).toBe(true);
  });

  it("reviews from the exam row itself when the course has no deck or quiz", () => {
    const ws = workspace({
      pages: [trackerPage()],
      databases: [assignments([{ id: "e", title: "Statistics final", due: addDays(TODAY, 2) }])],
    });
    const item = plan([ws]).items.find((i) => i.kind === "exam");
    expect(item).toMatchObject({
      mode: "session",
      target: { databaseId: "assignments", rowId: "e" },
      reason: { code: "exam_review", days: 2 },
    });
  });

  it("detects exams by title or type in the supported languages", () => {
    const db = assignments([{ id: "x", title: "x", due: TODAY }]);
    const row = db.rows[0];
    const isExam = (title: string) => classifyExam(db, { ...row, cells: { ...row.cells, type: null } }, title, null).isExam;
    for (const title of [
      "Biology midterm",
      "Final exam",
      "Examen parcial de física",
      "Matheklausur",
      "Prüfung Statistik",
      "Partiel d’économie",
      "Esame di storia",
      "Prova de cálculo",
      "Tentamen statistiek",
      "期末考试",
      "中間試験",
      "امتحان الكيمياء",
    ]) {
      expect(isExam(title), title).toBe(true);
    }
    for (const title of ["Example sheet", "Final draft of essay", "Lab report", "Test plan draft"]) {
      expect(isExam(title), title).toBe(false);
    }
    expect(classifyExam(db, { ...row, cells: { ...row.cells, type: "exam" } }, "Unit 3", null).isExam).toBe(true);
  });

  it("an explicit non-exam type wins over a heavy weight and an exam-like title", () => {
    const db = assignments([{ id: "x", title: "x", due: TODAY }]);
    const row = db.rows[0];
    const typed = (type: string | null, title: string, weight: number | null) =>
      classifyExam(db, { ...row, cells: { ...row.cells, type } }, title, weight);
    // A 25 % homework is big homework, not an exam.
    expect(typed("hw", "Homework 5", 25)).toEqual({ isExam: false, major: false });
    expect(typed("hw", "Final problem set", 30).isExam).toBe(false);
    // Without a type, a heavy weight still marks a major assessment.
    expect(typed(null, "Unit 5 assessment", 25)).toEqual({ isExam: true, major: true });
    expect(typed("exam", "Unit 5", 25)).toEqual({ isExam: true, major: true });
  });
});

describe("planner: knowing when a plan is out of date", () => {
  const base = () =>
    workspace({
      pages: [trackerPage()],
      databases: [
        assignments([
          { id: "a", title: "Essay", due: TODAY },
          { id: "b", title: "Lab", due: addDays(TODAY, 2) },
        ]),
      ],
    });

  it("changes when workspaces come and go or rows are added, not when a row is edited", () => {
    const key = planSourcesKey([base()]);
    expect(planSourcesKey([base()])).toBe(key);
    // Order of workspaces and rows does not matter.
    const reordered = base();
    reordered.databases[0].rows.reverse();
    expect(planSourcesKey([reordered])).toBe(key);
    expect(planSourcesKey([base(), workspace({ id: "ws-2" })])).toBe(
      planSourcesKey([workspace({ id: "ws-2" }), base()]),
    );
    // Created / duplicated / restored, and trashed.
    expect(planSourcesKey([base(), workspace({ id: "ws-2" })])).not.toBe(key);
    expect(planSourcesKey([])).not.toBe(key);
    // A deadline import adds rows.
    const imported = base();
    imported.databases[0].rows.push({ id: "c", cells: { title: "Quiz", due: TODAY, status: "todo" } });
    expect(planSourcesKey([imported])).not.toBe(key);
    // Ticking a row off or moving its date is reconcile's job, not a re-plan.
    const edited = base();
    edited.databases[0].rows[0].cells.status = "done";
    edited.databases[0].rows[1].cells.due = addDays(TODAY, 5);
    expect(planSourcesKey([edited])).toBe(key);
  });

  it("records the fingerprint on the plan it builds", () => {
    expect(plan([base()]).details.sources).toBe(planSourcesKey([base()]));
  });

  it("a refresh counts what is already done against today's time", () => {
    const done: DailyStudyPlanItem = {
      ...plan([base()]).items[0],
      id: "task:elsewhere",
      completed: true,
      minutes: 50,
    };
    const fresh = plan([base()], { dailyMinutes: 60, current: { items: [done] } });
    const refreshed = plan([base()], { dailyMinutes: 60, current: { items: [done] }, refresh: true });
    const open = (items: DailyStudyPlanItem[]) =>
      items.filter((i) => !i.completed).reduce((sum, i) => sum + i.minutes, 0);
    expect(open(fresh.items)).toBeGreaterThan(10);
    expect(open(refreshed.items)).toBeLessThanOrEqual(10);
    expect(refreshed.items.find((i) => i.id === "task:elsewhere")).toMatchObject({ completed: true });
  });

  it("shows nothing from workspaces that are not in the list", () => {
    const items = plan([base(), workspace({ id: "ws-2", pages: [trackerPage()], databases: [assignments([{ id: "x", title: "Old", due: TODAY }])] })]).items;
    expect(items.some((i) => i.target.workspaceId === "ws-2")).toBe(true);
    expect(visiblePlanItems(items, [base()]).every((i) => i.target.workspaceId === "ws-1")).toBe(true);
  });
});

describe("planner: due reviews share the day with deadlines (QA round 2)", () => {
  const hwDueTomorrow = () =>
    workspace({
      pages: [trackerPage()],
      databases: [assignments([{ id: "hw9", title: "Homework 9 (eigenvalues)", due: addDays(TODAY, 1), weight: 10 }])],
    });
  const deckPage = (cards: Flashcard[]): Page => ({
    id: "kit",
    title: "Lecture 7 kit",
    blocks: [{ id: "deck", type: "flashcards", title: "Lecture 7 cards", cards }],
  });

  it("a one-hour day with homework due tomorrow and 20 new cards includes the cards", () => {
    const ws = hwDueTomorrow();
    ws.pages.push(deckPage(Array.from({ length: 20 }, (_, i) => card(`n${i}`))));
    const result = plan([ws], { dailyMinutes: 60 });
    const kinds = result.items.map((i) => i.kind);
    expect(kinds).toContain("deadline");
    expect(kinds).toContain("flashcards");
    // The homework still comes first.
    expect(result.items[0].kind).toBe("deadline");
    expect(result.items[0].startHere).toBe(true);
    const total = result.items.reduce((sum, i) => sum + i.minutes, 0);
    expect(total).toBeLessThanOrEqual(60);
    expect(total).toBeGreaterThanOrEqual(55);
  });

  it("a one-hour day with 60 reviews due holds about a third of the day for them", () => {
    const ws = hwDueTomorrow();
    ws.pages.push(deckPage(Array.from({ length: 60 }, (_, i) => reviewed(`r${i}`, TODAY))));
    const result = plan([ws], { dailyMinutes: 60 });
    const deck = result.items.find((i) => i.kind === "flashcards")!;
    expect(deck).toBeDefined();
    expect(deck.minutes).toBeGreaterThanOrEqual(10);
    expect(deck.minutes).toBeLessThanOrEqual(20);
    expect(deck.reason.code).toBe("cards_due");
    // Bounded and honest: the cards planned are what fits, and the rest are named.
    expect(deck.dueCount).toBe(deck.reason.count);
    expect(deck.dueCount!).toBeLessThan(60);
    expect(deck.reason.readyCount).toBe(60);
  });

  it("a deck that fits completely carries no 'more waiting' count", () => {
    const ws = workspace({ pages: [deckPage([reviewed("a", TODAY), reviewed("b", TODAY)])] });
    const deck = plan([ws], { dailyMinutes: 60 }).items.find((i) => i.kind === "flashcards")!;
    expect(deck.dueCount).toBe(2);
    expect(deck.reason.readyCount).toBeUndefined();
  });

  it("a huge backlog is bounded to one session", () => {
    const ws = workspace({ pages: [deckPage(Array.from({ length: 400 }, (_, i) => reviewed(`r${i}`, TODAY)))] });
    const deck = plan([ws], { dailyMinutes: 240 }).items.find((i) => i.kind === "flashcards")!;
    expect(deck.minutes).toBeLessThanOrEqual(30);
    expect(deck.dueCount!).toBeLessThanOrEqual(50);
    expect(deck.reason.readyCount).toBe(400);
  });

  it("very short days keep plain priority (the homework due tomorrow wins)", () => {
    const ws = hwDueTomorrow();
    ws.pages.push(deckPage(Array.from({ length: 24 }, (_, i) => reviewed(`r${i}`, TODAY))));
    const result = plan([ws], { dailyMinutes: 15 });
    expect(result.items[0].kind).toBe("deadline");
  });

  it("uses the time the student has: a session grows toward its remaining effort", () => {
    const ws = workspace({
      pages: [trackerPage()],
      databases: [assignments([{ id: "proj", title: "Research essay", due: addDays(TODAY, 6), weight: 10 }])],
    });
    const result = plan([ws], { dailyMinutes: 90 });
    const project = result.items.find((i) => i.kind === "deadline")!;
    const spread = plan([ws], { dailyMinutes: 15 }).items[0];
    expect(project.minutes).toBeGreaterThan(spread.minutes);
    expect(project.minutes).toBeLessThanOrEqual(90);
    expect(project.minutes).toBeLessThanOrEqual(project.reason.effortMinutes ?? 0);
  });
});

describe("planner: exam countdowns and the heads-up (QA round 2)", () => {
  function examsDb(): Database {
    return {
      id: "exams",
      name: "Exams",
      properties: [
        { id: "title", name: "Name", type: "text" },
        { id: "due", name: "Date", type: "date" },
        {
          id: "course",
          name: "Course",
          type: "select",
          options: [
            { id: "math", label: "MATH 221" },
            { id: "chem", label: "CHEM 210" },
          ],
        },
        { id: "type", name: "Type", type: "select", options: [{ id: "exam", label: "Exam" }] },
      ],
      rows: [
        { id: "f1", cells: { title: "Final exam", due: addDays(TODAY, 29), course: "math", type: "exam" } },
        { id: "f2", cells: { title: "Final exam", due: addDays(TODAY, 34), course: "chem", type: "exam" } },
        { id: "m2", cells: { title: "CHEM 210 Midterm 2", due: addDays(TODAY, 21), course: "chem", type: "exam" } },
      ],
      views: [{ id: "t", name: "Table", type: "table" }],
    };
  }

  it("names the course on each exam chip, unless the title already does", () => {
    const { exams } = plan([workspace({ databases: [examsDb()] })]).details;
    const byId = Object.fromEntries(exams.map((e) => [e.id.split(":").pop(), e]));
    expect(byId.f1.course).toBe("MATH 221");
    expect(byId.f2.course).toBe("CHEM 210");
    expect(byId.m2.course).toBeUndefined();
  });

  it("an exam the heads-up says to start today is on the plan", () => {
    const db = examsDb();
    db.rows = [{ id: "mid", cells: { title: "Midterm", due: addDays(TODAY, 4), course: "math", type: "exam" } }];
    const result = plan([workspace({ databases: [db] })], { dailyMinutes: 15 });
    const workload = result.details.workload;
    if (workload?.overloaded) {
      for (const title of workload.startToday) {
        expect(result.items.some((i) => i.title === title || i.reason.examTitle === title)).toBe(true);
      }
    }
    expect(result.items.length).toBeGreaterThan(0);
  });
});

describe("visiblePlanDetails (QA round 2: Today contradicted itself after a trash)", () => {
  it("keeps a plan built from these workspaces as it is, and strips a stale one", async () => {
    const { visiblePlanDetails } = await import("./planner");
    const kept = workspace({ id: "ws-1", pages: [trackerPage()], databases: [assignments([{ id: "m", title: "Midterm", due: addDays(TODAY, 4), type: "exam" }])] });
    const trashed = workspace({ id: "ws-2", pages: [trackerPage()], databases: [assignments([{ id: "f", title: "Final exam", due: addDays(TODAY, 9), type: "exam" }, { id: "h", title: "Huge project", due: addDays(TODAY, 3), weight: 20 }])] });
    const built = plan([kept, trashed], { dailyMinutes: 15 });
    expect(built.details.exams.some((e) => e.target.workspaceId === "ws-2")).toBe(true);
    expect(visiblePlanDetails(built.details, [kept, trashed])).toBe(built.details);
    const shown = visiblePlanDetails(built.details, [kept]);
    expect(shown.exams.every((e) => e.target.workspaceId === "ws-1")).toBe(true);
    expect(shown.workload).toBeNull();
  });
});
