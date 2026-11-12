import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emit, OPEN_STUDY_HUB_EVENT, SHOW_GETTING_STARTED_EVENT } from "@/components/command/events";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceContext";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Workspace } from "@/lib/workspace/types";
import {
  baselineOf,
  countCompleted,
  countDated,
  foldOnboardingEvents,
  sessionProgress,
} from "./checklist";
import { GettingStarted } from "./GettingStarted";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  mark: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("./actions", () => ({
  getOnboardingStateAction: mocks.get,
  markOnboardingItemAction: mocks.mark,
  setOnboardingDismissedAction: mocks.dismiss,
}));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  return { useI18n: () => ({ dict: en, t: fmt, dir: "ltr", locale: "en" }) };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const G = en.gettingStarted;

function workspace(checked = false, due = ""): Workspace {
  return {
    id: "w1",
    name: "Fall",
    pages: [
      {
        id: "p1",
        title: "Home",
        blocks: [
          { id: "t1", type: "todo", text: "Read chapter 1", checked },
          { id: "f1", type: "flashcards", cards: [{ id: "c1", front: "a", back: "b" }] },
        ],
      },
    ],
    databases: [
      {
        id: "d1",
        name: "Assignments",
        properties: [
          { id: "n", name: "Name", type: "text" },
          { id: "due", name: "Due", type: "date" },
        ],
        rows: [{ id: "r1", cells: { n: "Essay", due } }],
        views: [{ id: "v", name: "Table", type: "table" }],
      },
    ],
  };
}

function Harness({ ws, onAskAi = () => {} }: { ws: Workspace; onAskAi?: () => void }) {
  return (
    <WorkspaceProvider
      value={{
        workspace: ws,
        update: () => {},
        status: "saved",
        rev: 0,
        agentBusy: false,
        setAgentBusy: () => {},
        undo: () => {},
        redo: () => {},
        canUndo: false,
        canRedo: false,
      } as unknown as React.ComponentProps<typeof WorkspaceProvider>["value"]}
    >
      <GettingStarted onAskAi={onAskAi} />
    </WorkspaceProvider>
  );
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  mocks.get.mockResolvedValue({ done: ["calendar"], dismissed: false });
  mocks.mark.mockResolvedValue(undefined);
  mocks.dismiss.mockResolvedValue(undefined);
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

async function openPanel() {
  const trigger = await screen.findByRole("button", { name: `${G.button} · 1 of 5` });
  await userEvent.click(trigger);
  return screen.findByRole("dialog", { name: G.title });
}

describe("GettingStarted", () => {
  it("shows progress from the server and does not open by itself on a phone", async () => {
    render(<Harness ws={workspace()} />);
    expect(await screen.findByRole("button", { name: `${G.button} · 1 of 5` })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists the five items with what is done", async () => {
    render(<Harness ws={workspace()} />);
    const panel = await openPanel();
    for (const key of ["checkOff", "askAi", "study", "deadlines", "calendar"] as const) {
      expect(within(panel).getByText(G.items[key].title)).toBeInTheDocument();
    }
    expect(within(panel).getAllByText(G.done)).toHaveLength(1);
    expect(within(panel).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });

  it("ticks 'check something off' when the student checks a to-do", async () => {
    const { rerender } = render(<Harness ws={workspace(false)} />);
    await screen.findByRole("button", { name: `${G.button} · 1 of 5` });
    rerender(<Harness ws={workspace(true)} />);
    expect(await screen.findByRole("button", { name: `${G.button} · 2 of 5` })).toBeInTheDocument();
    await waitFor(() => expect(mocks.mark).toHaveBeenCalledWith("checkOff"));
  });

  it("ticks 'add your deadlines' when a dated row appears", async () => {
    const { rerender } = render(<Harness ws={workspace(false, "")} />);
    await screen.findByRole("button", { name: `${G.button} · 1 of 5` });
    rerender(<Harness ws={workspace(false, "2026-12-01")} />);
    await waitFor(() => expect(mocks.mark).toHaveBeenCalledWith("deadlines"));
  });

  it("runs an item's action", async () => {
    const onAskAi = vi.fn();
    const hub = vi.fn();
    window.addEventListener(OPEN_STUDY_HUB_EVENT, hub);
    render(<Harness ws={workspace()} onAskAi={onAskAi} />);
    let panel = await openPanel();
    await userEvent.click(within(panel).getByRole("button", { name: G.items.askAi.action }));
    expect(onAskAi).toHaveBeenCalled();
    panel = await openPanel();
    await userEvent.click(within(panel).getByRole("button", { name: G.items.study.action }));
    expect(hub).toHaveBeenCalled();
    window.removeEventListener(OPEN_STUDY_HUB_EVENT, hub);
  });

  it("stays dismissed, and can be brought back", async () => {
    render(<Harness ws={workspace()} />);
    const panel = await openPanel();
    await userEvent.click(within(panel).getByRole("button", { name: G.dismiss }));
    expect(mocks.dismiss).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("button", { name: /Getting started/ })).toBeNull();

    act(() => emit(SHOW_GETTING_STARTED_EVENT));
    expect(await screen.findByRole("dialog", { name: G.title })).toBeInTheDocument();
    expect(mocks.dismiss).toHaveBeenLastCalledWith(false);
  });

  it("renders nothing when the server says it was dismissed or finished", async () => {
    mocks.get.mockResolvedValue({ done: [], dismissed: true });
    const { unmount } = render(<Harness ws={workspace()} />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Getting started/ })).toBeNull();
    unmount();

    mocks.get.mockResolvedValue({ done: ["checkOff", "askAi", "study", "deadlines", "calendar"], dismissed: false });
    render(<Harness ws={workspace()} />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: /Getting started/ })).toBeNull();
  });

  it("opens by itself once on a large screen", async () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query }) as MediaQueryList) as typeof window.matchMedia;
    const { unmount } = render(<Harness ws={workspace()} />);
    expect(await screen.findByRole("dialog", { name: G.title })).toBeInTheDocument();
    unmount();
    render(<Harness ws={workspace()} />);
    await screen.findByRole("button", { name: `${G.button} · 1 of 5` });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  const largeScreen = () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query }) as MediaQueryList) as typeof window.matchMedia;
  };

  it("does not open by itself when the student arrived through a deep link, and still can later", async () => {
    largeScreen();
    window.history.replaceState(null, "", "/app/w1?page=p1&db=d1&row=r1");
    try {
      const { unmount } = render(<Harness ws={workspace()} />);
      await screen.findByRole("button", { name: `${G.button} · 1 of 5` });
      expect(screen.queryByRole("dialog")).toBeNull();
      unmount();
    } finally {
      window.history.replaceState(null, "", "/");
    }
    // The one automatic opening was not used up by the deep link.
    render(<Harness ws={workspace()} />);
    expect(await screen.findByRole("dialog", { name: G.title })).toBeInTheDocument();
  });

  it("does not open by itself over a dialog that is already showing", async () => {
    largeScreen();
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    other.setAttribute("data-state", "open");
    document.body.appendChild(other);
    try {
      render(<Harness ws={workspace()} />);
      await screen.findByRole("button", { name: `${G.button} · 1 of 5` });
      expect(screen.queryByRole("dialog", { name: G.title })).toBeNull();
    } finally {
      other.remove();
    }
  });

  it("steps aside when a dialog opens", async () => {
    render(<Harness ws={workspace()} />);
    await openPanel();
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    other.setAttribute("data-state", "open");
    act(() => {
      document.body.appendChild(other);
    });
    try {
      await waitFor(() => expect(screen.queryByRole("dialog", { name: G.title })).toBeNull());
    } finally {
      other.remove();
    }
  });
});

describe("checklist logic", () => {
  it("folds milestone events, latest of dismissed/restored wins", () => {
    const at = (n: number) => new Date(n);
    expect(
      foldOnboardingEvents([
        { kind: "evt:onboarding:study", createdAt: at(1) },
        { kind: "evt:onboarding:dismissed", createdAt: at(2) },
        { kind: "evt:onboarding:bogus", createdAt: at(3) },
        { kind: "evt:other", createdAt: at(3) },
      ]),
    ).toEqual({ done: ["study"], dismissed: true });
    expect(
      foldOnboardingEvents([
        { kind: "evt:onboarding:dismissed", createdAt: at(2) },
        { kind: "evt:onboarding:restored", createdAt: at(5) },
      ]).dismissed,
    ).toBe(false);
  });

  it("counts completed items and dated rows", () => {
    expect(countCompleted(workspace(true))).toBe(1);
    expect(countDated(workspace(false, "2026-01-01"))).toBe(1);
    const base = baselineOf(workspace(false, ""));
    expect(sessionProgress(workspace(true, "2026-01-01"), base)).toEqual(["checkOff", "deadlines"]);
    expect(sessionProgress(workspace(false, ""), base)).toEqual([]);
  });
});
