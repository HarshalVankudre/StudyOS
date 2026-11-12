import { useMemo } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { DraftInput } from "./editor/DraftInput";
import { PendingFieldsContext } from "./editor/pendingFields";
import { useWorkspaceSync } from "./useWorkspaceSync";

const actions = vi.hoisted(() => ({
  saveWorkspaceAction: vi.fn(),
  getWorkspaceStateAction: vi.fn(),
  getWorkspaceVersionAction: vi.fn(),
}));
vi.mock("@/app/app/actions", () => actions);

function installMemoryStorage(name: "localStorage" | "sessionStorage") {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(window, name, { value: storage, configurable: true });
  return data;
}

const workspace: Workspace = {
  id: "w1",
  name: "W",
  pages: [{ id: "p1", title: "Biology", blocks: [] }],
  databases: [],
};

/** The parts of WorkspaceEditor that matter here: the engine and a title field. */
function Editor() {
  const { sync, snapshot } = useWorkspaceSync("w1", workspace, 1, {
    onRemoval: () => {},
    onNotice: () => {},
  });
  const fieldSync = useMemo(
    () => ({ register: (f: Parameters<typeof sync.registerField>[0]) => sync.registerField(f), rev: snapshot.rev }),
    [sync, snapshot.rev],
  );
  return (
    <PendingFieldsContext.Provider value={fieldSync}>
      <DraftInput
        aria-label="Page title"
        value={snapshot.workspace.pages[0].title}
        onCommit={(title) => sync.update((d) => void (d.pages[0].title = title))}
      />
    </PendingFieldsContext.Provider>
  );
}

let local: Map<string, string>;
beforeEach(() => {
  local = installMemoryStorage("localStorage");
  installMemoryStorage("sessionStorage");
  actions.saveWorkspaceAction.mockImplementation(() => new Promise(() => {})); // a phone about to freeze
  actions.getWorkspaceStateAction.mockResolvedValue({ workspace, version: 1 });
  actions.getWorkspaceVersionAction.mockResolvedValue(1);
});

describe("useWorkspaceSync and buffered fields (finding 7)", () => {
  it("hiding the tab writes a title still being typed to the local copy at once", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.type(screen.getByLabelText("Page title"), " notes");
    const draftsBefore = [...local.keys()].filter((k) => k.startsWith("studyos:draft:"));
    expect(draftsBefore).toEqual([]); // still only in the field

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Synchronously, before the page can be frozen.
    const drafts = [...local.entries()].filter(([k]) => k.startsWith("studyos:draft:"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0][1]).toContain("Biology notes");
    // ...and the save starts right away (next microtask), not after the debounce.
    await vi.waitFor(() => expect(actions.saveWorkspaceAction).toHaveBeenCalled(), { timeout: 100 });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("closing sends typing still only in a field to the server, so no leave prompt", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response("{}")),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const user = userEvent.setup();
      render(<Editor />);
      await user.type(screen.getByLabelText("Page title"), "!");
      const event = new Event("beforeunload", { cancelable: true });
      act(() => {
        window.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/workspace/save");
      expect(init.keepalive).toBe(true);
      const body = JSON.parse(String(init.body)) as { id: string; baseVersion: number; saveId: string; ops: unknown[] };
      expect(body).toMatchObject({ id: "w1", baseVersion: 1 });
      expect(body.saveId).toMatch(/\S{8,}/);
      expect(JSON.stringify(body.ops)).toContain("Biology!");

      // pagehide right after: not sent a second time; the tab says goodbye
      // (its draft may be recovered at once, it is not "alive").
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const draft = [...local.entries()].find(([k]) => k.startsWith("studyos:draft:"));
      expect(draft?.[1]).toContain("Biology!"); // the local fallback stays
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the leave prompt counts typing that is still only in a field when it cannot be sent", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      const user = userEvent.setup();
      render(<Editor />);
      await user.type(screen.getByLabelText("Page title"), "!");
      const event = new Event("beforeunload", { cancelable: true });
      act(() => {
        window.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
    } finally {
      online.mockRestore();
    }
  });
});
