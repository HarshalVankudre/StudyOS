import { describe, expect, it } from "vitest";
import type { Database, GradesBlock, Page, Workspace } from "@/lib/workspace/types";
import { formatGrade, formatPoints } from "./scales";
import { buildGradesOverview, compareAttention, type OverviewCourse } from "./overview";

const TODAY = "2026-11-13";

interface RowSpec {
  id: string;
  name: string;
  weight?: number | null;
  score?: number | null;
  due?: string;
  done?: boolean;
  course?: string;
}

function gradedDb(id: string, rows: RowSpec[], courses?: { id: string; label: string }[]): Database {
  return {
    id,
    name: "Assignments",
    properties: [
      { id: "title", name: "Assignment", type: "text" },
      ...(courses ? [{ id: "course", name: "Course", type: "select" as const, options: courses }] : []),
      { id: "weight", name: "Weight %", type: "number" },
      { id: "score", name: "Score", type: "number" },
      { id: "due", name: "Due", type: "date" },
      { id: "done", name: "Done", type: "checkbox" },
    ],
    rows: rows.map((r) => ({
      id: r.id,
      cells: {
        title: r.name,
        weight: r.weight ?? null,
        score: r.score ?? null,
        due: r.due ?? null,
        done: r.done ?? false,
        ...(r.course ? { course: r.course } : {}),
      },
    })),
    views: [{ id: "v", name: "All", type: "table" }],
  };
}

/** A courses table with credits, matched to the course options by name. */
function creditsDb(rows: [string, number][], column = "Credits"): Database {
  return {
    id: "db-courses",
    name: "Courses",
    properties: [
      { id: "name", name: "Course", type: "text" },
      { id: "credits", name: column, type: "number" },
    ],
    rows: rows.map(([name, credits], i) => ({ id: `course-${i}`, cells: { name, credits } })),
    views: [{ id: "v", name: "All", type: "table" }],
  };
}

const tracker = (id: string, databaseId: string | undefined, extra: Partial<GradesBlock> = {}): GradesBlock => ({
  id,
  type: "grades",
  ...(databaseId ? { databaseId } : {}),
  ...extra,
});

function ws(id: string, name: string, pages: Page[], databases: Database[], icon?: string): Workspace {
  return { id, name, ...(icon ? { icon } : {}), pages, databases, homePageId: pages[0]?.id };
}

const page = (id: string, title: string, ...blocks: Page["blocks"]): Page => ({ id, title, blocks });

function overview(...workspaces: Workspace[]) {
  return buildGradesOverview(workspaces, { today: TODAY });
}

// ---------------------------------------------------------------------------
// Fixtures: one workspace per grading scale
// ---------------------------------------------------------------------------

/** Biology, in percent, one course (no course column). */
function biology(): Workspace {
  const db = gradedDb("db-bio", [
    { id: "lab1", name: "Lab 1", weight: 20, score: 80, due: "2026-11-01" },
    { id: "mid", name: "Midterm", weight: 30, score: 70, due: "2026-11-05" },
    // Past due and not graded yet: not "next".
    { id: "read", name: "Reading check", weight: 10, due: "2026-11-10" },
    // Handed in, waiting for the grade: not "next" either.
    { id: "ps", name: "Problem set", weight: 10, due: "2026-11-15", done: true },
    { id: "final", name: "Final exam", weight: 30, due: "2026-12-10" },
  ]);
  return ws("ws-bio", "Biology", [page("home", "Home", tracker("g-bio", "db-bio", { defaultTarget: 75 }))], [db], "🧬");
}

/** A US semester: three courses in one tracker, credits from a courses table. */
function usSemester(): Workspace {
  const courses = [
    { id: "o-calc", label: "Calculus" },
    { id: "o-hist", label: "History" },
    { id: "o-chem", label: "Chemistry" },
  ];
  const db = gradedDb(
    "db-us",
    [
      { id: "c1", name: "Homework", course: "o-calc", weight: 40, score: 95 },
      { id: "c2", name: "Calculus final", course: "o-calc", weight: 60, due: "2026-11-25" },
      { id: "h1", name: "Essay", course: "o-hist", weight: 50, score: 80 },
      { id: "h2", name: "History exam", course: "o-hist", weight: 50, due: "2026-11-18" },
      { id: "x1", name: "Lab", course: "o-chem", weight: 50, score: 60 },
      { id: "x2", name: "Chem exam", course: "o-chem", weight: 50, score: 60 },
    ],
    courses,
  );
  return ws(
    "ws-us",
    "Fall semester",
    [page("home", "Home", tracker("g-us", "db-us", { scale: "us_gpa", defaultTarget: 90, targets: { "o-chem": 80 } }))],
    [db, creditsDb([["Calculus", 4], ["History", 3], ["Chemistry", 3]])],
    "🍂",
  );
}

/** A UK year: two modules, credits from a modules table. */
function ukYear(): Workspace {
  const db = gradedDb(
    "db-uk",
    [
      { id: "e1", name: "Econ essay", course: "o-econ", weight: 100, score: 65 },
      { id: "s1", name: "Stats exam", course: "o-stats", weight: 50, score: 72 },
      { id: "s2", name: "Stats project", course: "o-stats", weight: 50, due: "2026-12-01" },
    ],
    [
      { id: "o-econ", label: "Economics" },
      { id: "o-stats", label: "Statistics" },
    ],
  );
  return ws(
    "ws-uk",
    "Year 2",
    [page("home", "Home", tracker("g-uk", "db-uk", { scale: "uk_degree", defaultTarget: 60 }))],
    [db, creditsDb([["Economics", 20], ["Statistics", 40]])],
  );
}

/** A German semester: two courses, with or without ECTS. */
function germanSemester(withEcts = true): Workspace {
  const db = gradedDb(
    "db-de",
    [
      { id: "a1", name: "Übung", course: "o-ana", weight: 40, score: 90 },
      { id: "a2", name: "Klausur", course: "o-ana", weight: 60, due: "2027-02-10" },
      { id: "p1", name: "Projekt", course: "o-prog", weight: 100, score: 70 },
    ],
    [
      { id: "o-ana", label: "Analysis" },
      { id: "o-prog", label: "Programmieren" },
    ],
  );
  return ws(
    "ws-de",
    "Informatik",
    [page("home", "Start", tracker("g-de", "db-de", { scale: "de_grade", defaultTarget: 80 }))],
    withEcts ? [db, creditsDb([["Analysis", 9], ["Programmieren", 6]], "ECTS")] : [db],
  );
}

const byName = (courses: OverviewCourse[], name: string) =>
  courses.find((c) => (c.course ?? c.tracker ?? c.workspaceName) === name)!;

// ---------------------------------------------------------------------------

describe("buildGradesOverview: a course card", () => {
  it("reads current, target, needed on the rest, decided weight, counts and the next assessment from the tracker", () => {
    const { courses, overall, unset } = overview(biology());
    expect(courses).toHaveLength(1);
    const bio = courses[0];
    expect(bio).toMatchObject({
      workspaceId: "ws-bio",
      workspaceName: "Biology",
      workspaceIcon: "🧬",
      course: null,
      tracker: null,
      target: 75,
      outlook: { kind: "needed" },
      achievable: true,
      graded: 2,
      upcoming: 3,
      hasWork: true,
      href: "/app/ws-bio?page=home&block=g-bio",
    });
    // (20·80 + 30·70) / 50 = 74; (75·100 − 3700) / 50 = 76 on the rest.
    expect(bio.current).toBeCloseTo(74);
    expect(bio.needed).toBeCloseTo(76);
    expect(bio.decidedShare).toBeCloseTo(0.5);
    expect(bio.remainingShare).toBeCloseTo(50);
    expect(bio.scale.preset).toBe("percent");
    // Past due and handed-in work is not "next"; the final is.
    expect(bio.next).toEqual({ title: "Final exam", due: "2026-12-10", weight: 30 });
    // One course: no overall figure means anything.
    expect(overall).toBeNull();
    expect(unset).toEqual([]);
  });
});

describe("buildGradesOverview: grading scales", () => {
  it("US GPA: each course in grade points, and a credit-weighted GPA", () => {
    const { courses, overall } = overview(usSemester());
    expect(courses.map((c) => c.course)).toEqual(["History", "Calculus", "Chemistry"]);
    const calc = byName(courses, "Calculus");
    expect(calc).toMatchObject({ credits: 4, target: 90, workspaceName: "Fall semester", tracker: null });
    expect(calc.href).toBe("/app/ws-us?page=home&block=g-us");
    expect(formatGrade(calc.current!, calc.scale, "en")).toBe("4.00");
    // (90·100 − 40·95) / 60
    expect(calc.needed).toBeCloseTo(86.67, 1);
    const chem = byName(courses, "Chemistry");
    expect(chem.outlook).toEqual({ kind: "missed", final: 60 });
    expect(chem.next).toBeNull();

    expect(overall?.mixed).toBe(false);
    expect(overall?.groups).toHaveLength(1);
    const [gpa] = overall!.groups;
    expect(gpa).toMatchObject({ family: "us", kind: "gpa", letters: false, courses: 3 });
    expect(gpa.summary).toMatchObject({ weighting: "credits", credits: 10, counted: 3 });
    // A 4.0 · 4 + B- 2.7 · 3 + D- 0.7 · 3, over 10 credits.
    expect(gpa.value).toBeCloseTo((4 * 4 + 2.7 * 3 + 0.7 * 3) / 10);
    expect(formatPoints(gpa.value!, gpa.scale!, "en")).toBe("2.62");
  });

  it("US letters: the card shows the letter, the overall a GPA from the letters' points", () => {
    const semester = usSemester();
    (semester.pages[0].blocks[0] as GradesBlock).scale = "us_letter";
    const { courses, overall } = overview(semester);
    const hist = byName(courses, "History");
    expect(formatGrade(hist.current!, hist.scale, "en")).toBe("B-");
    expect(overall!.groups[0]).toMatchObject({ family: "us", kind: "gpa", letters: true });
    expect(overall!.groups[0].value).toBeCloseTo(2.62);
  });

  it("UK classes: each module in its class, and a credit-weighted average mark with its class", () => {
    const { courses, overall } = overview(ukYear());
    const stats = byName(courses, "Statistics");
    expect(formatGrade(stats.current!, stats.scale, "en")).toBe("First");
    expect(stats.needed).toBeCloseTo(48);
    expect(byName(courses, "Economics").outlook).toEqual({ kind: "met", final: 65 });

    const [uk] = overall!.groups;
    expect(uk).toMatchObject({ family: "uk", kind: "average" });
    expect(uk.summary.weighting).toBe("credits");
    expect(uk.value).toBeCloseTo((65 * 20 + 72 * 40) / 60);
    expect(formatGrade(uk.value!, uk.scale!, "en")).toBe("2:1");
  });

  it("German grades: 1,0 is best, and the ECTS-weighted average is cut, not rounded", () => {
    const { courses, overall } = overview(germanSemester());
    const analysis = byName(courses, "Analysis");
    expect(analysis.scale.lowerPointsBetter).toBe(true);
    expect(formatGrade(analysis.current!, analysis.scale, "de")).toBe("1,3");
    // What is needed stays a percentage: (80·100 − 40·90) / 60.
    expect(analysis.needed).toBeCloseTo(73.33, 1);
    expect(formatGrade(byName(courses, "Programmieren").current!, analysis.scale, "de")).toBe("2,7");

    const [de] = overall!.groups;
    expect(de).toMatchObject({ family: "de", kind: "german" });
    expect(de.summary).toMatchObject({ weighting: "credits", credits: 15 });
    // (1,3 · 9 + 2,7 · 6) / 15 = 1,86, written 1,8 as German averages are.
    expect(de.value).toBeCloseTo(1.86);
    expect(formatPoints(de.value!, de.scale!, "de")).toBe("1,8");
  });

  it("German grades without ECTS: no average, and the group says why", () => {
    const { overall } = overview(germanSemester(false));
    expect(overall!.groups).toEqual([
      expect.objectContaining({ family: "de", kind: "german", value: null, reason: "needs_credits" }),
    ]);
  });
});

describe("buildGradesOverview: needed on the rest", () => {
  it("tells achievable from out of reach, and out of reach needs attention first", () => {
    const physics = ws(
      "ws-phys",
      "Physics",
      [page("p", "Physics", tracker("g-phys", "db-phys", { defaultTarget: 90 }))],
      [
        gradedDb("db-phys", [
          { id: "m", name: "Midterm", weight: 60, score: 50 },
          { id: "f", name: "Final", weight: 40, due: "2026-12-01" },
        ]),
      ],
    );
    const { courses } = overview(biology(), physics);
    expect(courses.map((c) => c.workspaceName)).toEqual(["Physics", "Biology"]);
    const [phys, bio] = courses;
    // (90·100 − 3000) / 40 = 150 % would be needed; 70 % is still possible.
    expect(phys).toMatchObject({ achievable: false, outlook: { kind: "unreachable", best: 70 } });
    expect(phys.needed).toBeCloseTo(150);
    expect(bio.achievable).toBe(true);
  });

  it("a course that is secured, or has no target, says so instead of a number", () => {
    const db = gradedDb("db-x", [
      { id: "a", name: "A", weight: 80, score: 100 },
      { id: "b", name: "B", weight: 20, due: "2026-11-20" },
    ]);
    const secured = ws("w1", "Secured", [page("p", "P", tracker("g1", "db-x", { defaultTarget: 70 }))], [db]);
    const open = ws("w2", "No target", [page("p", "P", tracker("g2", "db-x"))], [structuredClone(db)]);
    const { courses } = overview(secured, open);
    expect(courses.map((c) => [c.workspaceName, c.outlook?.kind ?? null, c.needed, c.achievable])).toEqual([
      ["No target", null, null, null],
      ["Secured", "secured", null, null],
    ]);
  });
});

describe("buildGradesOverview: finding trackers", () => {
  it("names several trackers of one workspace by block title, else page title", () => {
    const semester = ws(
      "ws-sem",
      "Semester",
      [
        page("home", "Home", tracker("g-hw", "db-hw", { title: "Homework grades", defaultTarget: 80 })),
        page("exams", "Exams", tracker("g-ex", "db-ex", { defaultTarget: 80 })),
      ],
      [
        gradedDb("db-hw", [{ id: "h", name: "HW 1", weight: 100, score: 90 }]),
        gradedDb("db-ex", [{ id: "e", name: "Exam 1", weight: 100, due: "2026-12-01" }]),
      ],
    );
    const { courses } = overview(semester);
    expect(courses.map((c) => [c.tracker, c.course, c.href])).toEqual([
      ["Exams", null, "/app/ws-sem?page=exams&block=g-ex"],
      ["Homework grades", null, "/app/ws-sem?page=home&block=g-hw"],
    ]);
  });

  it("two trackers over the same list count once: the one with targets", () => {
    const db = gradedDb("db-1", [{ id: "a", name: "A", weight: 50, score: 80 }, { id: "b", name: "B", weight: 50 }]);
    const dup = ws(
      "ws-dup",
      "Chemistry",
      [page("home", "Home", tracker("g-home", "db-1")), page("grades", "Grades", tracker("g-page", "db-1", { defaultTarget: 70 }))],
      [db],
    );
    const { courses } = overview(dup);
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({ target: 70, tracker: null, href: "/app/ws-dup?page=grades&block=g-page" });
  });

  it("ignores workspaces without a tracker, and lists a tracker still to set up", () => {
    const plain = ws("ws-plain", "Notes", [page("p", "P", { id: "t", type: "paragraph", text: "hi" })], [
      gradedDb("db-p", [{ id: "a", name: "A", weight: 100, score: 90 }]),
    ]);
    const unsetOnly = ws("ws-new", "Art", [page("p", "Art", tracker("g-new", undefined))], [], "🎨");
    const mixed = biology();
    mixed.pages[0].blocks.push(tracker("g-empty", undefined));
    const { courses, unset } = overview(plain, unsetOnly, mixed);
    expect(courses.map((c) => c.workspaceId)).toEqual(["ws-bio"]);
    expect(unset).toEqual([
      { id: "ws-new:g-new", workspaceId: "ws-new", workspaceName: "Art", workspaceIcon: "🎨", href: "/app/ws-new?page=p&block=g-new" },
    ]);
  });

  it("a tracker whose list has no score column is not set up yet", () => {
    const db: Database = {
      id: "db-n",
      name: "Reading",
      properties: [
        { id: "t", name: "Title", type: "text" },
        { id: "w", name: "Weight", type: "number" },
      ],
      rows: [{ id: "r", cells: { t: "Ch. 1", w: 10 } }],
      views: [{ id: "v", name: "All", type: "table" }],
    };
    const { courses, unset } = overview(ws("ws-n", "Lit", [page("p", "P", tracker("g", "db-n"))], [db]));
    expect(courses).toEqual([]);
    expect(unset.map((u) => u.workspaceId)).toEqual(["ws-n"]);
  });
});

describe("buildGradesOverview: overall", () => {
  it("never averages across scales: each family gets its own figure, and the mix is flagged", () => {
    const { courses, overall } = overview(biology(), usSemester(), ukYear(), germanSemester());
    expect(courses).toHaveLength(1 + 3 + 2 + 2);
    expect(overall?.mixed).toBe(true);
    // Biology is the only percentage course: no percentage average.
    expect(overall!.groups.map((g) => [g.family, g.kind, g.summary.counted])).toEqual([
      ["us", "gpa", 3],
      ["uk", "average", 2],
      ["de", "german", 2],
    ]);
  });

  it("weights equally, and names the courses without credits, when only some have them", () => {
    const db = gradedDb(
      "db-p",
      [
        { id: "a", name: "A", course: "o-art", weight: 100, score: 90 },
        { id: "m", name: "M", course: "o-math", weight: 100, score: 70 },
      ],
      [
        { id: "o-art", label: "Art" },
        { id: "o-math", label: "Math" },
      ],
    );
    const school = ws("ws-p", "School", [page("p", "P", tracker("g", "db-p"))], [db, creditsDb([["Math", 5]])]);
    const [group] = overview(school).overall!.groups;
    expect(group).toMatchObject({ family: "percent", kind: "average", missingCredits: ["Art"] });
    expect(group.summary.weighting).toBe("equal");
    expect(group.value).toBeCloseTo(80);
  });

  it("weights by credits when every graded course has them", () => {
    const db = gradedDb(
      "db-p",
      [
        { id: "a", name: "A", course: "o-art", weight: 100, score: 90 },
        { id: "m", name: "M", course: "o-math", weight: 100, score: 70 },
      ],
      [
        { id: "o-art", label: "Art" },
        { id: "o-math", label: "Math" },
      ],
    );
    const school = ws("ws-p", "School", [page("p", "P", tracker("g", "db-p"))], [db, creditsDb([["Math", 3], ["Art", 1]])]);
    const [group] = overview(school).overall!.groups;
    expect(group.summary).toMatchObject({ weighting: "credits", credits: 4 });
    expect(group.value).toBeCloseTo((90 * 1 + 70 * 3) / 4);
  });
});

describe("compareAttention", () => {
  it("puts the highest needed first, then the next assessment soonest", () => {
    const base = biology();
    const course = overview(base).courses[0];
    const make = (id: string, needed: number | null, due: string | null): OverviewCourse => ({
      ...course,
      id,
      needed,
      achievable: needed === null ? null : needed <= 100,
      outlook: needed === null ? null : { kind: "needed", average: needed },
      next: due ? { title: id, due, weight: 10 } : null,
    });
    const list = [
      make("none-late", null, "2026-12-01"),
      make("low", 40, "2026-11-14"),
      make("high-late", 95, "2026-12-20"),
      make("high-soon", 95, "2026-11-20"),
      make("none-soon", null, "2026-11-15"),
    ];
    expect(list.sort(compareAttention).map((c) => c.id)).toEqual(["high-soon", "high-late", "low", "none-soon", "none-late"]);
  });
});

// ---------------------------------------------------------------------------
// Module grades (German grades entered per module)
// ---------------------------------------------------------------------------

/** A tracker of module grades: one row per module, LP and Note. */
function moduleSemester(modules: [id: string, name: string, lp: number | null, note: number | null][]): Workspace {
  const db: Database = {
    id: "db-mod",
    name: "Module",
    properties: [
      { id: "name", name: "Modul", type: "text" },
      { id: "lp", name: "LP", type: "number" },
      { id: "note", name: "Note", type: "number" },
    ],
    rows: modules.map(([id, name, lp, note]) => ({ id, cells: { name, lp, note } })),
    views: [{ id: "v", name: "Alle", type: "table" }],
  };
  return ws(
    "ws-mod",
    "Informatik",
    [page("home", "Start", tracker("g-mod", "db-mod", { scale: "de_grade", entry: "grade", targetGrade: 2 }))],
    [db],
  );
}

describe("buildGradesOverview: module grades", () => {
  it("one German card per module: name, LP, grade and where it stands, with no percentages", () => {
    const { courses } = overview(
      moduleSemester([
        ["m1", "Analysis", 9, 1.3],
        ["m2", "Statistik", 6, 5],
        ["m3", "Datenbanken", 5, null],
        ["m4", "Seminar", 3, 87],
      ]),
    );
    expect(courses).toHaveLength(4);
    const card = (name: string) => byName(courses, name);
    expect(card("Analysis")).toMatchObject({ credits: 9, current: null, target: null, module: { grade: 1.3, status: "passed" } });
    expect(card("Statistik").module).toEqual({ grade: 5, status: "failed" });
    expect(card("Datenbanken")).toMatchObject({ upcoming: 1, module: { grade: null, status: "open" } });
    expect(card("Seminar").module).toEqual({ grade: null, status: "invalid" });
    expect(card("Analysis").scale.preset).toBe("de_grade");
  });

  it("the Notenschnitt: ECTS-weighted, cut after the first decimal (1,0 and 1,2 at equal LP = 1,1)", () => {
    const { overall } = overview(
      moduleSemester([
        ["a", "A", 6, 1.0],
        ["b", "B", 6, 1.2],
      ]),
    );
    const [de] = overall!.groups;
    expect(de).toMatchObject({ family: "de", kind: "german" });
    expect(formatPoints(de.value!, de.scale!, "de")).toBe("1,1");
  });

  it("1,85 is shown as 1,8, and a failed module does not count", () => {
    const { overall } = overview(
      moduleSemester([
        ["a", "A", 5, 1.7],
        ["b", "B", 5, 2.0],
        ["c", "C", 10, 5.0],
      ]),
    );
    const [de] = overall!.groups;
    // (1,7 · 5 + 2,0 · 5) / 10 = 1,85, the 5,0 left out.
    expect(de.value).toBeCloseTo(1.85);
    expect(formatPoints(de.value!, de.scale!, "de")).toBe("1,8");
    expect(de.summary).toMatchObject({ weighting: "credits", credits: 10, counted: 2 });
  });

  it("modules and German percentage courses count in one average, by ECTS", () => {
    // Analysis 1,3 (9 ECTS) and Programmieren 2,7 (6 ECTS) from percentages, plus a module 1,0 (15 LP).
    const { overall } = overview(germanSemester(), moduleSemester([["m", "Thesis", 15, 1.0]]));
    const [de] = overall!.groups;
    // (1,3 · 9 + 2,7 · 6 + 1,0 · 15) / 30 = 1,43.
    expect(de.value).toBeCloseTo(1.43);
    expect(formatPoints(de.value!, de.scale!, "de")).toBe("1,4");
    expect(de.summary).toMatchObject({ weighting: "credits", credits: 30, counted: 3 });
  });

  it("without the LP of every passed module there is no average, and the group says why", () => {
    const { overall } = overview(
      moduleSemester([
        ["a", "A", 6, 1.3],
        ["b", "B", null, 2.0],
      ]),
    );
    expect(overall!.groups).toEqual([
      expect.objectContaining({ family: "de", kind: "german", value: null, reason: "needs_credits" }),
    ]);
  });

  it("open modules wait for attention before finished ones", () => {
    const { courses } = overview(
      moduleSemester([
        ["a", "Done", 6, 1.3],
        ["b", "Open", 6, null],
      ]),
    );
    expect(courses.map((c) => c.course)).toEqual(["Open", "Done"]);
  });
});
