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
let session: Map<string, string>;
beforeEach(() => {
  local = installMemoryStorage("localStorage");
  session = installMemoryStorage("sessionStorage");
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

  // Third review: nothing is sent to the server while the page closes except
  // an ordinary save. Typing that has not been confirmed is written to the
  // local draft synchronously, and the student is asked before leaving.
  it("closing writes typing still only in a field to the local draft and asks before leaving", async () => {
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
      expect(event.defaultPrevented).toBe(true); // not on the server yet: "leave site?"
      const draft = [...local.entries()].find(([k]) => k.startsWith("studyos:draft:"));
      expect(draft?.[1]).toContain("Biology!");
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      // No request that outlives the page: no patch is ever applied server-side.
      expect(fetchMock).not.toHaveBeenCalled();
      expect([...local.entries()].find(([k]) => k.startsWith("studyos:draft:"))?.[1]).toContain("Biology!");
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

describe("tab ids (third review, finding 10)", () => {
  it("a duplicated tab never shares its id with the original, however long that was frozen", async () => {
    const user = userEvent.setup();
    const draftKeys = () => [...local.keys()].filter((k) => k.startsWith("studyos:draft:"));
    const hide = () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    };
    const first = render(<Editor />);
    await user.type(first.getByLabelText("Page title"), " one");
    hide();
    expect(draftKeys()).toHaveLength(1);
    const [originalKey] = draftKeys();
    // The original shows no sign of life for a long time (frozen by the OS)...
    for (const key of [...local.keys()]) if (key.startsWith("studyos:tab:")) local.set(key, String(Date.now() - 600_000));
    // ...and the browser duplicates the tab: a new page load that copies sessionStorage.
    const copied = new Map(session);
    const second = render(<Editor />);
    for (const [k, v] of copied) expect(session.get(k)).toBe(v); // nothing of the original's is taken over
    const titles = second.getAllByLabelText("Page title");
    await user.type(titles[titles.length - 1], " two");
    hide();
    // The duplicate writes its draft under an id of its own, never under the
    // original's (which it may have taken over as that of a closed tab).
    const own = draftKeys().filter((k) => !k.includes("~"));
    expect(own).toHaveLength(1);
    expect(own[0]).not.toBe(originalKey);
  });
});
