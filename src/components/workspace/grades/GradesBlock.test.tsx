import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, GradesBlock as GradesData, Workspace } from "@/lib/workspace/types";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";

const h = vi.hoisted(() => ({
  update: vi.fn(),
  store: { workspace: null as unknown as Workspace, listeners: new Set<() => void>() },
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
      return { workspace: h.store.workspace, update: h.update };
    },
  };
});
vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({ dict: en, t: fmt, locale: "en", dir: "ltr" }),
}));

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
  h.update.mockImplementation((mutator: (d: Workspace) => void) => {
    const draft = structuredClone(h.store.workspace);
    mutator(draft);
    h.store.workspace = draft;
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
