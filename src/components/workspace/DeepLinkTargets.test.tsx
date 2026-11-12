import { render, screen, waitFor, within } from "@testing-library/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Block, Database, Workspace } from "@/lib/workspace/types";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("@/lib/streamdown-plugins", () => ({ streamdownPlugins: {}, streamdownRehypePlugins: [] }));
vi.mock("./FlashcardsBlock", () => ({ FlashcardsBlock: () => <div /> }));
vi.mock("./ReactArtifact", () => ({ ReactArtifact: () => <div /> }));
vi.mock("./quiz/QuizBlock", () => ({ QuizBlock: () => <div /> }));
vi.mock("./grades/GradesBlock", () => ({ GradesBlock: () => <div /> }));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  const { pluralizer } = await import("@/lib/i18n/plural");
  const value = { locale: "en", dir: "ltr", dict: en, t: fmt, plural: pluralizer("en") };
  return { useI18n: () => value };
});

import { DeepLinkProvider, type DeepLinkApi, type DeepLinkFocus } from "./DeepLinkContext";
import { PageView } from "./PageView";
import { WorkspaceProvider } from "./WorkspaceContext";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

const tasks: Database = {
  id: "db",
  name: "Assignments",
  properties: [
    { id: "name", name: "Assignment", type: "text" },
    { id: "due", name: "Due", type: "date" },
  ],
  rows: [
    { id: "r1", cells: { name: "Essay", due: "2026-11-14" } },
    { id: "r2", cells: { name: "Lab report", due: "2026-11-16" } },
  ],
  views: [{ id: "v", name: "All", type: "table" }],
};

function Harness({ blocks, focus }: { blocks: Block[]; focus: DeepLinkFocus }) {
  const [ws, setWs] = useState<Workspace>({
    id: "w",
    name: "W",
    pages: [{ id: "p", title: "Notes", blocks }],
    databases: [tasks],
  });
  const update = useCallback((mutator: (d: Workspace) => void) => {
    setWs((prev) => {
      const next = structuredClone(prev);
      mutator(next);
      return next;
    });
  }, []);
  const claimed = useRef(new Set<number>());
  const claim = useCallback((seq: number) => {
    if (claimed.current.has(seq)) return false;
    claimed.current.add(seq);
    return true;
  }, []);
  const deepLink = useMemo<DeepLinkApi>(() => ({ focus, claim }), [claim, focus]);
  return (
    <WorkspaceProvider
      value={{ workspace: ws, update, status: "saved", rev: 0, agentBusy: false, setAgentBusy: () => {} }}
    >
      <DeepLinkProvider value={deepLink}>
        <PageView page={ws.pages[0]} />
      </DeepLinkProvider>
    </WorkspaceProvider>
  );
}

describe("deep-link targets in the editor", () => {
  it("scrolls a linked block into view and highlights it", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(
      <Harness
        blocks={[
          { id: "a", type: "paragraph", text: "First" },
          { id: "target", type: "todo", text: "Email the tutor", checked: false },
        ]}
        focus={{ seq: 1, kind: "block", blockId: "target" }}
      />,
    );
    const row = document.querySelector<HTMLElement>('[data-block-id="target"]')!;
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(row);
    expect(row).toHaveAttribute("data-deep-link-target", "true");
    expect(row.className).toContain("ring-2");
  });

  it("opens the linked row's detail sheet, once, even when the database is shown twice", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <Harness
        blocks={[
          { id: "v1", type: "database_view", databaseId: "db", viewId: "v" },
          { id: "v2", type: "database_view", databaseId: "db", viewId: "v" },
        ]}
        focus={{ seq: 1, kind: "row", databaseId: "db", rowId: "r2" }}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Assignments");
    expect(within(dialog).getByDisplayValue("Lab report")).toBeInTheDocument();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
