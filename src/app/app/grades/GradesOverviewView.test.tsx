import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { pluralizer } from "@/lib/i18n/plural";
import { buildGradesOverview, type GradesOverview } from "@/lib/grades/overview";
import type { Database, GradesBlock, Workspace } from "@/lib/workspace/types";
import { GRADES_COMMAND, GradesOverviewView } from "./GradesOverviewView";

const G = en.gradesOverview;
const TODAY = "2026-11-13";
const i18n = { dict: en, locale: "en", t: fmt, plural: pluralizer("en") };

type Row = [id: string, name: string, course: string | null, weight: number, score: number | null, due?: string];

function workspace(
  id: string,
  name: string,
  block: Partial<GradesBlock>,
  rows: Row[],
  options: { courses?: string[]; credits?: [string, number][]; creditsColumn?: string; icon?: string } = {},
): Workspace {
  const graded: Database = {
    id: "db",
    name: "Assignments",
    properties: [
      { id: "t", name: "Assignment", type: "text" },
      ...(options.courses
        ? [{ id: "c", name: "Course", type: "select" as const, options: options.courses.map((label) => ({ id: label, label })) }]
        : []),
      { id: "w", name: "Weight %", type: "number" },
      { id: "s", name: "Score", type: "number" },
      { id: "d", name: "Due", type: "date" },
    ],
    rows: rows.map(([rowId, title, course, w, s, d]) => ({
      id: rowId,
      cells: { t: title, w, s, d: d ?? null, ...(course ? { c: course } : {}) },
    })),
    views: [{ id: "v", name: "All", type: "table" }],
  };
  const credits: Database[] = options.credits
    ? [
        {
          id: "db-courses",
          name: "Courses",
          properties: [
            { id: "n", name: "Course", type: "text" },
            { id: "k", name: options.creditsColumn ?? "Credits", type: "number" },
          ],
          rows: options.credits.map(([n, k], i) => ({ id: `k${i}`, cells: { n, k } })),
          views: [{ id: "v", name: "All", type: "table" }],
        },
      ]
    : [];
  return {
    id,
    name,
    ...(options.icon ? { icon: options.icon } : {}),
    homePageId: "home",
    pages: [{ id: "home", title: "Home", blocks: [{ id: "g", type: "grades", databaseId: "db", ...block }] }],
    databases: [graded, ...credits],
  };
}

const biology = () =>
  workspace("ws-bio", "Biology", { defaultTarget: 75 }, [
    ["a", "Lab", null, 20, 80],
    ["b", "Midterm", null, 30, 70],
    ["c", "Final exam", null, 50, null, "2026-12-10"],
  ], { icon: "🧬" });

const usSemester = () =>
  workspace(
    "ws-us",
    "Fall semester",
    { scale: "us_gpa", defaultTarget: 90, targets: { Chemistry: 80 } },
    [
      ["c1", "Homework", "Calculus", 40, 95],
      ["c2", "Calculus final", "Calculus", 60, null, "2026-11-25"],
      ["h1", "Essay", "History", 50, 80],
      ["h2", "History exam", "History", 50, null, "2026-11-18"],
      ["x1", "Lab", "Chemistry", 50, 60],
      ["x2", "Chem exam", "Chemistry", 50, 60],
    ],
    { courses: ["Calculus", "History", "Chemistry"], credits: [["Calculus", 4], ["History", 3], ["Chemistry", 3]], icon: "🍂" },
  );

const germanSemester = () =>
  workspace(
    "ws-de",
    "Informatik",
    { scale: "de_grade", defaultTarget: 80 },
    [
      ["a1", "Übung", "Analysis", 40, 90],
      ["a2", "Klausur", "Analysis", 60, null, "2027-02-10"],
      ["p1", "Projekt", "Programmieren", 100, 70],
    ],
    { courses: ["Analysis", "Programmieren"] },
  );

const build = (...workspaces: Workspace[]) => buildGradesOverview(workspaces, { today: TODAY, ukLabels: en.grades.uk });

describe("GradesOverviewView", () => {
  it("shows a short how-to when there is no grade tracker yet", () => {
    const empty: GradesOverview = { courses: [], overall: null, unset: [], today: TODAY };
    render(<GradesOverviewView overview={empty} i18n={i18n} />);
    expect(screen.getByRole("heading", { level: 1, name: G.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: G.emptyTitle })).toBeInTheDocument();
    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[1]).toHaveTextContent(`On any page, type ${GRADES_COMMAND} and pick “${en.grades.insertLabel}”.`);
    expect(within(steps[1]).getByText(GRADES_COMMAND).tagName).toBe("KBD");
    expect(screen.getByRole("link", { name: G.openCourses })).toHaveAttribute("href", "/app");
    expect(screen.queryByRole("heading", { name: G.overallTitle })).not.toBeInTheDocument();
  });

  it("shows every course, what needs attention first, with the overall GPA", () => {
    render(<GradesOverviewView overview={build(biology(), usSemester())} i18n={i18n} />);
    const list = screen.getByRole("region", { name: G.coursesTitle });
    const cards = within(list).getAllByTestId("grades-overview-course");
    expect(cards.map((c) => within(c).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "History",
      "Calculus",
      "Biology",
      "Chemistry",
    ]);

    const [history, calculus, biologyCard, chemistry] = cards;
    // In the tracker's own scale: GPA points, the target as a grade with its threshold.
    expect(within(history).getByText(/Fall semester/)).toBeInTheDocument();
    expect(within(history).getByTestId("grades-overview-target")).toHaveTextContent("3.70 (90%)");
    expect(within(history).getByTestId("grades-overview-standing")).toHaveTextContent(
      "You need 100% on the rest to reach 3.70 (90%).",
    );
    expect(within(history).getByRole("progressbar", { name: "Grade decided in History" })).toHaveAttribute("aria-valuenow", "50");
    expect(within(history).getByText("Next: History exam")).toBeInTheDocument();
    expect(within(history).getByText(/Nov 18 · 50% of the grade/)).toBeInTheDocument();
    expect(within(history).getByRole("link", { name: "Open the grade tracker for History" })).toHaveAttribute(
      "href",
      "/app/ws-us?page=home&block=g",
    );

    expect(within(calculus).getByTestId("grades-overview-current")).toHaveTextContent("4.00");
    expect(within(calculus).getByText("95%")).toBeInTheDocument();

    // A percentage course, its own workspace: no second line naming it again.
    expect(within(biologyCard).getByTestId("grades-overview-current")).toHaveTextContent("74%");
    expect(within(biologyCard).getByTestId("grades-overview-standing")).toHaveTextContent(
      "You need 76% on the rest to reach 75%.",
    );
    expect(within(biologyCard).getByText("50% of the grade decided · 2 of 3 scored")).toBeInTheDocument();

    // Finished below target: said calmly, no alarm.
    expect(within(chemistry).getByTestId("grades-overview-standing")).toHaveTextContent("Finished with 60% (0.70).");
    expect(within(chemistry).getByText(G.nothingNext)).toBeInTheDocument();

    // Biology is the only percentage course, so the overall is the GPA alone.
    const overall = screen.getByRole("region", { name: G.overallTitle });
    expect(within(overall).queryByText(G.mixedScales)).toBeInTheDocument();
    expect(within(overall).getAllByTestId("grades-overview-overall").map((n) => n.textContent)).toEqual(["2.62"]);
    expect(within(overall).getByText("Courses graded: 3 of 3 · weighted by credits (10 credits)")).toBeInTheDocument();
    expect(screen.getByText(G.free)).toBeInTheDocument();
  });

  it("gives each grading scale its own figure and explains a German average it cannot give", () => {
    render(<GradesOverviewView overview={build(usSemester(), germanSemester())} i18n={i18n} />);
    const overall = screen.getByRole("region", { name: G.overallTitle });
    expect(within(overall).getByText(G.mixedScales)).toBeInTheDocument();
    expect(within(overall).getByText(`${G.overallGpa} · ${en.grades.presets.us_gpa}`)).toBeInTheDocument();
    expect(within(overall).getByText(`${G.overallGerman} · ${en.grades.presets.de_grade}`)).toBeInTheDocument();
    expect(within(overall).getByText(G.germanNeedsCredits)).toBeInTheDocument();
    // The German course is written in German grades: 90 % is a 1.3.
    const analysis = screen.getAllByTestId("grades-overview-course").find((c) => c.textContent?.includes("Analysis"))!;
    expect(within(analysis).getByTestId("grades-overview-current")).toHaveTextContent("1.3");
  });

  it("weights German averages by ECTS when they are known", () => {
    const de = germanSemester();
    de.databases.push({
      id: "db-ects",
      name: "Module",
      properties: [
        { id: "n", name: "Modul", type: "text" },
        { id: "e", name: "ECTS", type: "number" },
      ],
      rows: [
        { id: "m1", cells: { n: "Analysis", e: 9 } },
        { id: "m2", cells: { n: "Programmieren", e: 6 } },
      ],
      views: [{ id: "v", name: "All", type: "table" }],
    });
    render(<GradesOverviewView overview={build(de)} i18n={i18n} />);
    const overall = screen.getByRole("region", { name: G.overallTitle });
    expect(within(overall).queryByText(G.mixedScales)).not.toBeInTheDocument();
    expect(within(overall).getByTestId("grades-overview-overall")).toHaveTextContent("1.8");
  });

  it("lists trackers still to set up", () => {
    const overview: GradesOverview = {
      courses: [],
      overall: null,
      unset: [{ id: "w:g", workspaceId: "w", workspaceName: "Art", workspaceIcon: "🎨", href: "/app/w?page=p&block=g" }],
      today: TODAY,
    };
    render(<GradesOverviewView overview={overview} i18n={i18n} />);
    const section = screen.getByRole("region", { name: G.unsetTitle });
    expect(within(section).getByText("Art")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: G.unsetOpen })).toHaveAttribute("href", "/app/w?page=p&block=g");
    expect(screen.queryByRole("heading", { name: G.emptyTitle })).not.toBeInTheDocument();
  });

  it("says so when the grades could not be read", () => {
    render(<GradesOverviewView overview={null} i18n={i18n} />);
    expect(screen.getByRole("alert")).toHaveTextContent(G.loadFailed);
  });

  it("renders in Arabic with the student's digits", () => {
    const ar = getDictionary("ar");
    render(
      <GradesOverviewView
        overview={build(biology())}
        i18n={{ dict: ar, locale: "ar", t: fmt, plural: pluralizer("ar") }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: ar.gradesOverview.title })).toBeInTheDocument();
    const percent = new Intl.NumberFormat("ar", { style: "percent", maximumFractionDigits: 1 }).format(0.74);
    expect(screen.getByTestId("grades-overview-current")).toHaveTextContent(percent);
  });
});

describe("GradesOverviewView: module grades", () => {
  /** A tracker of module grades: one row per module, LP and Note. */
  function modules(rows: [id: string, name: string, lp: number, note: number | null][]): Workspace {
    return {
      id: "ws-mod",
      name: "Informatik",
      homePageId: "home",
      pages: [
        { id: "home", title: "Start", blocks: [{ id: "g", type: "grades", databaseId: "db", scale: "de_grade", entry: "grade" }] },
      ],
      databases: [
        {
          id: "db",
          name: "Module",
          properties: [
            { id: "n", name: "Modul", type: "text" },
            { id: "lp", name: "LP", type: "number" },
            { id: "note", name: "Note", type: "number" },
          ],
          rows: rows.map(([id, n, lp, note]) => ({ id, cells: { n, lp, note } })),
          views: [{ id: "v", name: "All", type: "table" }],
        },
      ],
    };
  }

  it("shows each module with its grade, LP and status, without a decided ring or percentages", () => {
    const E = en.tools.gradeCalculator.ects;
    render(
      <GradesOverviewView
        overview={build(modules([["a", "Analysis", 9, 1.3], ["b", "Statistik", 6, 5], ["c", "Datenbanken", 5, null]]))}
        i18n={i18n}
      />,
    );
    const cards = screen.getAllByTestId("grades-overview-course");
    const card = (name: string) => within(cards.find((c) => within(c).queryByText(name))!);
    expect(card("Analysis").getByTestId("grades-overview-current")).toHaveTextContent("1.3");
    expect(card("Analysis").getByTestId("grades-overview-credits")).toHaveTextContent("9");
    expect(card("Analysis").getByTestId("grades-overview-status")).toHaveTextContent(en.grades.modules.passed);
    expect(card("Statistik").getByTestId("grades-overview-status")).toHaveTextContent(E.failedTag);
    expect(card("Datenbanken").getByTestId("grades-overview-status")).toHaveTextContent(en.grades.modules.open);
    expect(card("Datenbanken").getByTestId("grades-overview-current")).toHaveTextContent("—");
    for (const c of cards) {
      expect(within(c).queryByRole("progressbar")).toBeNull();
      expect(c.textContent).not.toMatch(/%/);
    }
    // Statistik (5,0) is graded but not passed: the average is Analysis alone.
    const overall = screen.getByRole("region", { name: G.overallTitle });
    expect(within(overall).getByTestId("grades-overview-overall")).toHaveTextContent("1.3");
  });

  it("the German figure over modules is the ECTS-weighted Notenschnitt, cut after the first decimal", () => {
    render(
      <GradesOverviewView overview={build(modules([["a", "A", 5, 1.7], ["b", "B", 5, 2.0], ["c", "C", 10, 5.0]]))} i18n={i18n} />,
    );
    const overall = screen.getByRole("region", { name: G.overallTitle });
    expect(within(overall).getByTestId("grades-overview-overall")).toHaveTextContent("1.8");
    expect(within(overall).getByText(new RegExp(fmt(en.grades.coursesCounted, { count: "2", total: "3" })))).toBeInTheDocument();
  });
});
