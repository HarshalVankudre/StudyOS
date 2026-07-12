import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";

// A mutable workspace the mocked context mutates via `update`.
let workspace: Workspace;
// Tolerate non-function calls: the always-rendered settings panel has many
// controlled inputs whose jsdom reconciliation can trip the mock; the real
// update() always receives a function, and the assertions below verify the
// actual mutations.
const update = vi.fn((mutator: unknown) => {
  if (typeof mutator === "function") (mutator as (d: Workspace) => void)(workspace);
});
vi.mock("./WorkspaceContext", () => ({
  useWorkspace: () => ({ workspace, update, rev: 0 }),
}));
vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({
    dict: {
      db: {
        databaseIcon: "icon", nameAria: "name", newRow: "New row", newCard: "New",
        untitled: "Untitled", empty: "—", deleteRow: "Delete row", deleteCard: "Delete card",
        dragHint: "", prevMonth: "", nextMonth: "", addOnDay: "", clickToRename: "",
        delete: "Delete", addTag: "Add", addLink: "Link",
      },
      dbSettings: { customize: "Customize", propertyTypes: {}, viewTypes: {} },
    },
    t: (s: string) => s,
    locale: "en",
  }),
}));

import { DatabaseView } from "./DatabaseView";

function withDeck(cells: Record<string, unknown>) {
  workspace = {
    id: "w",
    name: "W",
    databases: [
      {
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
        ],
        rows: [{ id: "r1", cells: { title: "Datenbanken 1", ...cells } }],
        views: [{ id: "v", name: "All", type: "table" }],
      },
    ],
    pages: [],
  };
}

beforeEach(() => update.mockClear());

describe("multi_select cell (regression: was a broken native listbox)", () => {
  it("renders selected values as pills, not a <select multiple> listbox", () => {
    withDeck({ themen: ["o1", "o2"] });
    const { container } = render(<DatabaseView databaseId="db" viewId="v" />);
    // No native multi-select listbox anywhere.
    expect(container.querySelector("select[multiple]")).toBeNull();
    // Selected options show as readable pills.
    expect(screen.getByText("SQL-Syntax")).toBeInTheDocument();
    expect(screen.getByText("JOINs")).toBeInTheDocument();
  });

  it("adds a tag via the inline menu", async () => {
    const user = userEvent.setup();
    withDeck({ themen: ["o1"] });
    render(<DatabaseView databaseId="db" viewId="v" />);
    await user.click(screen.getByRole("button", { name: /Add/ }));
    // Unselected option appears in the inline add-menu; click it.
    await user.click(screen.getByRole("button", { name: /Normalisierung/ }));
    const row = workspace.databases[0].rows[0];
    expect(row.cells.themen).toEqual(["o1", "o3"]);
  });

  it("removes a tag via its ✕", async () => {
    const user = userEvent.setup();
    withDeck({ themen: ["o1", "o2"] });
    render(<DatabaseView databaseId="db" viewId="v" />);
    await user.click(screen.getByRole("button", { name: "Remove SQL-Syntax" }));
    const row = workspace.databases[0].rows[0];
    expect(row.cells.themen).toEqual(["o2"]);
  });

  it("handles an empty value without crashing", () => {
    withDeck({});
    render(<DatabaseView databaseId="db" viewId="v" />);
    // Just the add affordance, no pills, no listbox.
    expect(screen.getByRole("button", { name: /Add/ })).toBeInTheDocument();
  });
});

function withStatus(cells: Record<string, unknown>) {
  workspace = {
    id: "w",
    name: "W",
    databases: [
      {
        id: "db",
        name: "Klausuren",
        properties: [
          { id: "title", name: "Klausur", type: "text" },
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
        rows: [{ id: "r1", cells: { title: "DB1", ...cells } }],
        views: [{ id: "v", name: "All", type: "table" }],
      },
    ],
    pages: [],
  };
}

describe("select/status cell renders as a colored pill", () => {
  it("shows the selected status as a pill, not a native dropdown", () => {
    withStatus({ status: "s1" });
    const { container } = render(<DatabaseView databaseId="db" viewId="v" />);
    // The cell is no longer a native single <select> with option children.
    const cellSelects = container.querySelectorAll("table select");
    expect(cellSelects.length).toBe(0);
    expect(screen.getByText("In Vorbereitung")).toBeInTheDocument();
  });

  it("changes the value via the inline menu", async () => {
    const user = userEvent.setup();
    withStatus({ status: "s1" });
    render(<DatabaseView databaseId="db" viewId="v" />);
    await user.click(screen.getByRole("button", { name: /In Vorbereitung/ }));
    await user.click(screen.getByRole("button", { name: /Fertig/ }));
    expect(workspace.databases[0].rows[0].cells.status).toBe("s2");
  });
});
