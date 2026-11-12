import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, GradesBlock as GradesData, Workspace } from "@/lib/workspace/types";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";

const h = vi.hoisted(() => ({
  update: vi.fn(),
  undo: vi.fn(),
  store: { workspace: null as unknown as Workspace, listeners: new Set<() => void>() },
  history: [] as Workspace[],
}));

// A tiny store standing in for WorkspaceContext: `update` applies the mutator
// to a copy and re-renders subscribers, like the real editor.
vi.mock("../WorkspaceContext", async () => {
  const React = await import("react");
  return {
    useWorkspace: () => {
      const [, force] = React.useReducer((x: number) => x + 1, 0);
      React.useEffect(() => {
        h.store.listeners.add(force);
        return () => void h.store.listeners.delete(force);
      }, []);
      return { workspace: h.store.workspace, update: h.update, undo: h.undo };
    },
  };
});
vi.mock("@/lib/i18n/client", async () => {
  const { pluralizer } = await import("@/lib/i18n/plural");
  return { useI18n: () => ({ dict: en, t: fmt, plural: pluralizer("en"), locale: "en", dir: "ltr" }) };
});

import { GradesBlock } from "./GradesBlock";
import { useWorkspace } from "../WorkspaceContext";

const G = en.grades;

function Harness() {
  const { workspace } = useWorkspace();
  return <GradesBlock pageId="p1" block={workspace.pages[0].blocks[0] as GradesData} />;
}

function assignments(withScore = true): Database {
  return {
    id: "db-a",
    name: "Assignments",
    properties: [
      { id: "a-name", name: "Assignment", type: "text" },
      {
        id: "a-course",
        name: "Course",
        type: "select",
        options: [
          { id: "co-bio", label: "BIO 101", color: "green" },
          { id: "co-his", label: "HIST 200", color: "amber" },
        ],
      },
      {
        id: "a-status",
        name: "Status",
        type: "status",
        options: [
          { id: "st-todo", label: "Not started" },
          { id: "st-done", label: "Done", color: "green" },
        ],
      },
      { id: "a-due", name: "Due", type: "date" },
      { id: "a-weight", name: "Weight %", type: "number" },
      ...(withScore ? [{ id: "a-score", name: "Score", type: "number" as const }] : []),
    ],
    rows: [
      { id: "r1", cells: { "a-name": "Lab 1", "a-course": "co-bio", "a-status": "st-done", "a-weight": 40, "a-score": 90, "a-due": "2026-10-01" } },
      { id: "r2", cells: { "a-name": "Final", "a-course": "co-bio", "a-status": "st-todo", "a-weight": 60, "a-due": "2026-12-15" } },
      { id: "r3", cells: { "a-name": "Essay", "a-course": "co-his", "a-status": "st-done", "a-weight": 100, "a-due": "2026-11-01" } },
    ],
    views: [{ id: "v", name: "All", type: "table" }],
  };
}

function setStore(block: Partial<GradesData>, db: Database = assignments()) {
  h.store.workspace = {
    id: "w1",
    name: "WS",
    pages: [{ id: "p1", title: "P", blocks: [{ id: "g1", type: "grades", ...block }] }],
    databases: [db],
  };
}
const block = () => h.store.workspace.pages[0].blocks[0] as GradesData;
const row = (id: string) => h.store.workspace.databases[0].rows.find((r) => r.id === id)!;
const configured = {
  databaseId: "db-a",
  columns: { course: "a-course", score: "a-score", weight: "a-weight", due: "a-due" },
};

function card(label: string) {
  const el = screen.getAllByTestId("grades-course").find((c) => within(c).queryByText(label));
  if (!el) throw new Error(`no course card ${label}`);
  return within(el);
}

beforeEach(() => {
  h.store.listeners.clear();
  h.update.mockReset();
  h.history = [];
  h.update.mockImplementation((mutator: (d: Workspace) => void) => {
    const draft = structuredClone(h.store.workspace);
    mutator(draft);
    h.history.push(h.store.workspace);
    h.store.workspace = draft;
    h.store.listeners.forEach((l) => l());
  });
  // Workspace undo: the step before the last edit comes back.
  h.undo.mockReset();
  h.undo.mockImplementation(() => {
    const previous = h.history.pop();
    if (!previous) return;
    h.store.workspace = previous;
    h.store.listeners.forEach((l) => l());
  });
});

describe("GradesBlock: setup", () => {
  it("detects the columns and starts tracking in one tap", async () => {
    const user = userEvent.setup();
    setStore({ title: "Grades" });
    render(<Harness />);
    expect(screen.getByText(G.setupTitle)).toBeInTheDocument();
    expect(screen.getByLabelText(G.columns.score)).toHaveValue("a-score");
    expect(screen.getByLabelText(G.columns.weight)).toHaveValue("a-weight");
    expect(screen.getByLabelText(G.columns.course)).toHaveValue("a-course");
    expect(screen.getByLabelText(G.columns.maxScore)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: G.saveSetup }));
    expect(block()).toMatchObject({
      databaseId: "db-a",
      columns: { course: "a-course", score: "a-score", maxScore: null, weight: "a-weight", due: "a-due" },
    });
    expect(screen.getAllByTestId("grades-course")).toHaveLength(2);
  });

  it("lets the student correct a column", async () => {
    const user = userEvent.setup();
    setStore({});
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText(G.columns.weight), "");
    await user.click(screen.getByRole("button", { name: G.saveSetup }));
    expect(block().columns?.weight).toBeNull();
  });

  it("offers to add a missing score column", async () => {
    const user = userEvent.setup();
    setStore({}, assignments(false));
    render(<Harness />);
    expect(screen.getByText(G.missingScore)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: G.saveSetup })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: G.addScoreColumn }));
    const added = h.store.workspace.databases[0].properties.at(-1)!;
    expect(added).toMatchObject({ name: G.scoreColumnName, type: "number" });
    expect(screen.getByLabelText(G.columns.score)).toHaveValue(added.id);

    await user.click(screen.getByRole("button", { name: G.saveSetup }));
    expect(block().columns?.score).toBe(added.id);
  });

  it("says so when there is no list at all", () => {
    h.store.workspace = {
      id: "w1",
      name: "WS",
      pages: [{ id: "p1", title: "P", blocks: [{ id: "g1", type: "grades" }] }],
      databases: [],
    };
    render(<Harness />);
    expect(screen.getByText(G.noDatabase)).toBeInTheDocument();
  });
});

describe("GradesBlock: grades", () => {
  it("shows the grade so far, the share decided and an overall average", () => {
    setStore(configured);
    render(<Harness />);
    const bio = card("BIO 101");
    expect(bio.getByTestId("grades-current")).toHaveTextContent("90%");
    expect(bio.getByText(/40% of the grade decided/)).toBeInTheDocument();
    expect(card("HIST 200").getByText(G.noScores)).toBeInTheDocument();
    expect(screen.getByTestId("grades-overall")).toHaveTextContent("90%");
    expect(bio.getByTestId("grades-outlook")).toHaveTextContent(G.outlook.pick);
  });

  it("enters a score from a phone keypad, marks the work done and recomputes", async () => {
    const user = userEvent.setup();
    setStore(configured);
    render(<Harness />);
    await user.click(card("HIST 200").getByRole("button", { name: fmt(G.showScores, { count: 1 }) }));
    const input = screen.getByLabelText(fmt(G.scoreAria, { item: "Essay" }));
    expect(input).toHaveAttribute("inputmode", "decimal");
    await user.type(input, "42/50{Enter}");
    // No "out of" column: 42/50 is stored as a percentage.
    expect(row("r3").cells["a-score"]).toBe(84);
    expect(card("HIST 200").getByTestId("grades-current")).toHaveTextContent("84%");
  });

  it("stores the 'out of' too when the list has that column, and marks it done", async () => {
    const user = userEvent.setup();
    const db = assignments();
    db.properties.push({ id: "a-max", name: "Out of", type: "number" });
    setStore({ ...configured, columns: { ...configured.columns, maxScore: "a-max" } }, db);
    render(<Harness />);
    await user.click(card("BIO 101").getByRole("button", { name: fmt(G.showScores, { count: 2 }) }));
    await user.type(screen.getByLabelText(fmt(G.scoreAria, { item: "Final" })), "18,5/20{Enter}");
    expect(row("r2").cells).toMatchObject({ "a-score": 18.5, "a-max": 20, "a-status": "st-done" });
  });

  it("refuses text it cannot read and keeps the old value", async () => {
    const user = userEvent.setup();
    setStore(configured);
    render(<Harness />);
    await user.click(card("BIO 101").getByRole("button", { name: fmt(G.showScores, { count: 2 }) }));
    const input = screen.getByLabelText(fmt(G.scoreAria, { item: "Lab 1" }));
    await user.clear(input);
    await user.type(input, "great{Enter}");
    expect(row("r1").cells["a-score"]).toBe(90);
    expect(screen.getByRole("status")).toHaveTextContent(fmt(G.invalidScore, { text: "great" }));
    expect(input).toHaveValue("90");
  });

  it("clears a score when the box is emptied", async () => {
    const user = userEvent.setup();
    setStore(configured);
    render(<Harness />);
    await user.click(card("BIO 101").getByRole("button", { name: fmt(G.showScores, { count: 2 }) }));
    const input = screen.getByLabelText(fmt(G.scoreAria, { item: "Lab 1" }));
    await user.clear(input);
    await user.tab();
    expect(row("r1").cells["a-score"]).toBeNull();
  });
});

describe("GradesBlock: targets", () => {
  it("a percentage target answers what is needed on the rest", async () => {
    const user = userEvent.setup();
    setStore(configured);
    render(<Harness />);
    const bio = card("BIO 101");
    await user.type(bio.getByLabelText(fmt(G.targetAria, { course: "BIO 101" })), "85{Enter}");
    expect(block().targets).toEqual({ "co-bio": 85 });
    // (85*100 - 40*90) / 60 = 81.7
    expect(bio.getByTestId("grades-outlook")).toHaveTextContent(
      fmt(G.outlook.needed, { target: "85%", average: "81.7%", remaining: "60%" }),
    );
  });

  it("a letter-grade target, and an out-of-reach one said honestly", async () => {
    const user = userEvent.setup();
    const db = assignments();
    db.rows[0].cells["a-score"] = 50;
    setStore({ ...configured, scale: "us_letter" }, db);
    render(<Harness />);
    const bio = card("BIO 101");
    expect(bio.getByTestId("grades-current")).toHaveTextContent("F");
    await user.selectOptions(bio.getByLabelText(fmt(G.targetAria, { course: "BIO 101" })), "93");
    expect(block().targets).toEqual({ "co-bio": 93 });
    // (93*100 - 40*50) / 60 = 121.7 -> unreachable; best = 20 + 60 = 80 (B-)
    expect(bio.getByTestId("grades-outlook")).toHaveTextContent(
      fmt(G.outlook.unreachable, { target: "A (93%)", average: "121.7%", best: "80% (B-)" }),
    );
  });

  it("a default target applies to courses without their own", () => {
    setStore({ ...configured, defaultTarget: 30 });
    render(<Harness />);
    expect(card("BIO 101").getByTestId("grades-outlook")).toHaveTextContent(
      fmt(G.outlook.secured, { target: "30%" }),
    );
  });
});

describe("GradesBlock: what if", () => {
  it("tries scores without saving them, then clears", async () => {
    const user = userEvent.setup();
    setStore({ ...configured, targets: { "co-bio": 85 } });
    render(<Harness />);
    const before = JSON.stringify(h.store.workspace);
    await user.click(screen.getByRole("button", { name: G.whatIf }));
    expect(screen.getByText(G.whatIfOn)).toBeInTheDocument();

    const bio = card("BIO 101");
    await user.click(bio.getByRole("button", { name: fmt(G.showScores, { count: 2 }) }));
    await user.type(screen.getByLabelText(fmt(G.whatIfAria, { item: "Final" })), "80");
    // 0.4*90 + 0.6*80 = 84 -> everything decided, target missed by 1
    expect(bio.getByTestId("grades-current")).toHaveTextContent("84%");
    expect(bio.getByText(G.whatIfBadge)).toBeInTheDocument();
    expect(bio.getByTestId("grades-outlook")).toHaveTextContent(
      fmt(G.outlook.missed, { final: "84%", short: "1%", target: "85%" }),
    );
    expect(JSON.stringify(h.store.workspace)).toBe(before);

    await user.click(screen.getByRole("button", { name: G.clearWhatIf }));
    expect(bio.getByTestId("grades-current")).toHaveTextContent("90%");
  });

  it("fills every unscored item of a course at once", async () => {
    const user = userEvent.setup();
    setStore(configured);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: G.whatIf }));
    const his = card("HIST 200");
    await user.click(his.getByRole("button", { name: fmt(G.showScores, { count: 1 }) }));
    await user.type(screen.getByLabelText(fmt(G.fillRestAria, { course: "HIST 200" })), "70");
    expect(his.getByTestId("grades-current")).toHaveTextContent("70%");
    expect(screen.getByTestId("grades-overall")).toHaveTextContent("80%");
  });
});

describe("GradesBlock: settings", () => {
  it("switches to a German scale and back to editable thresholds", async () => {
    const user = userEvent.setup();
    setStore(configured);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: G.settings }));
    await user.selectOptions(screen.getByLabelText(G.scaleLabel), "de_grade");
    expect(block().scale).toBe("de_grade");
    // 90 % -> 1,3 shown as grade points
    expect(card("BIO 101").getByTestId("grades-current")).toHaveTextContent("1.3");

    const min = screen.getByLabelText(fmt(G.bandMinAria, { label: "1.3" }));
    await user.clear(min);
    await user.type(min, "91{Enter}");
    expect(block().bands?.find((b) => b.points === 1.3)?.min).toBe(91);
    expect(card("BIO 101").getByTestId("grades-current")).toHaveTextContent("1.7");

    await user.click(screen.getByRole("button", { name: G.resetBands }));
    expect(block().bands).toBeUndefined();
  });
});

describe("GradesBlock: names write once per typing burst", () => {
  it("the title is written when typing ends, not per keystroke", async () => {
    const user = userEvent.setup();
    setStore({ ...configured, title: "Grades" });
    render(<Harness />);
    const title = screen.getByRole("textbox", { name: G.titleAria });
    await user.type(title, " 2026");
    expect(h.update).not.toHaveBeenCalled();
    expect(title).toHaveValue("Grades 2026");
    await user.tab();
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(block().title).toBe("Grades 2026");
  });

  it("a grade band's name is written when typing ends, not per keystroke", async () => {
    const user = userEvent.setup();
    setStore({ ...configured, scale: "us_letter" });
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: G.settings }));
    const label = screen.getByRole("textbox", { name: fmt(G.bandLabelAria, { index: 1 }) }) as HTMLInputElement;
    const first = label.value;
    const before = h.update.mock.calls.length;
    await user.type(label, "+");
    expect(h.update.mock.calls.length).toBe(before);
    await user.tab();
    expect(h.update.mock.calls.length).toBe(before + 1);
    expect(block().bands?.[0].label).toBe(`${first}+`);
  });
});

describe("GradesBlock: keyboard focus", () => {
  it("Escape closes the settings panel and returns focus to its button", async () => {
    const user = userEvent.setup();
    setStore(configured);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: G.settings }));
    await user.click(screen.getByLabelText(G.scaleLabel));
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText(G.scaleLabel)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: G.settings })).toHaveFocus();
  });

  it("leaving the column setup puts focus back on the settings button", async () => {
    const user = userEvent.setup();
    setStore(configured);
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: G.settings }));
    await user.click(screen.getByRole("button", { name: G.editColumns }));
    await user.click(screen.getByRole("button", { name: G.cancel }));
    expect(screen.getByRole("button", { name: G.settings })).toHaveFocus();
  });
});

// ---------------------------------------------------------------------------
// Grading categories

/** The QA workspace: category rows ("Problem sets 20%") among real work. */
function chem(): Database {
  return {
    id: "db-a",
    name: "Graded Work",
    properties: [
      { id: "a-name", name: "Assignment", type: "text" },
      { id: "a-course", name: "Course", type: "select", options: [{ id: "co-chem", label: "CHEM 210" }] },
      {
        id: "a-type",
        name: "Type",
        type: "select",
        options: [
          { id: "ty-ps", label: "Problem set" },
          { id: "ty-lab", label: "Lab report" },
          { id: "ty-exam", label: "Exam" },
          { id: "ty-quiz", label: "Quiz" },
          { id: "ty-group", label: "Grade group" },
        ],
      },
      {
        id: "a-status",
        name: "Status",
        type: "status",
        options: [
          { id: "st-todo", label: "Not started" },
          { id: "st-done", label: "Done", color: "green" },
        ],
      },
      { id: "a-due", name: "Due", type: "date" },
      { id: "a-weight", name: "Weight %", type: "number" },
      { id: "a-score", name: "Score", type: "number" },
    ],
    rows: [
      { id: "g-ps", cells: { "a-name": "Problem sets", "a-course": "co-chem", "a-type": "ty-group", "a-status": "st-todo", "a-weight": 20 } },
      { id: "g-lab", cells: { "a-name": "Lab reports", "a-course": "co-chem", "a-type": "ty-group", "a-status": "st-todo", "a-weight": 15 } },
      { id: "mid", cells: { "a-name": "Midterm 2", "a-course": "co-chem", "a-type": "ty-exam", "a-status": "st-todo", "a-weight": 25, "a-due": "2026-12-03" } },
      { id: "fin", cells: { "a-name": "Final exam", "a-course": "co-chem", "a-type": "ty-exam", "a-status": "st-todo", "a-weight": 40, "a-due": "2026-12-16" } },
      { id: "ps4", cells: { "a-name": "Problem Set 4", "a-course": "co-chem", "a-type": "ty-ps", "a-status": "st-todo", "a-due": "2026-11-03" } },
      { id: "ps5", cells: { "a-name": "Problem Set 5", "a-course": "co-chem", "a-type": "ty-ps", "a-status": "st-todo", "a-due": "2026-11-17" } },
      { id: "lab4", cells: { "a-name": "Lab Report 4", "a-course": "co-chem", "a-type": "ty-lab", "a-status": "st-todo", "a-due": "2026-11-20" } },
      // Imported from a calendar feed: no type.
      { id: "feed", cells: { "a-name": "Problem Set 6", "a-course": "co-chem", "a-status": "st-todo", "a-due": "2026-12-01" } },
      { id: "q1", cells: { "a-name": "Pop quiz", "a-course": "co-chem", "a-type": "ty-quiz", "a-status": "st-todo", "a-due": "2026-11-25" } },
    ],
    views: [{ id: "v", name: "All", type: "table" }],
  };
}
const C = G.categories;
const dbRows = () => h.store.workspace.databases[0].rows;
const scheme = () => h.store.workspace.databases[0].grading;

describe("GradesBlock: grading categories", () => {
  it("offers to turn category rows into category weights, and undoes it", async () => {
    const user = userEvent.setup();
    setStore(configured, chem());
    render(<Harness />);
    const offer = screen.getByTestId("grades-cleanup");
    expect(offer).toHaveTextContent("“Problem sets”, “Lab reports”");
    // Before: a share of the grade sits on rows, so real work decides nothing.
    expect(card("CHEM 210").getByText(/0% of the grade decided/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: G.cleanup.convert }));
    expect(dbRows().map((r) => r.id)).not.toContain("g-ps");
    expect(scheme()?.categories.map((c) => [c.name, c.weight])).toEqual([
      ["Problem sets", 20],
      ["Lab reports", 15],
    ]);
    expect(screen.queryByTestId("grades-cleanup")).not.toBeInTheDocument();
    expect(screen.getByText(fmt(G.cleanup.done.other, { count: 2 }))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: G.cleanup.undo }));
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(dbRows().map((r) => r.id)).toContain("g-ps");
    expect(screen.getByTestId("grades-cleanup")).toBeInTheDocument();
  });

  it("keeps the rows when the student declines, and keeps working", async () => {
    const user = userEvent.setup();
    setStore(configured, chem());
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: G.cleanup.keep }));
    expect(screen.queryByTestId("grades-cleanup")).not.toBeInTheDocument();
    expect(scheme()?.keptRows).toEqual(["g-ps", "g-lab"]);
    expect(dbRows()).toHaveLength(9);
    expect(card("CHEM 210").getByTestId("grades-current")).toHaveTextContent("—");
  });

  it("a score on one problem set moves the grade, and the row does not jump", async () => {
    const user = userEvent.setup();
    setStore(configured, chem());
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: G.cleanup.convert }));
    const c = card("CHEM 210");
    expect(c.getByTestId("grades-current")).toHaveTextContent("—");

    await user.click(c.getByRole("button", { name: fmt(G.showScores, { count: 7 }) }));
    const order = () => screen.getAllByLabelText(/^Score for /).map((el) => el.getAttribute("aria-label"));
    const before = order();
    await user.type(screen.getByLabelText(fmt(G.scoreAria, { item: "Problem Set 4" })), "85{Enter}");
    expect(row("ps4").cells["a-score"]).toBe(85);
    expect(c.getByTestId("grades-current")).toHaveTextContent("85%");
    // One of three problem sets: a third of 20 %.
    expect(c.getByText(/7% of the grade decided/)).toBeInTheDocument();
    const ps = c.getAllByTestId("grades-category")[0];
    expect(within(ps).getByTestId("grades-category-average")).toHaveTextContent("85%");
    // The calendar row without a type counts in Problem sets by its title.
    expect(ps).toHaveTextContent(fmt(C.scored, { scored: 1, count: 3 }));
    expect(ps).toHaveTextContent(fmt(C.countAssumed, { count: 3 }));
    expect(order()).toEqual(before);
  });

  it("shows uncategorised work as not counted, with a one-tap fix", async () => {
    const user = userEvent.setup();
    setStore(configured, chem());
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: G.cleanup.convert }));
    const box = within(screen.getByTestId("grades-uncategorized"));
    expect(box.getByText("Pop quiz")).toBeInTheDocument();
    // A real plural, not "1 item(s)".
    expect(box.getByText("Not counted yet: 1 item with no category and no weight. Pick where it counts below.")).toBeInTheDocument();

    await user.click(box.getByRole("button", { name: fmt(C.assignAria, { item: "Pop quiz", category: "Lab reports" }) }));
    const lab = scheme()!.categories.find((c) => c.name === "Lab reports")!;
    expect(scheme()?.assign).toEqual({ q1: lab.id });
    expect(screen.queryByTestId("grades-uncategorized")).not.toBeInTheDocument();
  });

  it("counts a weight once and shows it as the syllabus gives it (QA round 3: 140%)", async () => {
    const user = userEvent.setup();
    const db: Database = {
      id: "db-a",
      name: "Coursework",
      properties: [
        { id: "a-name", name: "Item", type: "text" },
        { id: "a-course", name: "Course", type: "select", options: [{ id: "co-phys", label: "PHYS 201" }] },
        { id: "a-due", name: "Due", type: "date" },
        { id: "a-weight", name: "Weight %", type: "number" },
        { id: "a-score", name: "Score", type: "number" },
      ],
      rows: [
        { id: "ps5", cells: { "a-name": "Problem Set 5", "a-course": "co-phys", "a-due": "2026-10-30", "a-score": 70 } },
        { id: "q8", cells: { "a-name": "Quiz 8", "a-course": "co-phys", "a-due": "2026-11-17" } },
        { id: "m1", cells: { "a-name": "Midterm 1", "a-course": "co-phys", "a-due": "2026-10-08", "a-weight": 20, "a-score": 82 } },
        { id: "m2", cells: { "a-name": "Midterm 2", "a-course": "co-phys", "a-weight": 20 } },
        { id: "fin", cells: { "a-name": "Final exam (cumulative)", "a-course": "co-phys", "a-due": "2026-12-15", "a-weight": 25 } },
      ],
      views: [{ id: "v", name: "All", type: "table" }],
      grading: {
        categories: [
          { id: "cat-ps", course: "co-phys", name: "Problem sets", weight: 20, dropLowest: 1, expectedCount: 10 },
          { id: "cat-quiz", course: "co-phys", name: "Weekly quizzes", weight: 15 },
          { id: "cat-mid", course: "co-phys", name: "Midterms", weight: 40, expectedCount: 2 },
        ],
      },
    };
    setStore({ ...configured, defaultTarget: 85 }, db);
    render(<Harness />);
    const c = card("PHYS 201");
    // No "weights add up to 140%" and no "remaining 83% of the grade".
    expect(screen.queryByText(/add up to/)).not.toBeInTheDocument();
    const mid = c.getAllByTestId("grades-category").find((el) => within(el).queryByText("Midterms"))!;
    expect(mid).toHaveTextContent("40% of the grade, set on its 2 items");
    expect(within(mid).queryByLabelText(fmt(C.countAria, { name: "Midterms" }))).not.toBeInTheDocument();
    // The final is listed at its own 25 %, not a rescaled 17.9 %.
    const breakdown = within(c.getByTestId("grades-breakdown"));
    expect(breakdown.getByText("25% of the grade")).toBeInTheDocument();

    await user.click(c.getByRole("button", { name: fmt(G.showScores, { count: 5 }) }));
    expect(screen.getAllByText("20% of the grade").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/14\.3%|17\.9%/)).not.toBeInTheDocument();
  });

  it("says once, plainly, when the weights really do not add up to 100", () => {
    const db = assignments();
    db.rows = db.rows.filter((r) => r.id !== "r3");
    db.rows[1].cells["a-weight"] = 80; // Lab 1 40 % + Final 80 % = 120 %
    setStore({ ...configured, defaultTarget: 70 }, db);
    render(<Harness />);
    const c = card("BIO 101");
    expect(c.getAllByText(/The weights add up to 120%, not 100%/)).toHaveLength(1);
    expect(c.getByText(/Check whether something is listed twice/)).toBeInTheDocument();
    // The outlook does not quote a rescaled share of the grade.
    expect(c.getByTestId("grades-outlook")).toHaveTextContent(/on the work not graded yet/);
  });

  it("lets the student say how many items a category will have", async () => {
    const user = userEvent.setup();
    setStore(configured, chem());
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: G.cleanup.convert }));
    await user.type(screen.getByLabelText(fmt(C.countAria, { name: "Problem sets" })), "10{Enter}");
    expect(scheme()?.categories[0].expectedCount).toBe(10);
    const ps = card("CHEM 210").getAllByTestId("grades-category")[0];
    expect(ps).toHaveTextContent(fmt(C.scored, { scored: 0, count: 10 }));
    expect(within(ps).queryByTestId("grades-count-assumed")).not.toBeInTheDocument();
  });

  it("edits, adds and removes categories", async () => {
    const user = userEvent.setup();
    setStore(configured, chem());
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: G.cleanup.convert }));
    await user.click(card("CHEM 210").getByRole("button", { name: C.edit }));
    const weight = screen.getByLabelText(fmt(C.weightAria, { name: "Problem sets" }));
    await user.clear(weight);
    await user.type(weight, "25{Enter}");
    await user.selectOptions(screen.getByLabelText(fmt(C.dropAria, { name: "Problem sets" })), "1");
    expect(scheme()?.categories[0]).toMatchObject({ weight: 25, dropLowest: 1 });
    await user.click(screen.getByRole("button", { name: fmt(C.remove, { name: "Lab reports" }) }));
    await user.click(screen.getByRole("button", { name: C.add }));
    expect(scheme()?.categories.map((c) => c.name)).toEqual(["Problem sets", C.newName]);
  });

  it("names a percentage target as a percentage on the UK scale, and a class with its own threshold", async () => {
    const user = userEvent.setup();
    setStore({ ...configured, scale: "uk_degree", targets: { "co-bio": 80 } });
    render(<Harness />);
    const bio = card("BIO 101");
    // 80 % is not what a First needs (70 %): never "First (80%)".
    expect(bio.getByTestId("grades-outlook")).toHaveTextContent(
      fmt(G.outlook.needed, {
        target: fmt(G.targetAside, { percent: "80%", grade: "First" }),
        average: "73.3%",
        remaining: "60%",
      }),
    );
    await user.selectOptions(bio.getByLabelText(fmt(G.targetAria, { course: "BIO 101" })), "70");
    // (70*100 - 40*90) / 60 = 56.7
    expect(bio.getByTestId("grades-outlook")).toHaveTextContent(
      fmt(G.outlook.needed, { target: "First (70%)", average: "56.7%", remaining: "60%" }),
    );
  });
});
