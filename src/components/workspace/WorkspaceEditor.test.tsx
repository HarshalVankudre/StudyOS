import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { WorkspaceEditor } from "./WorkspaceEditor";

vi.mock("@/app/app/actions", () => ({
  updateWorkspaceAction: vi.fn().mockResolvedValue(undefined),
}));
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
  PageView: () => <div>Page content</div>,
}));
vi.mock("./StudyLauncher", () => ({
  StudyLauncher: () => null,
}));
vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({
    dict: {
      common: { cancel: "Cancel" },
      editor: {
        workspaceIcon: "Workspace icon",
        untitled: "Untitled",
        deletePage: "Delete page",
        newPage: "New page",
        allWorkspaces: "All workspaces",
        askAi: "Ask AI",
        closeAgent: "Close agent",
        saving: "Saving…",
        saveFailed: "Save failed",
        saved: "Saved",
      },
    },
  }),
}));

const workspace: Workspace = {
  id: "workspace-1",
  name: "Test workspace",
  icon: "📚",
  homePageId: "page-1",
  pages: [
    {
      id: "page-1",
      title: "Biology",
      icon: "🧬",
      blocks: [],
    },
  ],
  databases: [],
};

describe("WorkspaceEditor responsive navigation", () => {
  it("opens the mobile page drawer and closes it after navigation", async () => {
    const user = userEvent.setup();
    render(<WorkspaceEditor id="workspace-1" initialWorkspace={workspace} />);

    const menu = screen.getByRole("button", { name: "Test workspace" });
    const sidebar = screen.getByRole("complementary", { name: "Test workspace" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(sidebar).toHaveClass("-translate-x-full");

    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(sidebar).toHaveClass("translate-x-0");

    await user.click(screen.getByRole("button", { name: /Biology/ }));
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(sidebar).toHaveClass("-translate-x-full");
  });

  it("exposes save feedback as an announced status", () => {
    render(<WorkspaceEditor id="workspace-1" initialWorkspace={workspace} />);
    expect(screen.getByRole("status", { name: "Saved" })).toBeInTheDocument();
  });
});
