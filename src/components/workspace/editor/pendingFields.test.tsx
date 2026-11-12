import { useCallback, useLayoutEffect, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Database, Workspace } from "@/lib/workspace/types";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { WorkspaceProvider } from "../WorkspaceContext";
import { EditableCell } from "../database/cells";
import { DraftInput } from "./DraftInput";
import { PendingFieldsContext, type PendingField } from "./pendingFields";

/** What the sync engine does with registered fields. */
function registry() {
  const fields = new Set<PendingField>();
  return {
    register: (field: PendingField) => {
      fields.add(field);
      return () => void fields.delete(field);
    },
    pending: () => [...fields].some((f) => f.hasPending()),
    commitAll: () => fields.forEach((f) => f.hasPending() && f.commit()),
    size: () => fields.size,
  };
}

describe("buffered text fields (finding 7)", () => {
  it("a DraftInput registers its typing and writes it when the engine asks", async () => {
    const user = userEvent.setup();
    const reg = registry();
    const onCommit = vi.fn();
    render(
      <PendingFieldsContext.Provider value={{ register: reg.register, rev: 0 }}>
        <DraftInput aria-label="Title" value="Biology" onCommit={onCommit} />
      </PendingFieldsContext.Provider>,
    );
    expect(reg.size()).toBe(1);
    await user.type(screen.getByLabelText("Title"), " notes");
    // Still buffered (no pause, no blur), but counted as unsaved.
    expect(onCommit).not.toHaveBeenCalled();
    expect(reg.pending()).toBe(true);
    // Tab hidden / undo / merge: written synchronously.
    act(() => reg.commitAll());
    expect(onCommit).toHaveBeenCalledWith("Biology notes");
    expect(reg.pending()).toBe(false);
  });

  it("follows an undo run in the same moment as its own commit (finding 16)", async () => {
    const user = userEvent.setup();
    const reg = registry();
    function Harness() {
      const [value, setValue] = useState("A");
      const [rev, setRev] = useState(0);
      return (
        <PendingFieldsContext.Provider value={{ register: reg.register, rev }}>
          <DraftInput aria-label="Field" value={value} onCommit={setValue} />
          {/* What the engine's undo() does: write buffered typing, undo it, bump rev. */}
          <button
            onClick={() => {
              reg.commitAll();
              setValue("A");
              setRev((r) => r + 1);
            }}
          >
            undo
          </button>
        </PendingFieldsContext.Provider>
      );
    }
    render(<Harness />);
    const field = screen.getByLabelText("Field");
    await user.type(field, "B");
    // A tap that does not move focus (iPhone): no blur before the click.
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    expect(field).toHaveValue("A");
  });
});

// ---------------------------------------------------------------------------

const db: Database = {
  id: "db",
  name: "Tasks",
  properties: [
    { id: "name", name: "Name", type: "text" },
    { id: "pts", name: "Points", type: "number" },
    { id: "other", name: "Other", type: "text" },
  ],
  rows: [{ id: "r1", cells: { name: "Essay", pts: 3, other: "x" } }],
  views: [{ id: "v", name: "Table", type: "table" }],
};

let latest: Workspace;
let replaceFromOutside: (fn: (d: Workspace) => void) => void = () => {};

function CellsHarness({ reg }: { reg: ReturnType<typeof registry> }) {
  const [state, setState] = useState({ ws: { id: "w", name: "W", pages: [], databases: [db] } as Workspace, rev: 0 });
  useLayoutEffect(() => {
    latest = state.ws;
  });
  const update = useCallback((mutator: (draft: Workspace) => void) => {
    setState((prev) => {
      const next = structuredClone(prev.ws);
      mutator(next);
      return { ws: next, rev: prev.rev };
    });
  }, []);
  // A newer version arrives (another tab, the AI agent). Like the engine:
  // buffered typing is written first, then the change lands and rev bumps.
  useLayoutEffect(() => {
    replaceFromOutside = (fn) => {
      reg.commitAll();
      setState((prev) => {
        const next = structuredClone(prev.ws);
        fn(next);
        return { ws: next, rev: prev.rev + 1 };
      });
    };
  }, [reg]);
  const row = state.ws.databases[0].rows[0];
  return (
    <I18nProvider locale="en" dictionary={en}>
      <WorkspaceProvider
        value={{ workspace: state.ws, update, status: "saved", rev: state.rev, agentBusy: false, setAgentBusy: () => {} }}
      >
        <PendingFieldsContext.Provider value={{ register: reg.register, rev: state.rev }}>
          {db.properties.slice(0, 2).map((prop) => (
            <EditableCell key={prop.id} databaseId="db" rowId="r1" prop={prop} value={row.cells[prop.id] ?? null} />
          ))}
        </PendingFieldsContext.Provider>
      </WorkspaceProvider>
    </I18nProvider>
  );
}

describe("database cells keep half-typed values (finding 7)", () => {
  it("an outside reload does not remount the cell or lose what is being typed", async () => {
    const user = userEvent.setup();
    const reg = registry();
    render(<CellsHarness reg={reg} />);
    const name = screen.getByRole("textbox", { name: "Name" });
    const points = screen.getByRole("spinbutton", { name: "Points" });

    await user.click(name);
    await user.type(name, " draft");
    // Buffered until a pause or blur, but already counted as unsaved.
    expect(reg.pending()).toBe(true);
    // The AI agent changes another cell while the student is typing.
    act(() => replaceFromOutside((d) => (d.databases[0].rows[0].cells.other = "agent")));
    expect(screen.getByRole("textbox", { name: "Name" })).toBe(name); // not remounted
    expect(name).toHaveValue("Essay draft");

    await user.clear(points);
    await user.type(points, "12");
    act(() => replaceFromOutside((d) => (d.databases[0].rows[0].cells.other = "agent 2")));
    expect(screen.getByRole("spinbutton", { name: "Points" })).toBe(points);
    expect(points).toHaveValue(12);

    expect(reg.pending()).toBe(false);
    expect(latest.databases[0].rows[0].cells).toMatchObject({
      name: "Essay draft",
      pts: 12,
      other: "agent 2",
    });
  });

  it("a cell with nothing typed follows outside changes", () => {
    const reg = registry();
    render(<CellsHarness reg={reg} />);
    act(() => replaceFromOutside((d) => (d.databases[0].rows[0].cells.name = "Renamed by the agent")));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Renamed by the agent");
  });
});
