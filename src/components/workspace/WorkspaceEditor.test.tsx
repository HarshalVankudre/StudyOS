import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { WorkspaceEditor } from "./WorkspaceEditor";

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

    const menu = screen.getByRole("button", { name: "Test workspace" });
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
    await user.click(screen.getByRole("button", { name: "Delete page: Chemistry" }));
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
  it("surfaces a stale-version save as a clear choice, without overwriting", async () => {
    const user = userEvent.setup();
    actions.saveWorkspaceAction.mockResolvedValue({ status: "conflict", version: 2 });
    actions.getWorkspaceStateAction.mockResolvedValue({
      workspace: { ...workspace, name: "Renamed in another tab" },
      version: 2,
    });
    renderEditor();
    await user.type(screen.getByRole("textbox", { name: "Test workspace" }), "?");

    expect(
      await screen.findByText("This workspace changed somewhere else", undefined, {
        timeout: 2000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Not saved yet" })).toBeInTheDocument();

    actions.saveWorkspaceAction.mockResolvedValue({ status: "saved", version: 3 });
    await user.click(screen.getByRole("button", { name: "Keep my version" }));
    await waitFor(() =>
      expect(actions.saveWorkspaceAction).toHaveBeenLastCalledWith(
        "workspace-1",
        expect.objectContaining({ name: "Test workspace?" }),
        2,
      ),
    );
    expect(await screen.findByRole("status", { name: "Saved" })).toBeInTheDocument();
  });

  it("shows Retry after a failed save and saves when tapped", async () => {
    const user = userEvent.setup();
    actions.saveWorkspaceAction.mockRejectedValueOnce(new Error("network"));
    renderEditor();
    await user.type(screen.getByRole("textbox", { name: "Test workspace" }), "1");

    const retry = await screen.findByRole("button", { name: "Retry" }, { timeout: 2000 });
    await user.click(retry);
    expect(await screen.findByRole("status", { name: "Saved" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
