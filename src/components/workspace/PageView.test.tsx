import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useEffect, useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Block, Workspace } from "@/lib/workspace/types";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));
vi.mock("@/lib/streamdown-plugins", () => ({ streamdownPlugins: {} }));
vi.mock("./DatabaseView", () => ({
  DatabaseView: ({ databaseId }: { databaseId: string }) => <div data-testid="db-view">{databaseId}</div>,
}));
vi.mock("./FlashcardsBlock", () => ({
  FlashcardsBlock: () => <div data-testid="deck" />,
}));
vi.mock("./ReactArtifact", () => ({ ReactArtifact: () => <div /> }));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  const value = { locale: "en", dir: "ltr", dict: en, t: fmt };
  return { useI18n: () => value };
});

import { PageView } from "./PageView";
import { WorkspaceProvider } from "./WorkspaceContext";

beforeAll(() => {
  // Radix menus measure their anchor; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

let current: Workspace;

function Harness({ initial, onUpdate }: { initial: Block[]; onUpdate?: () => void }) {
  const [ws, setWs] = useState<Workspace>(() => ({
    id: "w",
    name: "W",
    pages: [{ id: "p", title: "Notes", blocks: initial }],
    databases: [],
  }));
  // Same contract as WorkspaceEditor: one update() call per edit.
  const update = useCallback(
    (mutator: (d: Workspace) => void) => {
      onUpdate?.();
      setWs((prev) => {
        const next = structuredClone(prev);
        mutator(next);
        return next;
      });
    },
    [onUpdate],
  );
  useEffect(() => {
    current = ws;
  });
  return (
    <WorkspaceProvider
      value={{ workspace: ws, update, status: "saved", rev: 0, agentBusy: false, setAgentBusy: () => {} }}
    >
      <PageView page={ws.pages[0]} />
    </WorkspaceProvider>
  );
}

const blocks = () => current.pages[0].blocks;
const areas = () => Array.from(document.querySelectorAll("textarea"));
const area = (i: number) => areas()[i];
const para = (id: string, text = ""): Block => ({ id, type: "paragraph", text });

function setup(initial: Block[]) {
  const onUpdate = vi.fn();
  const user = userEvent.setup();
  render(<Harness initial={initial} onUpdate={onUpdate} />);
  return { user, onUpdate };
}

async function caretAt(user: ReturnType<typeof userEvent.setup>, el: HTMLTextAreaElement, pos: number) {
  await user.click(el);
  el.setSelectionRange(pos, pos);
}

describe("PageView editor: typing", () => {
  it("Enter splits the block at the caret and moves focus to the new one", async () => {
    const { user } = setup([para("a", "Hello world")]);
    await caretAt(user, area(0), 5);
    await user.keyboard("{Enter}");
    expect(blocks().map((b) => (b as { text: string }).text)).toEqual(["Hello", " world"]);
    await waitFor(() => expect(area(1)).toHaveFocus());
    expect(area(1).selectionStart).toBe(0);
    await user.keyboard("X");
    await user.tab();
    expect((blocks()[1] as { text: string }).text).toBe("X world");
  });

  it("Enter continues a list; Enter on an empty item leaves the list", async () => {
    const { user } = setup([{ id: "b", type: "bulleted_list_item", text: "milk" }]);
    await caretAt(user, area(0), 4);
    await user.keyboard("{Enter}");
    expect(blocks().map((b) => b.type)).toEqual(["bulleted_list_item", "bulleted_list_item"]);
    await waitFor(() => expect(area(1)).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(blocks().map((b) => b.type)).toEqual(["bulleted_list_item", "paragraph"]);
    expect(area(1)).toHaveFocus();
  });

  it("Backspace in an empty block removes it and puts the caret at the end of the block above", async () => {
    const { user } = setup([para("a", "Above"), para("b", "")]);
    await caretAt(user, area(1), 0);
    await user.keyboard("{Backspace}");
    expect(blocks().map((b) => b.id)).toEqual(["a"]);
    await waitFor(() => expect(area(0)).toHaveFocus());
    expect(area(0).selectionStart).toBe(5);
  });

  it("Backspace at the start of text joins it to the block above", async () => {
    const { user } = setup([para("a", "One"), para("b", "Two")]);
    await caretAt(user, area(1), 0);
    await user.keyboard("{Backspace}");
    expect(blocks()).toEqual([para("a", "OneTwo")]);
    await waitFor(() => expect(area(0)).toHaveFocus());
    expect(area(0).selectionStart).toBe(3);
  });

  it("Delete at the end pulls the next block's text up", async () => {
    const { user } = setup([para("a", "One"), para("b", "Two")]);
    await caretAt(user, area(0), 3);
    await user.keyboard("{Delete}");
    expect(blocks()).toEqual([para("a", "OneTwo")]);
    expect(area(0)).toHaveFocus();
    expect(area(0).selectionStart).toBe(3);
  });

  it("shows typeset text at rest and the source while editing", async () => {
    const { user } = setup([para("a", "**Mitosis** has four phases")]);
    expect(screen.getByTestId("md")).toHaveTextContent("**Mitosis** has four phases");
    await user.click(area(0));
    expect(area(0).value).toBe("**Mitosis** has four phases");
    expect(screen.queryByTestId("md")).not.toBeInTheDocument();
    await user.keyboard(" and $x^2$");
    // Math gets a live preview while typing.
    expect(screen.getByTestId("md")).toHaveTextContent("**Mitosis** has four phases and $x^2$");
    await user.tab();
    expect(blocks()[0]).toEqual(para("a", "**Mitosis** has four phases and $x^2$"));
  });

  it("arrow keys at the edges move between blocks", async () => {
    const { user } = setup([para("a", "One"), para("b", "Two")]);
    await caretAt(user, area(0), 3);
    await user.keyboard("{ArrowDown}");
    expect(area(1)).toHaveFocus();
    expect(area(1).selectionStart).toBe(0);
    await user.keyboard("{ArrowLeft}");
    expect(area(0)).toHaveFocus();
  });

  it("keeps multi-line text through an edit and commits it as one step", async () => {
    const { user, onUpdate } = setup([para("a", "line 1\nline 2")]);
    expect(area(0).value).toBe("line 1\nline 2");
    await caretAt(user, area(0), 13);
    await user.keyboard("{Shift>}{Enter}{/Shift}line 3");
    await user.tab();
    expect(blocks()[0]).toEqual(para("a", "line 1\nline 2\nline 3"));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("PageView editor: Markdown shortcuts", () => {
  it.each([
    ["# ", { type: "heading", level: 1 }],
    ["## ", { type: "heading", level: 2 }],
    ["- ", { type: "bulleted_list_item" }],
    ["1. ", { type: "numbered_list_item" }],
    ["[[] ", { type: "todo", checked: false }],
    ["> ", { type: "quote" }],
  ])("typing %j at the start converts the block", async (keys, expected) => {
    const { user } = setup([para("a", "")]);
    await user.click(area(0));
    await user.keyboard(keys);
    expect(blocks()[0]).toMatchObject({ id: "a", text: "", ...expected });
    await user.keyboard("Title");
    expect(area(0)).toHaveFocus();
    await user.tab();
    expect(blocks()[0]).toMatchObject({ id: "a", text: "Title", ...expected });
  });
});

describe("PageView editor: numbering", () => {
  it("numbers list items correctly and restarts after a non-list block", () => {
    const n = (id: string): Block => ({ id, type: "numbered_list_item", text: id });
    setup([n("a"), n("b"), n("c"), para("x", "break"), n("d"), n("e")]);
    const numbers = Array.from(document.querySelectorAll("span.tabular-nums")).map((s) => s.textContent);
    expect(numbers).toEqual(["1.", "2.", "3.", "1.", "2."]);
  });
});

describe("PageView editor: slash menu", () => {
  it("turns the current block into the chosen text type", async () => {
    const { user } = setup([para("a", "")]);
    await user.click(area(0));
    await user.keyboard("/head");
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Heading 1#",
      "Heading 2##",
      "Heading 3###",
    ]);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(blocks()[0]).toEqual({ id: "a", type: "heading", level: 2, text: "" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(area(0)).toHaveFocus();
  });

  it("inserts a non-text block in place of an empty line and keeps typing below it", async () => {
    const { user, onUpdate } = setup([para("a", "Intro"), para("b", "")]);
    await user.click(area(1));
    await user.keyboard("/divider{Enter}");
    expect(blocks().map((b) => b.type)).toEqual(["paragraph", "divider", "paragraph"]);
    expect(blocks()[0]).toEqual(para("a", "Intro"));
    // One coherent step: the "/divider" text is never committed.
    expect(onUpdate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(area(1)).toHaveFocus());
  });

  it("inserts a table below a block that has text, removing the typed command", async () => {
    const { user } = setup([para("a", "Tasks")]);
    await caretAt(user, area(0), 5);
    await user.keyboard(" /table{Enter}");
    expect(blocks()[0]).toEqual(para("a", "Tasks "));
    expect(blocks()[1]).toMatchObject({ type: "database_view" });
    expect(current.databases).toHaveLength(1);
    expect(screen.getByTestId("db-view")).toHaveTextContent(current.databases[0].id);
  });

  it("closes on Escape and leaves the typed text alone", async () => {
    const { user } = setup([para("a", "")]);
    await user.click(area(0));
    await user.keyboard("/xyz");
    expect(screen.getByText("No matching blocks")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("No matching blocks")).not.toBeInTheDocument();
    expect(blocks()[0]).toEqual(para("a", "/xyz"));
  });
});

describe("PageView editor: block menu", () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>, index: number) => {
    await user.click(screen.getAllByRole("button", { name: "Block options" })[index]);
    return screen.findByRole("menu");
  };

  it("turns a block into another type, by keyboard", async () => {
    const { user } = setup([para("a", "Remember this")]);
    // Escape from the text lands on the block handle; Enter opens its menu.
    await user.click(area(0));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Block options" })).toHaveFocus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    const turnInto = within(menu).getByRole("menuitem", { name: "Turn into" });
    turnInto.focus();
    await user.keyboard("{ArrowRight}");
    const quote = await screen.findByRole("menuitem", { name: "Quote" });
    quote.focus();
    await user.keyboard("{Enter}");
    expect(blocks()[0]).toEqual({ id: "a", type: "quote", text: "Remember this" });
    await waitFor(() => expect(area(0)).toHaveFocus());
  });

  it("moves blocks up and down", async () => {
    const { user } = setup([para("a", "A"), para("b", "B"), para("c", "C")]);
    let menu = await openMenu(user, 1);
    await user.click(within(menu).getByRole("menuitem", { name: "Move up" }));
    expect(blocks().map((b) => b.id)).toEqual(["b", "a", "c"]);
    menu = await openMenu(user, 1);
    await user.click(within(menu).getByRole("menuitem", { name: "Move down" }));
    expect(blocks().map((b) => b.id)).toEqual(["b", "c", "a"]);
    menu = await openMenu(user, 0);
    expect(within(menu).getByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
  });

  it("duplicates and deletes", async () => {
    const { user } = setup([para("a", "Only")]);
    let menu = await openMenu(user, 0);
    await user.click(within(menu).getByRole("menuitem", { name: "Duplicate" }));
    expect(blocks().map((b) => (b as { text: string }).text)).toEqual(["Only", "Only"]);
    expect(blocks()[1].id).not.toBe("a");
    menu = await openMenu(user, 1);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete block" }));
    expect(blocks().map((b) => b.id)).toEqual(["a"]);
  });

  it("asks again before deleting a block with data that is not just text", async () => {
    const { user } = setup([
      para("a", "x"),
      { id: "f", type: "flashcards", title: "Bio", cards: [{ id: "c", front: "Q", back: "A" }] },
    ]);
    const menu = await openMenu(user, 1);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete block" }));
    expect(blocks()).toHaveLength(2);
    await user.click(within(menu).getByRole("menuitem", { name: "Tap again to delete" }));
    expect(blocks().map((b) => b.id)).toEqual(["a"]);
  });

  it("moves the focused block with Ctrl+Shift+Arrow, keeping focus", async () => {
    const { user } = setup([para("a", "A"), para("b", "B")]);
    await caretAt(user, area(1), 1);
    await user.keyboard("{Control>}{Shift>}{ArrowUp}{/Shift}{/Control}");
    expect(blocks().map((b) => b.id)).toEqual(["b", "a"]);
    await waitFor(() => expect(area(0)).toHaveFocus());
    expect(area(0).value).toBe("B");
  });
});

describe("PageView editor: + menu", () => {
  it("inserts a searched block type below the chosen block", async () => {
    const { user } = setup([para("a", "One"), para("b", "Two")]);
    await user.click(screen.getAllByRole("button", { name: "Insert block" })[0]);
    const search = await screen.findByRole("combobox", { name: "Search blocks…" });
    await waitFor(() => expect(search).toHaveFocus());
    await user.keyboard("to-do{Enter}");
    expect(blocks().map((b) => b.type)).toEqual(["paragraph", "todo", "paragraph"]);
    await waitFor(() => expect(area(1)).toHaveFocus());
  });

  it("the page's Add block button appends at the end", async () => {
    const { user } = setup([para("a", "One")]);
    await user.click(screen.getByRole("button", { name: "+ Add block" }));
    await screen.findByRole("combobox", { name: "Search blocks…" });
    await user.click(screen.getByRole("option", { name: /Flashcards/ }));
    expect(blocks()[1]).toMatchObject({ type: "flashcards", cards: [] });
  });
});
