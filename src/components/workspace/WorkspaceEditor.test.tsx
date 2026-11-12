import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { saveLabelStatus, WorkspaceEditor } from "./WorkspaceEditor";

const actions = vi.hoisted(() => ({
  saveWorkspaceAction: vi.fn(),
  getWorkspaceStateAction: vi.fn(),
  getWorkspaceVersionAction: vi.fn(),
}));

vi.mock("@/app/app/actions", () => actions);
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <button>Language</button>,
}));
vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button>Theme</button>,
}));
vi.mock("@/components/account/AccountMenu", () => ({
  AccountMenu: () => <div>Account</div>,
}));
vi.mock("@/components/account/CreditMeter", () => ({
  CreditMeter: () => <div>Credits</div>,
}));
vi.mock("./AgentChat", () => ({
  AgentChat: () => <aside>Agent</aside>,
}));
vi.mock("./PageView", () => ({
  PageView: ({ page }: { page: { title: string } }) => <div>Page: {page.title}</div>,
}));
vi.mock("./StudyLauncher", () => ({
  StudyLauncher: () => null,
}));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  return {
    useI18n: () => ({ dict: en, t: fmt, dir: "ltr", locale: "en" }),
  };
});

// sonner reads the colour scheme; jsdom has no matchMedia.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// sonner's swipe-to-dismiss uses pointer capture, which jsdom lacks.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

const workspace: Workspace = {
  id: "workspace-1",
  name: "Test workspace",
  icon: "📚",
  homePageId: "page-1",
  pages: [
    { id: "page-1", title: "Biology", icon: "🧬", blocks: [] },
    { id: "page-2", title: "Chemistry", icon: "⚗️", blocks: [] },
  ],
  databases: [],
};

// A plain in-memory localStorage (Node's experimental one is not usable here).
function installMemoryStorage() {
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
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}

beforeEach(() => {
  installMemoryStorage();
  actions.saveWorkspaceAction.mockImplementation(
    async (_id: string, _ws: Workspace, base: number) => ({ status: "saved", version: base + 1 }),
  );
  actions.getWorkspaceStateAction.mockResolvedValue({ workspace, version: 1 });
  actions.getWorkspaceVersionAction.mockResolvedValue(1);
});

function renderEditor() {
  return render(
    <WorkspaceEditor id="workspace-1" initialWorkspace={workspace} initialVersion={1} />,
  );
}

describe("WorkspaceEditor responsive navigation", () => {
  it("opens the mobile page drawer and closes it after navigation", async () => {
    const user = userEvent.setup();
    renderEditor();

    const menu = screen.getByRole("button", { name: "Open menu" });
    expect(screen.getByRole("button", { name: "Close menu", hidden: true })).toBeInTheDocument();
    const sidebar = screen.getByRole("complementary", { name: "Test workspace" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(sidebar).toHaveClass("-translate-x-full");

    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(sidebar).toHaveClass("translate-x-0");

    await user.click(screen.getByRole("button", { name: /^\W*Biology$/u }));
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(sidebar).toHaveClass("-translate-x-full");
  });

  it("keeps destructive page actions out of the Tab order between pages", () => {
    renderEditor();
    const nav = screen.getByRole("complementary", { name: "Test workspace" });
    const tabbable = [...nav.querySelectorAll<HTMLElement>("button, a, input")].filter((el) => el.tabIndex >= 0);
    const names = tabbable.map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim());
    // No delete buttons at all; only the open page's actions menu is a stop.
    expect(names.some((n) => /delete/i.test(n ?? ""))).toBe(false);
    expect(names.filter((n) => n?.startsWith("Actions for page"))).toEqual(["Actions for page Biology"]);
  });

  it("labels Ask AI and gathers the other header actions in one menu on phones", async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(screen.getByRole("button", { name: "Ask AI" })).toHaveTextContent("Ask AI");
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const items = (await screen.findAllByRole("menuitem")).map((i) => i.textContent);
    expect(items).toEqual([
      "Search",
      "Undo",
      "Redo",
      "Show the getting-started guide",
      "Export or print…",
    ]);
  });

  it("starts a new page with one empty line, not an \"Untitled\" heading", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: /New page/ }));
    expect(screen.getByText("Page: Untitled")).toBeInTheDocument();
    await waitFor(() => expect(actions.saveWorkspaceAction).toHaveBeenCalled(), { timeout: 3000 });
    const [, saved] = actions.saveWorkspaceAction.mock.calls.at(-1)!;
    expect(saved.pages[2].blocks).toEqual([{ id: expect.any(String), type: "paragraph", text: "" }]);
  });

  it("exposes save feedback as an announced status", () => {
    renderEditor();
    expect(screen.getByRole("status", { name: "Saved" })).toBeInTheDocument();
  });
});

describe("WorkspaceEditor undo history", () => {
  it("undo and redo buttons restore exact prior states and save them", async () => {
    const user = userEvent.setup();
    renderEditor();
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeDisabled();

    const name = screen.getByRole("textbox", { name: "Test workspace" });
    await user.type(name, "!!");
    expect(name).toHaveValue("Test workspace!!");

    await user.click(undo);
    expect(screen.getByRole("textbox", { name: "Test workspace" })).toHaveValue(
      "Test workspace",
    );
    await user.click(redo);
    expect(screen.getByRole("textbox", { name: "Test workspace!!" })).toHaveValue(
      "Test workspace!!",
    );

    await waitFor(() => expect(actions.saveWorkspaceAction).toHaveBeenCalled(), {
      timeout: 2000,
    });
    const [, saved, base] = actions.saveWorkspaceAction.mock.calls.at(-1)!;
    expect(saved.name).toBe("Test workspace!!");
    expect(base).toBe(1);
  });

  it("Ctrl+Z inside a text field is left to the browser; outside it undoes", async () => {
    const user = userEvent.setup();
    renderEditor();
    const name = screen.getByRole("textbox", { name: "Test workspace" });
    await user.type(name, "X");
    await user.keyboard("{Control>}z{/Control}");
    // Not hijacked: the workspace history did not undo the typing.
    expect(name).toHaveValue("Test workspaceX");

    await user.click(document.body);
    act(() => {
      name.blur();
    });
    await user.keyboard("{Control>}z{/Control}");
    expect(screen.getByRole("textbox", { name: "Test workspace" })).toHaveValue(
      "Test workspace",
    );
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(screen.getByRole("textbox", { name: "Test workspaceX" })).toBeInTheDocument();
  });

  it("deleting a page shows an Undo toast that brings it back", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Actions for page Chemistry" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete page" }));
    expect(screen.queryByRole("button", { name: /^\W*Chemistry$/u })).toBeNull();

    expect(await screen.findByText("Page “Chemistry” deleted")).toBeInTheDocument();
    const toastUndo = screen
      .getAllByRole("button", { name: "Undo" })
      .find((b) => b.closest("[data-sonner-toast]"));
    expect(toastUndo).toBeTruthy();
    await user.click(toastUndo!);
    expect(screen.getByRole("button", { name: /^\W*Chemistry$/u })).toBeInTheDocument();
    expect(screen.getByText("Page: Chemistry")).toBeInTheDocument();
  });
});

describe("WorkspaceEditor save safety", () => {
  it("merges a stale-version save with the newer version and says what it replaced", async () => {
    const user = userEvent.setup();
    actions.saveWorkspaceAction.mockResolvedValueOnce({ status: "conflict", version: 2 });
    actions.getWorkspaceStateAction.mockResolvedValue({
      workspace: { ...workspace, icon: "🧪" },
      version: 2,
    });
    renderEditor();
    // An icon is one value (not merged letter by letter): this tab's wins,
    // and the banner says so.
    await user.type(screen.getByRole("textbox", { name: "Workspace icon" }), "!");
    await user.tab(); // written when the field is left (or after a pause)

    // No "keep mine / load latest" choice: the edit is merged onto version 2.
    expect(
      await screen.findByText("Merged with changes made elsewhere", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(actions.saveWorkspaceAction).toHaveBeenLastCalledWith(
        "workspace-1",
        expect.objectContaining({ icon: "📚!" }),
        2,
        expect.any(String), // the save id
        expect.any(String), // the tab id
      ),
    );
    expect(await screen.findByRole("status", { name: "Saved" })).toBeInTheDocument();

    // The other tab's icon was replaced by this edit; it can be put back.
    await user.click(screen.getByRole("button", { name: "Use the other version for those" }));
    await waitFor(
      () =>
        expect(actions.saveWorkspaceAction).toHaveBeenLastCalledWith(
          "workspace-1",
          expect.objectContaining({ icon: "🧪" }),
          3,
          expect.any(String),
          expect.any(String),
        ),
      { timeout: 3000 },
    );
    expect(screen.queryByText("Merged with changes made elsewhere")).toBeNull();
  });

  it("a name changed here and in another tab is merged word by word", async () => {
    const user = userEvent.setup();
    actions.saveWorkspaceAction.mockResolvedValueOnce({ status: "conflict", version: 2 });
    actions.getWorkspaceStateAction.mockResolvedValue({
      workspace: { ...workspace, name: "Test workspace 2026" },
      version: 2,
    });
    renderEditor();
    const name = screen.getByRole("textbox", { name: "Test workspace" });
    await user.clear(name);
    await user.type(name, "My workspace");
    await user.tab();

    await waitFor(
      () =>
        expect(actions.saveWorkspaceAction).toHaveBeenLastCalledWith(
          "workspace-1",
          expect.objectContaining({ name: "My workspace 2026" }),
          2,
          expect.any(String),
          expect.any(String),
        ),
      { timeout: 3000 },
    );
    expect(screen.queryByText("Merged with changes made elsewhere")).toBeNull();
  });

  it("shows Retry after a failed save and saves when tapped", async () => {
    const user = userEvent.setup();
    actions.saveWorkspaceAction.mockRejectedValueOnce(new Error("network"));
    renderEditor();
    await user.type(screen.getByRole("textbox", { name: "Test workspace" }), "1");

    // The header's Retry (wide screens) and the phone's line under the header.
    const [retry] = await screen.findAllByRole("button", { name: "Retry" }, { timeout: 2000 });
    await user.click(retry);
    expect(await screen.findByRole("status", { name: "Saved" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("says Offline in words on phones (a line under the header with Retry)", async () => {
    const user = userEvent.setup();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      actions.saveWorkspaceAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      renderEditor();
      await user.type(screen.getByRole("textbox", { name: "Test workspace" }), "1");
      const strip = await screen.findByTestId("save-strip", undefined, { timeout: 3000 });
      expect(strip).toHaveTextContent("Offline · changes kept on this device");
      expect(strip).toHaveClass("lg:hidden");
      expect(within(strip).getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(screen.getByRole("status", { name: "Offline · changes kept on this device" })).toBeInTheDocument();
    } finally {
      online.mockRestore();
    }
  });

  it("never says Saved while a field still holds a value not written yet", async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(screen.getByRole("status", { name: "Saved" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Test workspace" }), "!");
    // Typed but not written yet (it commits after a pause or on leaving the field).
    expect(screen.getByRole("status", { name: "Not saved yet" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Saved" })).toBeNull();
    await user.tab();
    expect(await screen.findByRole("status", { name: "Saved" }, { timeout: 3000 })).toBeInTheDocument();
    // What was saved (the save's other arguments belong to the sync engine).
    expect(actions.saveWorkspaceAction.mock.lastCall?.slice(0, 2)).toEqual([
      "workspace-1",
      expect.objectContaining({ name: "Test workspace!" }),
    ]);
  });
});

describe("saveLabelStatus", () => {
  it("turns Saved and Saving into not-saved while a field holds a value", () => {
    expect(saveLabelStatus("saved", true)).toBe("held");
    expect(saveLabelStatus("saving", true)).toBe("held");
    expect(saveLabelStatus("saved", false)).toBe("saved");
    // Offline and failed saves keep saying so.
    expect(saveLabelStatus("offline", true)).toBe("offline");
    expect(saveLabelStatus("error", true)).toBe("error");
  });
});
