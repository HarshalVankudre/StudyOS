import { describe, expect, it } from "vitest";
import type {
  Database,
  DatabaseRow,
  Flashcard,
  Page,
  QuizBlock,
  Workspace,
} from "@/lib/workspace/types";
import { addDays, dayDiff } from "@/lib/workspace/view-logic";
import { buildDailyStudyPlan, isReviewDay, planSourcesKey, visiblePlanItems, type PreviousPlan } from "./planner";
import {
  classifyExam,
  estimateEffortMinutes,
  examPrepTotalMinutes,
  isFormality,
  rowWeight,
} from "./classify";
import { gradesWeightResolver } from "./grades-hook";
import { itemNotes } from "./present";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isFormalityReason, type DailyStudyPlanItem } from "./types";

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

  // Review round 4: the planner had a stricter rule than the quiz block, so a
  // quiz whose questions carry a blank extra choice was never planned.
  it("plans a quiz the quiz block can run, blank extra choices included", () => {
    const ws = examWorkspace("Biology midterm", 3);
    const quiz = ws.pages[1].blocks[1] as QuizBlock;
    quiz.questions = [
      { id: "q1", kind: "mcq", prompt: "Powerhouse?", choices: ["Mitochondria", "Golgi", ""], answerIndex: 0 },
    ];
    expect(plan([ws]).items.find((i) => i.kind === "quiz")?.target.blockId).toBe("bio-quiz");
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

  // QA round 3: rows of a generated "Finals Planner" (study sessions) were listed as exams.
  function finalsPlanner(): Database {
    return {
      id: "db-finals",
      name: "Finals Planner",
      properties: [
        { id: "f-name", name: "Session", type: "text" },
        { id: "f-date", name: "Date", type: "date" },
        { id: "f-course", name: "Course", type: "select", options: [{ id: "fc-chem", label: "CHEM 210" }] },
        { id: "f-done", name: "Done", type: "checkbox" },
      ],
      rows: [
        { id: "s1", cells: { "f-name": "SN1/SN2 + E1/E2 mechanism drills", "f-date": addDays(TODAY, 2), "f-course": "fc-chem", "f-done": false } },
        { id: "s2", cells: { "f-name": "NMR spectroscopy practice", "f-date": addDays(TODAY, 3), "f-course": "fc-chem", "f-done": false } },
        { id: "s3", cells: { "f-name": "CHEM 210 final exam", "f-date": addDays(TODAY, 20), "f-course": "fc-chem", "f-done": false } },
      ],
      views: [{ id: "t", name: "Table", type: "table" }],
    };
  }

  it("never makes a row an exam because of the name of its list", () => {
    const db = finalsPlanner();
    expect(classifyExam(db, db.rows[0], "SN1/SN2 + E1/E2 mechanism drills", null).isExam).toBe(false);
    expect(classifyExam(db, db.rows[1], "NMR spectroscopy practice", null).isExam).toBe(false);
    // A row that says it is an exam still is one, wherever it sits.
    expect(classifyExam(db, db.rows[2], "CHEM 210 final exam", null)).toEqual({ isExam: true, major: true });

    const result = plan([workspace({ pages: [trackerPage()], databases: [db] })]);
    expect(result.details.exams.map((e) => e.title)).toEqual(["CHEM 210 final exam"]);
    // The study sessions are planned as work, not exam countdowns.
    expect(result.items.some((i) => i.title.includes("mechanism drills") && i.kind === "exam")).toBe(false);
  });

  it("reads an exam from the grading category a row counts in", () => {
    const db: Database = {
      id: "graded",
      name: "Coursework",
      properties: [
        { id: "title", name: "Item", type: "text" },
        { id: "due", name: "Due", type: "date" },
        { id: "course", name: "Course", type: "select", options: [{ id: "phys", label: "PHYS 201" }] },
      ],
      rows: [
        { id: "m", cells: { title: "Sitting 2 (ch. 7–10)", due: addDays(TODAY, 5), course: "phys" } },
        { id: "p", cells: { title: "Problem Set 7", due: addDays(TODAY, 5), course: "phys" } },
      ],
      views: [{ id: "t", name: "Table", type: "table" }],
      grading: {
        categories: [
          { id: "cat-mid", course: "phys", name: "Midterms", weight: 40, expectedCount: 2 },
          { id: "cat-ps", course: "phys", name: "Problem sets", weight: 20 },
        ],
        assign: { m: "cat-mid" },
      },
    };
    expect(classifyExam(db, db.rows[0], "Sitting 2 (ch. 7–10)", null).isExam).toBe(true);
    expect(classifyExam(db, db.rows[1], "Problem Set 7", null).isExam).toBe(false);
  });

  // Review round 4: a weight of 1 was read as the fraction 1.0 (100 %), so a
  // 1 % discussion post became a major exam with 480 minutes of prep.
  it("reads a weight of 1 as 1 %, not as a fraction of 100 %", () => {
    const db = assignments([{ id: "d", title: "Discussion post 3", due: addDays(TODAY, 5), weight: 1 }]);
    const ws = workspace({ pages: [trackerPage()], databases: [db] });
    expect(rowWeight(db, db.rows[0])).toBe(1);
    expect(gradesWeightResolver()(ws, db, db.rows[0])).toBe(1);
    expect(classifyExam(db, db.rows[0], "Discussion post 3", 1).isExam).toBe(false);

    const result = plan([ws]);
    expect(result.details.exams).toEqual([]);
    expect(result.items.find((i) => i.target.rowId === "d")).toMatchObject({ kind: "deadline", weight: 1 });
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

// ---------------------------------------------------------------------------
// German universities: administrative deadlines (Fristen) and module exams
// (one Klausur decides a module; a semester ends in a Klausurenphase).

const MODULES = [
  { id: "ana", label: "Analysis I" },
  { id: "la", label: "Lineare Algebra" },
  { id: "stat", label: "Statistik" },
  { id: "prog", label: "Programmierung" },
  { id: "phys", label: "Experimentalphysik" },
];

interface GermanRow {
  id: string;
  title: string;
  due: string;
  course?: string;
  art?: "klausur" | "frist" | "uebung";
  ects?: number;
  hours?: number;
}

/** A student's "Prüfungen & Fristen" table: module, type, a done checkbox. */
function fristenDb(rows: GermanRow[], extra: Database["properties"] = []): Database {
  return {
    id: "pf",
    name: "Prüfungen & Fristen",
    properties: [
      { id: "title", name: "Titel", type: "text" },
      { id: "due", name: "Datum", type: "date" },
      { id: "course", name: "Modul", type: "select", options: MODULES },
      {
        id: "art",
        name: "Art",
        type: "select",
        options: [
          { id: "klausur", label: "Klausur" },
          { id: "frist", label: "Fristen" },
          { id: "uebung", label: "Übung" },
        ],
      },
      { id: "done", name: "Erledigt", type: "checkbox" },
      ...extra,
    ],
    rows: rows.map(
      (r): DatabaseRow => ({
        id: r.id,
        cells: {
          title: r.title,
          due: r.due,
          done: false,
          ...(r.course ? { course: r.course } : {}),
          ...(r.art ? { art: r.art } : {}),
          ...(r.ects !== undefined ? { ects: r.ects } : {}),
          ...(r.hours !== undefined ? { hours: r.hours } : {}),
        },
      }),
    ),
    views: [{ id: "t", name: "Tabelle", type: "table" }],
  };
}

/** The module list with credit points (Experimentalphysik has none written down). */
function modulesDb(): Database {
  return {
    id: "module",
    name: "Module",
    properties: [
      { id: "name", name: "Modul", type: "text" },
      { id: "ects", name: "ECTS", type: "number" },
    ],
    rows: [
      { id: "m1", cells: { name: "Analysis I", ects: 10 } },
      { id: "m2", cells: { name: "Lineare Algebra", ects: 9 } },
      { id: "m3", cells: { name: "Statistik", ects: 5 } },
      { id: "m4", cells: { name: "Programmierung", ects: 6 } },
    ],
    views: [{ id: "t", name: "Tabelle", type: "table" }],
  };
}

describe("planner: German administrative deadlines (Fristen)", () => {
  const db = fristenDb([{ id: "x", title: "x", due: "2027-01-10" }]);
  const row = db.rows[0];
  const read = (title: string, art?: GermanRow["art"]) => {
    const r = { ...row, cells: { ...row.cells, ...(art ? { art } : {}) } };
    const exam = classifyExam(db, r, title, null);
    if (isFormality(db, r, title)) {
      expect(exam, title).toEqual({ isExam: false, major: false });
      return "formality";
    }
    return exam.module ? "module exam" : exam.isExam ? "exam" : "coursework";
  };

  it("reads registrations, deregistrations and fees as formalities, never as exams", () => {
    const table: Record<string, string> = {
      "Prüfungsanmeldung Mathe 1": "formality",
      Klausuranmeldung: "formality",
      "Klausur-Anmeldung Analysis": "formality",
      "Anmeldung Klausur Analysis": "formality",
      "Abmeldefrist Statistik-Klausur": "formality",
      "Abmeldung von der Prüfung": "formality",
      "Rückmeldung Sommersemester": "formality",
      "Rückmeldung zum Sommersemester": "formality",
      "Rückmeldung": "formality",
      "Rückmeldung zum Entwurf": "coursework",
      "Rückmeldung geben: Referat Gruppe 2": "coursework",
      "Rueckmeldung SoSe 27": "formality",
      "Semesterbeitrag überweisen": "formality",
      "BAföG-Antrag stellen": "formality",
      "Einschreibung Seminar": "formality",
      "Klausur Mathe (Anmeldung bis 15.1.)": "module exam",
      "Klausur Lineare Algebra": "module exam",
      "Mündliche Prüfung Physik": "module exam",
      "Probeklausur Analysis": "exam",
      "Abgabefrist Hausarbeit": "coursework",
      "Übungsblatt 3": "coursework",
      "Prüfungsvorleistung Physik": "coursework",
      "Bewerbungsschreiben analysieren": "coursework",
      "Exam registration closes": "formality",
      "Register for final exam": "formality",
      "Pay semester fee": "formality",
      "Final exam": "exam",
      "Final exam, register by Friday": "exam",
      "Physical intuition worksheet": "coursework",
    };
    for (const [title, expected] of Object.entries(table)) expect(read(title), title).toBe(expected);
  });

  it("a type naming a formality wins over the title; a module type marks a module exam", () => {
    expect(read("Studierendenausweis verlängern", "frist")).toBe("formality");
    expect(read("Prüfungsanmeldung", "klausur")).toBe("formality");
    expect(read("Analysis I", "klausur")).toBe("module exam");
    // A heavy weight alone marks a module exam; a US-style 35 % final does not.
    const r = { ...row, cells: { ...row.cells } };
    expect(classifyExam(db, r, "Endterm", 60)).toEqual({ isExam: true, major: true, module: true });
    expect(classifyExam(db, r, "Final exam", 35)).toEqual({ isExam: true, major: true });
  });

  it("gives a formality a fixed ten minutes, whatever else the row says", () => {
    const withHours = fristenDb(
      [{ id: "a", title: "Rückmeldung Sommersemester", due: "2027-02-15", hours: 3 }],
      [{ id: "hours", name: "Aufwand (Stunden)", type: "number" }],
    );
    expect(estimateEffortMinutes(withHours, withHours.rows[0], "Rückmeldung Sommersemester", null)).toBe(10);
    expect(estimateEffortMinutes(db, row, "Semesterbeitrag überweisen", 30)).toBe(10);
  });

  it("plans a formality as one short item to finish, guaranteed in its last three days", () => {
    const today = "2027-01-07";
    const ws = workspace({
      id: "ws-de",
      pages: [{ id: "home", title: "Semester", blocks: [{ id: "v", type: "database_view", databaseId: "pf", viewId: "t" }] }],
      databases: [
        fristenDb([
          { id: "anm", title: "Prüfungsanmeldung Wintersemester", due: "2027-01-10" },
          { id: "far", title: "Rückmeldung Sommersemester", due: "2027-02-15" },
          // A heavy day of coursework that would otherwise fill all the time.
          ...Array.from({ length: 14 }, (_, i) => ({ id: `u${i}`, title: `Hausarbeit Kapitel ${i}`, due: "2027-01-08" })),
        ]),
      ],
    });
    const result = buildDailyStudyPlan({ workspaces: [ws], localDate: today, dailyMinutes: 60 });
    const item = result.items.find((i) => i.target.rowId === "anm");
    expect(item).toMatchObject({
      kind: "deadline",
      mode: "finish",
      minutes: 10,
      reason: { code: "formality_soon", days: 3 },
    });
    expect(result.items.reduce((s, i) => s + i.minutes, 0)).toBeLessThanOrEqual(60);
    // Further out than a week: not on the plan yet. Never an exam countdown.
    expect(result.items.some((i) => i.target.rowId === "far")).toBe(false);
    expect(result.details.exams).toEqual([]);
    // Never shrunk to a restart, however long it waits.
    const waiting = { ...item!, carry: { from: "2027-01-03", count: 4 } };
    const notes = itemNotes(waiting, getDictionary("de").today, "de");
    expect(notes.join(" ")).not.toContain("einzusteigen");
    expect(notes.join(" ")).toContain("Verschoben");

    // Rebuilding a long day keeps what is done and never stores more than 12 items.
    const long = buildDailyStudyPlan({ workspaces: [ws], localDate: today, dailyMinutes: 360 });
    const done = long.items.map((i) => ({ ...i, completed: true }));
    const rebuilt = buildDailyStudyPlan({ workspaces: [ws], localDate: today, dailyMinutes: 360, current: { items: done } });
    expect(rebuilt.items.filter((i) => i.completed)).toHaveLength(done.length);
    expect(rebuilt.items.length).toBe(12);
  });
});

describe("planner: module exams and the German Klausurenphase", () => {
  it("sizes module exam preparation by the estimate, else 6 h per ECTS (10-60 h), else 30 h", () => {
    const db = fristenDb(
      [
        { id: "a", title: "Klausur Analysis I", due: "2027-02-03", course: "ana" },
        { id: "s", title: "Klausur Statistik", due: "2027-02-11", course: "stat" },
        { id: "p", title: "Klausur Experimentalphysik", due: "2027-02-21", course: "phys" },
        { id: "own1", title: "Modulprüfung Ethik", due: "2027-02-21", ects: 1 },
        { id: "own15", title: "Modulprüfung Großprojekt", due: "2027-02-21", ects: 15 },
        { id: "est", title: "Staatsexamen Teil 1", due: "2027-03-01", hours: 40 },
        { id: "us", title: "Final exam", due: "2027-02-21" },
      ],
      [
        { id: "ects", name: "ECTS", type: "number" },
        { id: "hours", name: "Lernaufwand (Stunden)", type: "number" },
      ],
    );
    const ws = workspace({ id: "ws-de", databases: [db, modulesDb()] });
    const total = (id: string, title: string, weight: number | null = null) => {
      const r = db.rows.find((x) => x.id === id)!;
      return examPrepTotalMinutes(ws, db, r, classifyExam(db, r, title, weight), weight);
    };
    expect(total("a", "Klausur Analysis I")).toBe(60 * 60); // 10 ECTS
    expect(total("s", "Klausur Statistik")).toBe(30 * 60); // 5 ECTS
    expect(total("p", "Klausur Experimentalphysik")).toBe(30 * 60); // none written down
    expect(total("own1", "Modulprüfung Ethik")).toBe(10 * 60); // clamped up
    expect(total("own15", "Modulprüfung Großprojekt")).toBe(60 * 60); // clamped down
    expect(total("est", "Staatsexamen Teil 1")).toBe(40 * 60); // the student's own estimate
    // A US-style final keeps its old size.
    expect(total("us", "Final exam")).toBe(360);
    expect(total("us", "Final exam", 35)).toBe(480);
  });

  it("spaces module exam sessions: twice a week from 42 days, every other day from 28, daily in the last 14", () => {
    const days = Array.from({ length: 50 }, (_, i) => i).filter((d) => isReviewDay(d, true, true));
    expect(days.filter((d) => d > 28)).toEqual([31, 35, 38, 42]);
    expect(days.filter((d) => d > 14 && d <= 28)).toEqual([16, 18, 20, 22, 24, 26, 28]);
    expect(days.filter((d) => d <= 14)).toEqual(Array.from({ length: 15 }, (_, i) => i));
    // Other exams keep their rhythm.
    expect([1, 2, 3, 5, 7, 10, 14, 21].every((d) => isReviewDay(d, false))).toBe(true);
    expect(isReviewDay(28, false)).toBe(false);
  });

  /**
   * A winter semester: five Klausuren from 3 to 21 Feb, the exam registration
   * closing on 10 Jan, deregistration a week before each exam, the
   * Rückmeldung on 15 Feb, weekly Übungsblätter in January, 4 hours a day.
   * Walk the calendar day by day, ticking everything off (the registration
   * only on 9 Jan), the way the student would.
   */
  function semesterWorkspace(): Workspace {
    const klausuren: GermanRow[] = [
      { id: "k-ana", title: "Klausur Analysis I", due: "2027-02-03", course: "ana" },
      { id: "k-la", title: "Klausur Lineare Algebra", due: "2027-02-08", course: "la" },
      { id: "k-stat", title: "Statistik-Klausur", due: "2027-02-11", course: "stat" },
      { id: "k-prog", title: "Klausur Programmierung", due: "2027-02-16", course: "prog" },
      { id: "k-phys", title: "Klausur Experimentalphysik", due: "2027-02-21", course: "phys" },
    ];
    const fristen: GermanRow[] = [
      { id: "anm", title: "Prüfungsanmeldung Wintersemester", due: "2027-01-10" },
      { id: "ab-ana", title: "Abmeldefrist Analysis-Klausur", due: "2027-01-27", course: "ana" },
      { id: "ab-la", title: "Abmeldung Klausur Lineare Algebra", due: "2027-02-01", course: "la" },
      { id: "ab-stat", title: "Abmeldefrist Statistik", due: "2027-02-04", course: "stat" },
      { id: "ab-prog", title: "Abmeldung Programmierung", due: "2027-02-09", course: "prog" },
      { id: "ab-phys", title: "Abmeldefrist Experimentalphysik", due: "2027-02-14", course: "phys" },
      { id: "rueck", title: "Rückmeldung Sommersemester", due: "2027-02-15" },
    ];
    const blaetter: GermanRow[] = [
      { id: "ub-9", title: "Übungsblatt 9", due: "2027-01-08", course: "ana" },
      { id: "ub-10", title: "Übungsblatt 10", due: "2027-01-15", course: "ana" },
      { id: "ub-11", title: "Übungsblatt 11", due: "2027-01-22", course: "ana" },
      { id: "la-7", title: "Übungsblatt 7", due: "2027-01-12", course: "la" },
      { id: "la-8", title: "Übungsblatt 8", due: "2027-01-19", course: "la" },
    ];
    return workspace({
      id: "ws-de",
      name: "WiSe 26/27",
      pages: [{ id: "home", title: "Semester", blocks: [{ id: "v", type: "database_view", databaseId: "pf", viewId: "t" }] }],
      databases: [fristenDb([...klausuren, ...fristen, ...blaetter]), modulesDb()],
    });
  }

  const START = "2026-12-20";
  const END = "2027-02-21";
  const EXAMS = {
    "k-ana": "2027-02-03",
    "k-la": "2027-02-08",
    "k-stat": "2027-02-11",
    "k-prog": "2027-02-16",
    "k-phys": "2027-02-21",
  } as const;
  const FRISTEN = ["anm", "ab-ana", "ab-la", "ab-stat", "ab-prog", "ab-phys", "rueck"];

  function walk() {
    const ws = semesterWorkspace();
    const db = ws.databases[0];
    const plans = new Map<string, ReturnType<typeof buildDailyStudyPlan>>();
    let previous: PreviousPlan | null = null;
    for (let day = START; day <= END; day = addDays(day, 1)) {
      const built = buildDailyStudyPlan({ workspaces: [ws], localDate: day, dailyMinutes: 240, previous });
      plans.set(day, built);
      // Everything is done, except the registration, which waits until 9 Jan.
      const items = built.items.map((item) => ({
        ...item,
        completed: item.target.rowId !== "anm" || day >= "2027-01-09",
      }));
      for (const item of items) {
        // Finishing an item ticks its row off, as the app does.
        const rowRef = item.mode === "finish" && item.completed ? db.rows.find((r) => r.id === item.target.rowId) : null;
        if (rowRef) rowRef.cells.done = true;
      }
      previous = { localDate: day, items, progress: built.details.progress };
    }
    return plans;
  }
  const plans = walk();
  const each = (fn: (day: string, plan: ReturnType<typeof buildDailyStudyPlan>) => void) => {
    for (const [day, plan] of plans) fn(day, plan);
  };
  const sessionsFor = (plan: ReturnType<typeof buildDailyStudyPlan>, rowId: string) =>
    plan.items.filter((i) => i.target.rowId === rowId || i.ledgerKey === `ws-de:pf:${rowId}`).filter((i) => i.kind === "exam");

  it("puts the exam registration on the plan from a week before, and every day of its last days until done", () => {
    const onPlan = (day: string) => plans.get(day)!.items.some((i) => i.target.rowId === "anm");
    expect(onPlan("2027-01-02")).toBe(false);
    expect(onPlan("2027-01-03")).toBe(true);
    for (const day of ["2027-01-07", "2027-01-08", "2027-01-09"]) expect(onPlan(day), day).toBe(true);
    for (const day of ["2027-01-10", "2027-01-11", "2027-01-20"]) expect(onPlan(day), day).toBe(false);
  });

  it("never treats a formality as an exam, a work session or a countdown", () => {
    each((day, plan) => {
      for (const id of FRISTEN) {
        expect(plan.details.exams.some((e) => e.target.rowId === id), `${day} ${id}`).toBe(false);
        for (const item of plan.items.filter((i) => i.target.rowId === id || i.ledgerKey?.endsWith(`:${id}`))) {
          expect(item, `${day} ${id}`).toMatchObject({ kind: "deadline", mode: "finish", minutes: 10 });
          expect(isFormalityReason(item.reason.code), `${day} ${id}`).toBe(true);
        }
      }
    });
  });

  it("plans every module exam from 42 days out at its rhythm, and never exceeds the day's time", () => {
    each((day, plan) => {
      expect(plan.items.reduce((s, i) => s + i.minutes, 0), day).toBeLessThanOrEqual(240);
      for (const [id, date] of Object.entries(EXAMS)) {
        const days = dayDiff(day, date);
        const has = sessionsFor(plan, id).length > 0;
        if (days < 0 || days > 42) expect(has, `${day} ${id} (${days} days)`).toBe(false);
        else expect(has, `${day} ${id} (${days} days)`).toBe(isReviewDay(days, true, true));
      }
    });
    // A Klausur is a module exam: countdown marked major, review sessions of real length.
    expect(plans.get("2027-01-20")!.details.exams.find((e) => e.target.rowId === "k-ana")).toMatchObject({ major: true, days: 14 });
  });

  it("in the last two weeks every exam gets a daily session, and the nearest gets the most", () => {
    each((day, plan) => {
      const upcoming = Object.entries(EXAMS)
        .map(([id, date]) => ({ id, days: dayDiff(day, date) }))
        .filter((e) => e.days >= 1 && e.days <= 14)
        .sort((a, b) => a.days - b.days);
      if (upcoming.length === 0) return;
      const minutes = upcoming.map((e) => sessionsFor(plan, e.id).reduce((s, i) => s + i.minutes, 0));
      for (const [i, e] of upcoming.entries()) expect(minutes[i], `${day} ${e.id}`).toBeGreaterThanOrEqual(45);
      // The nearest takes the longest session (others match it only when the day has room for both).
      expect(Math.max(...minutes), day).toBe(minutes[0]);
      expect(minutes[0], day).toBeGreaterThan(45);
    });
  });

  it("does not warn about the workload six weeks out", () => {
    for (const day of ["2026-12-20", "2026-12-23", "2026-12-27"]) {
      expect(plans.get(day)!.details.workload, day).toBeNull();
    }
  });
});

describe("planner: US-style courses plan as before", () => {
  // Midterm 25 %, final 35 %, quizzes: no German wording, weights under 50 %.
  // Expected plans recorded from the planner before module exams and
  // formalities were added.
  it("plans a semester of midterms, a final and quizzes exactly as before", () => {
    const ws = workspace({
      pages: [trackerPage()],
      databases: [
        assignments([
          { id: "mid", title: "Midterm 1", due: addDays(TODAY, 12), weight: 25, type: "exam" },
          { id: "fin", title: "Final exam", due: addDays(TODAY, 30), weight: 35, type: "exam" },
          { id: "q3", title: "Quiz 3", due: addDays(TODAY, 4), weight: 5 },
          { id: "q4", title: "Quiz 4", due: addDays(TODAY, 18), weight: 5 },
          { id: "ps6", title: "Problem set 6", due: addDays(TODAY, 6), weight: 10, type: "hw" },
          { id: "ps7", title: "Problem set 7", due: addDays(TODAY, 13), weight: 10, type: "hw" },
          { id: "ess", title: "Reflection essay", due: addDays(TODAY, 20), weight: 15, type: "hw" },
        ]),
      ],
    });
    const db = ws.databases[0];
    const lines: string[] = [];
    let previous: PreviousPlan | null = null;
    for (let i = 0; i <= 30; i += 1) {
      const day = addDays(TODAY, i);
      const built = buildDailyStudyPlan({ workspaces: [ws], localDate: day, dailyMinutes: 120, previous });
      lines.push(
        `${i}: ${built.items.map((it) => `${it.id.split(":").slice(-2).join(":")}/${it.kind}/${it.minutes}/${it.reason.code}`).join(" ")}` +
          (built.details.workload ? " !" : ""),
      );
      const items = built.items.map((it) => ({ ...it, completed: true }));
      for (const it of items) {
        const r = it.mode === "finish" ? db.rows.find((x) => x.id === it.target.rowId) : null;
        if (r) r.cells.status = "done";
      }
      previous = { localDate: day, items, progress: built.details.progress };
    }
    expect(lines).toEqual(US_EXPECTED);
  });
});

const US_EXPECTED: string[] = [
  "0: assignments:q3/deadline/55/due_soon assignments:ps6/deadline/20/due_soon assignments:ps7/deadline/15/due_later assignments:ess/deadline/15/due_later assignments:q4/deadline/15/due_later",
  "1: assignments:q3/deadline/15/due_soon assignments:ps6/deadline/60/due_soon assignments:ps7/deadline/15/due_later assignments:ess/deadline/15/due_later assignments:q4/deadline/15/due_later",
  "2: mid:notes/exam/35/exam_review assignments:q3/deadline/15/due_soon assignments:ps6/deadline/25/due_soon assignments:ps7/deadline/15/due_later assignments:ess/deadline/15/due_later assignments:q4/deadline/15/due_later",
  "3: assignments:q3/deadline/15/due_tomorrow assignments:ps6/deadline/15/due_soon assignments:ps7/deadline/60/due_later assignments:ess/deadline/15/due_later assignments:q4/deadline/15/due_later",
  "4: assignments:ps6/deadline/15/due_soon assignments:ps7/deadline/15/due_later assignments:q4/deadline/15/due_later assignments:ess/deadline/75/due_later",
  "5: assignments:ps6/deadline/15/due_tomorrow mid:notes/exam/45/exam_review assignments:ps7/deadline/15/due_later assignments:q4/deadline/15/due_later assignments:ess/deadline/30/due_later",
  "6: mid:notes/exam/45/exam_review assignments:ps7/deadline/15/due_soon assignments:ess/deadline/45/due_later assignments:q4/deadline/15/due_later",
  "7: mid:notes/exam/45/exam_review assignments:ps7/deadline/15/due_soon assignments:ess/deadline/30/due_later assignments:q4/deadline/15/due_later",
  "8: mid:notes/exam/45/exam_review assignments:ps7/deadline/15/due_soon assignments:ess/deadline/15/due_later assignments:q4/deadline/15/due_later",
  "9: mid:notes/exam/45/exam_review fin:notes/exam/25/exam_review assignments:ps7/deadline/15/due_soon assignments:ess/deadline/15/due_later assignments:q4/deadline/15/due_later",
  "10: mid:notes/exam/45/exam_review assignments:ps7/deadline/15/due_soon assignments:ess/deadline/15/due_later assignments:q4/deadline/15/due_later",
  "11: mid:notes/exam/45/exam_tomorrow assignments:ps7/deadline/15/due_soon assignments:q4/deadline/15/due_soon assignments:ess/deadline/15/due_later",
  "12: mid:notes/exam/20/exam_today assignments:ps7/deadline/15/due_tomorrow assignments:q4/deadline/15/due_soon assignments:ess/deadline/15/due_later",
  "13: assignments:ess/deadline/15/due_soon assignments:q4/deadline/15/due_soon",
  "14: assignments:ess/deadline/15/due_soon assignments:q4/deadline/15/due_soon",
  "15: assignments:q4/deadline/15/due_soon assignments:ess/deadline/15/due_soon",
  "16: assignments:q4/deadline/15/due_soon fin:notes/exam/35/exam_review assignments:ess/deadline/15/due_soon",
  "17: assignments:q4/deadline/15/due_tomorrow assignments:ess/deadline/15/due_soon",
  "18: assignments:ess/deadline/15/due_soon",
  "19: assignments:ess/deadline/15/due_tomorrow",
  "20: fin:notes/exam/40/exam_review",
  "21: ",
  "22: ",
  "23: fin:notes/exam/45/exam_review",
  "24: fin:notes/exam/45/exam_review",
  "25: fin:notes/exam/45/exam_review",
  "26: fin:notes/exam/45/exam_review",
  "27: fin:notes/exam/45/exam_review",
  "28: fin:notes/exam/45/exam_review",
  "29: fin:notes/exam/45/exam_tomorrow",
  "30: fin:notes/exam/20/exam_today",
];
