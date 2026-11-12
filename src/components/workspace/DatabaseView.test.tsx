import { useCallback, useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, DatabaseView as DBView, Workspace } from "@/lib/workspace/types";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { WorkspaceProvider } from "./WorkspaceContext";
import { DatabaseView } from "./DatabaseView";

// The latest workspace after every update(), for assertions.
let latest: Workspace;
let updates = 0;

function Harness({ initial, viewId }: { initial: Workspace; viewId: string }) {
  const [workspace, setWorkspace] = useState(initial);
  // Same contract as WorkspaceEditor: clone, mutate the draft, replace.
  const update = useCallback((mutator: (draft: Workspace) => void) => {
    updates++;
    setWorkspace((prev) => {
      const next = structuredClone(prev);
      mutator(next);
      latest = next;
      return next;
    });
  }, []);
  return (
    <I18nProvider locale="en" dictionary={en}>
      <WorkspaceProvider
        value={{ workspace, update, status: "saved", rev: 0, agentBusy: false, setAgentBusy: () => {} }}
      >
        <DatabaseView databaseId="db" viewId={viewId} />
      </WorkspaceProvider>
    </I18nProvider>
  );
}

function renderDb(db: Database, viewId = db.views[0].id) {
  latest = { id: "w", name: "W", pages: [], databases: [db] };
  return render(<Harness initial={latest} viewId={viewId} />);
}

const db0 = () => latest.databases[0];

beforeEach(() => {
  updates = 0;
  // Thursday 12 November 2026, 10:00 local time.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Fixtures

function assignments(views: DBView[] = [{ id: "v", name: "All", type: "table" }], extraRows: Database["rows"] = []): Database {
  return {
    id: "db",
    name: "Assignments",
    properties: [
      { id: "name", name: "Assignment", type: "text" },
      {
        id: "course",
        name: "Course",
        type: "select",
        options: [
          { id: "cs", label: "CS 101", color: "blue" },
          { id: "math", label: "MATH 201", color: "violet" },
        ],
      },
      {
        id: "status",
        name: "Status",
        type: "status",
        options: [
          { id: "todo", label: "Not started", color: "zinc" },
          { id: "doing", label: "In progress", color: "amber" },
          { id: "done", label: "Done", color: "green" },
        ],
      },
      { id: "due", name: "Due", type: "date" },
      { id: "weight", name: "Weight", type: "number" },
      { id: "link", name: "Link", type: "url" },
    ],
    rows: [
      { id: "a", cells: { name: "Essay draft", course: "math", status: "todo", due: "2026-11-10", weight: 20 } },
      { id: "b", cells: { name: "Problem set", course: "cs", status: "done", due: "2026-11-11", weight: 10 } },
      { id: "c", cells: { name: "Lab report", course: "cs", status: "doing", due: "2026-11-12", weight: 15 } },
      { id: "d", cells: { name: "Quiz prep", course: "math", status: "todo", due: "2026-11-13" } },
      { id: "e", cells: { name: "Final project", course: "cs", status: "todo", due: "2026-12-20" } },
      ...extraRows,
    ],
    views,
  };
}

function tableBodyTitles(): string[] {
  return screen
    .getAllByRole("textbox", { name: "Assignment" })
    .map((input) => (input as HTMLInputElement).value);
}

// ---------------------------------------------------------------------------
// Regression tests carried over from the single-file component

describe("multi_select and select cells render as pills", () => {
  function deck(cells: Record<string, unknown>): Database {
    return {
      id: "db",
      name: "Klausuren",
      properties: [
        { id: "title", name: "Klausur", type: "text" },
        {
          id: "themen",
          name: "Themen",
          type: "multi_select",
          options: [
            { id: "o1", label: "SQL-Syntax", color: "blue" },
            { id: "o2", label: "JOINs", color: "violet" },
            { id: "o3", label: "Normalisierung", color: "amber" },
          ],
        },
        {
          id: "status",
          name: "Vorbereitung",
          type: "status",
          options: [
            { id: "s1", label: "In Vorbereitung", color: "amber" },
            { id: "s2", label: "Fertig", color: "green" },
          ],
        },
      ],
      rows: [{ id: "r1", cells: { title: "Datenbanken 1", ...(cells as Database["rows"][0]["cells"]) } }],
      views: [{ id: "v", name: "All", type: "table" }],
    };
  }

  it("renders selected values as pills, not a native listbox", () => {
    const { container } = renderDb(deck({ themen: ["o1", "o2"], status: "s1" }));
    expect(container.querySelector("select[multiple]")).toBeNull();
    expect(container.querySelectorAll("table select")).toHaveLength(0);
    expect(screen.getByText("SQL-Syntax")).toBeInTheDocument();
    expect(screen.getByText("JOINs")).toBeInTheDocument();
    expect(screen.getByText("In Vorbereitung")).toBeInTheDocument();
  });

  it("adds and removes tags via the inline menu", async () => {
    const user = userEvent.setup();
    renderDb(deck({ themen: ["o1", "o2"] }));
    await user.click(screen.getByRole("button", { name: "Remove SQL-Syntax" }));
    expect(db0().rows[0].cells.themen).toEqual(["o2"]);
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    await user.click(screen.getByRole("button", { name: "Normalisierung" }));
    expect(db0().rows[0].cells.themen).toEqual(["o2", "o3"]);
  });

  it("changes a status via the inline menu", async () => {
    const user = userEvent.setup();
    renderDb(deck({ status: "s1" }));
    await user.click(screen.getByRole("button", { name: "In Vorbereitung" }));
    await user.click(screen.getByRole("button", { name: "Fertig" }));
    expect(db0().rows[0].cells.status).toBe("s2");
  });
});

// ---------------------------------------------------------------------------

describe("touch and keyboard reachability", () => {
  it("never hides controls behind hover and labels every icon-only button", () => {
    const views: DBView[] = [
      { id: "v", name: "All", type: "table" },
      { id: "b", name: "Board", type: "board", groupByPropertyId: "status" },
    ];
    const { container } = renderDb(assignments(views));
    expect(container.querySelector(".opacity-0")).toBeNull();
    for (const button of container.querySelectorAll("button")) {
      const name = button.getAttribute("aria-label") ?? button.textContent?.trim();
      expect(name, button.outerHTML).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Delete “Essay draft”" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open “Essay draft”" })).toBeVisible();
  });
});

describe("table", () => {
  it("sorts by clicking a column header and saves the sort on the view", async () => {
    const user = userEvent.setup();
    renderDb(assignments());
    await user.click(screen.getByRole("button", { name: "Weight" }));
    expect(db0().views[0].sorts).toEqual([{ propertyId: "weight", direction: "asc" }]);
    // Empty weights go last.
    expect(tableBodyTitles()).toEqual(["Problem set", "Lab report", "Essay draft", "Quiz prep", "Final project"]);
    await user.click(screen.getByRole("button", { name: "Weight" }));
    expect(tableBodyTitles().slice(0, 3)).toEqual(["Essay draft", "Lab report", "Problem set"]);
    expect(screen.getByRole("columnheader", { name: /Weight/ })).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: "Weight" }));
    expect(db0().views[0].sorts).toBeUndefined();
  });

  it("filters rows with the quick search without saving anything", async () => {
    const user = userEvent.setup();
    renderDb(assignments());
    const before = updates;
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "math");
    expect(tableBodyTitles()).toEqual(["Essay draft", "Quiz prep"]);
    expect(updates).toBe(before);
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(tableBodyTitles()).toHaveLength(5);
  });

  it("shows a summary row with sum and average for number columns", () => {
    renderDb(assignments());
    expect(screen.getByTestId("summary-weight")).toHaveTextContent("Sum 45 · Avg 15");
    expect(screen.getByText("Count: 5")).toBeInTheDocument();
  });

  it("shows relative deadlines, with overdue only for unfinished work", () => {
    const { container } = renderDb(assignments());
    const tones = [...container.querySelectorAll("[data-tone]")].map((el) => [el.textContent, el.getAttribute("data-tone")]);
    expect(tones).toEqual([
      ["Overdue: 2 days ago", "overdue"],
      ["yesterday", "past"], // done, so not overdue
      ["today", "today"],
      ["tomorrow", "soon"],
      ["in 5 weeks", "later"],
    ]);
  });

  it("keeps a new row visible even when the search would hide it", async () => {
    const user = userEvent.setup();
    renderDb(assignments());
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "essay");
    await user.click(screen.getByRole("button", { name: "+ New row" }));
    expect(db0().rows).toHaveLength(6);
    expect(tableBodyTitles()).toEqual(["Essay draft", ""]);
  });

  it("renders only the first 100 of 500 rows, then more on request", async () => {
    const user = userEvent.setup();
    const extra = Array.from({ length: 495 }, (_, i) => ({ id: `x${i}`, cells: { name: `Row ${i}`, weight: 1 } }));
    renderDb(assignments(undefined, extra));
    expect(tableBodyTitles()).toHaveLength(100);
    await user.click(screen.getByRole("button", { name: "Show 400 more" }));
    expect(tableBodyTitles()).toHaveLength(200);
    expect(screen.getByTestId("summary-weight")).toHaveTextContent("Sum 540");
  });
});

describe("filters", () => {
  it("applies the 'due in the next 7 days, not done' preset and saves it with the view", async () => {
    const user = userEvent.setup();
    renderDb(assignments());
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("button", { name: "Due in the next 7 days, not done" }));
    expect(db0().views[0].filters).toEqual([
      { propertyId: "due", operator: "next_days", value: 7 },
      { propertyId: "status", operator: "is_not", value: ["done"] },
    ]);
    expect(tableBodyTitles()).toEqual(["Lab report", "Quiz prep"]);
    expect(screen.getByRole("button", { name: "Filter (2)" })).toBeInTheDocument();
  });

  it("creates a 'This week' list view", async () => {
    const user = userEvent.setup();
    renderDb(assignments());
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("button", { name: "Save as a “This week” view" }));
    const created = db0().views[1];
    expect(created).toMatchObject({ name: "This week", type: "list", datePropertyId: "due" });
    expect(created.sorts).toEqual([{ propertyId: "due", direction: "asc" }]);
    // The new view is active and shows the list layout.
    expect(screen.getByRole("button", { name: "This week", pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    // Each list item's button is named by its title plus its small details.
    expect(screen.getByRole("button", { name: /^Lab report/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Final project/ })).toBeNull();
  });

  it("builds a select filter by hand and clears it", async () => {
    const user = userEvent.setup();
    renderDb(assignments());
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("button", { name: "+ Add filter" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter field" }), "course");
    expect(tableBodyTitles()).toHaveLength(5); // no value chosen yet: nothing hidden
    const panel = screen.getByRole("region", { name: "Filter" });
    await user.click(within(panel).getByRole("button", { name: "+ Choose" }));
    await user.click(within(panel).getByRole("button", { name: "CS 101" }));
    expect(db0().views[0].filters).toEqual([{ propertyId: "course", operator: "is", value: "cs" }]);
    expect(tableBodyTitles()).toEqual(["Problem set", "Lab report", "Final project"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Condition" }), "is_not");
    expect(tableBodyTitles()).toEqual(["Essay draft", "Quiz prep"]);
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(db0().views[0].filters).toBeUndefined();
  });

  it("offers a way out when nothing matches", async () => {
    const user = userEvent.setup();
    renderDb(assignments([{ id: "v", name: "All", type: "table", filters: [{ propertyId: "weight", operator: "gt", value: 100 }] }]));
    expect(screen.getByText("No rows match this view.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(tableBodyTitles()).toHaveLength(5);
  });
});

describe("fields panel", () => {
  it("hides and reorders columns, saved on the view", async () => {
    const user = userEvent.setup();
    renderDb(assignments());
    await user.click(screen.getByRole("button", { name: "Fields" }));
    const panel = screen.getByRole("region", { name: "Fields" });
    await user.click(within(panel).getByRole("checkbox", { name: "Link" }));
    expect(db0().views[0].visiblePropertyIds).toEqual(["name", "course", "status", "due", "weight"]);
    expect(screen.queryByRole("columnheader", { name: "Link" })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Move Weight up" }));
    expect(db0().views[0].visiblePropertyIds).toEqual(["name", "course", "status", "weight", "due"]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.slice(1, -1)).toEqual(["Assignment", "Course", "Status", "Weight", "Due"]);
    await user.click(within(panel).getByRole("checkbox", { name: "Link" }));
    expect(db0().views[0].visiblePropertyIds).toEqual(["name", "course", "status", "weight", "due", "link"]);
  });
});

describe("URL cells", () => {
  it("renders http(s) values as links with an edit button, and nothing else as a link", async () => {
    const user = userEvent.setup();
    renderDb(
      assignments(undefined, [
        { id: "u1", cells: { name: "Syllabus", link: "https://uni.example.edu/syllabus" } },
        { id: "u2", cells: { name: "Bad", link: "javascript:alert(1)" } },
      ]),
    );
    const link = screen.getByRole("link", { name: /uni\.example\.edu\/syllabus/ });
    expect(link).toHaveAttribute("href", "https://uni.example.edu/syllabus");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();

    const editButtons = screen.getAllByRole("button", { name: "Edit link: Link" });
    await user.click(editButtons[0]);
    const input = document.activeElement as HTMLInputElement;
    expect(input).toHaveAccessibleName("Link");
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "https://example.org{Enter}");
    expect(db0().rows.find((r) => r.id === "u1")?.cells.link).toBe("https://example.org");
  });
});

describe("list and gallery views", () => {
  it("list view is a compact list with a done toggle and deadline, not a table", async () => {
    const user = userEvent.setup();
    renderDb(assignments([{ id: "l", name: "List", type: "list" }]));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    const essay = screen.getAllByRole("listitem")[0];
    expect(within(essay).getByText(/2 days ago/)).toBeInTheDocument();
    await user.click(within(essay).getByRole("button", { name: "Mark “Essay draft” done" }));
    expect(db0().rows[0].cells.status).toBe("done");
    await user.click(screen.getByRole("button", { name: "Mark “Essay draft” not done" }));
    expect(db0().rows[0].cells.status).toBe("todo");
  });

  it("gallery view renders cards and opens details from a card", async () => {
    const user = userEvent.setup();
    renderDb(assignments([{ id: "g", name: "Cards", type: "gallery" }]));
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Lab report" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Assignment" })).toHaveValue("Lab report");
  });
});

describe("row detail", () => {
  it("shows every field as a form, saves edits and deletes the row", async () => {
    const user = userEvent.setup();
    renderDb(assignments());
    await user.click(screen.getByRole("button", { name: "Open “Quiz prep”" }));
    const dialog = await screen.findByRole("dialog");
    for (const label of ["Course", "Status", "Due", "Weight", "Link"]) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    const weight = within(dialog).getByRole("spinbutton", { name: "Weight" });
    await user.type(weight, "25");
    await user.tab();
    expect(db0().rows.find((r) => r.id === "d")?.cells.weight).toBe(25);
    await user.click(within(dialog).getByRole("button", { name: "Delete “Quiz prep”" }));
    expect(db0().rows.some((r) => r.id === "d")).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("board", () => {
  const board = () => assignments([{ id: "b", name: "Board", type: "board", groupByPropertyId: "status" }]);

  it("moves a card with the Move to menu (touch and keyboard path)", async () => {
    const user = userEvent.setup();
    renderDb(board());
    const select = screen.getByRole("combobox", { name: "Move “Essay draft” to" });
    expect(select).toHaveDisplayValue("Not started");
    await user.selectOptions(select, "done");
    expect(db0().rows[0].cells.status).toBe("done");
    const doneColumn = screen.getByRole("region", { name: /Done/ });
    expect(within(doneColumn).getByRole("combobox", { name: "Move “Essay draft” to" })).toBeInTheDocument();
  });

  it("shows a count per column and a column for rows without a value", () => {
    renderDb(assignments([{ id: "b", name: "Board", type: "board", groupByPropertyId: "status" }], [
      { id: "z", cells: { name: "Loose idea" } },
    ]));
    expect(screen.getByRole("region", { name: /Not started/ })).toHaveTextContent(/Not started3/);
    const none = screen.getByRole("region", { name: /No Status/ });
    expect(within(none).getByDisplayValue("Loose idea")).toBeInTheDocument();
  });
});

describe("calendar", () => {
  const cal = () => assignments([{ id: "c", name: "Calendar", type: "calendar", datePropertyId: "due" }]);

  it("opens on the current month, marks today and returns with Today", async () => {
    const user = userEvent.setup();
    renderDb(cal());
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    const grid = screen.getByTestId("calendar-grid");
    const todayCell = grid.querySelector('[aria-current="date"]');
    expect(todayCell).toHaveTextContent("12");
    expect(todayCell).toHaveTextContent("Lab report");
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "December 2026" })).toBeInTheDocument();
    expect(within(screen.getByTestId("calendar-grid")).getByText("Final project")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
  });

  it("has an agenda for phones listing days with events, today included", () => {
    renderDb(cal());
    const agenda = screen.getByTestId("calendar-agenda");
    const days = within(agenda).getAllByRole("listitem");
    expect(days.map((d) => d.textContent?.slice(0, 10))).toEqual([
      "Tue, Nov 1",
      "Wed, Nov 1",
      "Thu, Nov 1",
      "Fri, Nov 1",
    ]);
    expect(days[2]).toHaveAttribute("aria-current", "date");
  });

  it("adds an event on a day and opens it for naming", async () => {
    const user = userEvent.setup();
    renderDb(cal());
    const agenda = screen.getByTestId("calendar-agenda");
    await user.click(within(agenda).getByRole("button", { name: "Add on Nov 12, 2026" }));
    const added = db0().rows[db0().rows.length - 1];
    expect(added.cells.due).toBe("2026-11-12");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Assignment" })).toHaveFocus();
  });

  it("follows the local day near midnight", () => {
    vi.setSystemTime(new Date(2026, 10, 30, 23, 59));
    renderDb(cal());
    expect(screen.getByTestId("calendar-grid").querySelector('[aria-current="date"]')).toHaveTextContent("30");
  });
});

describe("changing a column type", () => {
  function openSettings() {
    const summary = screen.getByText("Customize fields & views");
    act(() => {
      (summary.parentElement as HTMLDetailsElement).open = true;
    });
  }

  it("converts values where it can without asking", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    const db = assignments();
    db.properties.push({ id: "pts", name: "Points", type: "text" });
    db.rows[0].cells.pts = "12";
    db.rows[1].cells.pts = "3,5";
    renderDb(db);
    openSettings();
    const typeSelects = screen.getAllByRole("combobox", { name: "Field type" });
    await user.selectOptions(typeSelects[typeSelects.length - 1], "number");
    expect(confirm).not.toHaveBeenCalled();
    expect(db0().properties.find((p) => p.id === "pts")?.type).toBe("number");
    expect(db0().rows[0].cells.pts).toBe(12);
    expect(db0().rows[1].cells.pts).toBe(3.5);
  });

  it("select -> status keeps options and values", async () => {
    const user = userEvent.setup();
    renderDb(assignments());
    openSettings();
    await user.selectOptions(screen.getAllByRole("combobox", { name: "Field type" })[1], "status");
    expect(db0().properties[1]).toMatchObject({ type: "status", options: assignments().properties[1].options });
    expect(db0().rows[0].cells.course).toBe("math");
  });

  it("asks before losing data and does nothing when cancelled", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDb(assignments());
    openSettings();
    await user.selectOptions(screen.getAllByRole("combobox", { name: "Field type" })[0], "number");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("will clear 5 value(s)"));
    expect(db0().properties[0].type).toBe("text");
    expect(db0().rows[0].cells.name).toBe("Essay draft");
    expect(screen.getAllByRole("combobox", { name: "Field type" })[0]).toHaveValue("text");
  });

  it("asks before deleting a field that has data", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDb(assignments());
    openSettings();
    await user.click(screen.getByRole("button", { name: "Delete field: Weight" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("3 row(s)"));
    expect(db0().properties.some((p) => p.id === "weight")).toBe(false);
  });
});
