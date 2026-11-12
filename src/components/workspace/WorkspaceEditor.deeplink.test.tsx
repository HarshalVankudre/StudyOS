import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { WorkspaceEditor } from "./WorkspaceEditor";

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
const actions = vi.hoisted(() => ({
  saveWorkspaceAction: vi.fn(),
  getWorkspaceStateAction: vi.fn(),
  getWorkspaceVersionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/workspace-1",
}));
vi.mock("@/app/app/actions", () => actions);
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/account/AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("@/components/account/CreditMeter", () => ({ CreditMeter: () => null }));
vi.mock("@/components/command/ExportMenu", () => ({ ExportMenu: () => null }));
vi.mock("@/components/command/SearchButton", () => ({ SearchButton: () => null }));
vi.mock("@/components/onboarding/GettingStarted", () => ({ GettingStarted: () => null }));
vi.mock("./materials/StudyKitHost", () => ({ StudyKitHost: () => null }));
vi.mock("./AgentChat", () => ({ AgentChat: () => null }));
vi.mock("./StudyLauncher", () => ({ StudyLauncher: () => null }));
// A probe page: shows the open page and the deep-link target handed to it.
vi.mock("./PageView", async () => {
  const { useDeepLink } = await import("./DeepLinkContext");
  return {
    PageView: ({ page }: { page: { title: string } }) => {
      const { focus } = useDeepLink();
      const target = !focus ? "none" : focus.kind === "block" ? `block:${focus.blockId}` : `row:${focus.databaseId}/${focus.rowId}`;
      return (
        <div>
          <p>Open page: {page.title}</p>
          <p>Target: {target}</p>
        </div>
      );
    },
  };
});
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  return { useI18n: () => ({ dict: en, t: fmt, dir: "ltr", locale: "en" }) };
});

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

const workspace: Workspace = {
  id: "workspace-1",
  name: "Test workspace",
  homePageId: "page-1",
  pages: [
    { id: "page-1", title: "Biology", blocks: [] },
    {
      id: "page-2",
      title: "Chemistry",
      blocks: [
        { id: "todo-1", type: "todo", text: "Lab prep", checked: false },
        { id: "view", type: "database_view", databaseId: "db-1", viewId: "v" },
      ],
    },
  ],
  databases: [
    {
      id: "db-1",
      name: "Assignments",
      properties: [{ id: "t", name: "Name", type: "text" }],
      rows: [{ id: "row-1", cells: { t: "Essay" } }],
      views: [{ id: "v", name: "Table", type: "table" }],
    },
  ],
};

function installMemoryStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    },
  });
}

function renderEditor() {
  return render(<WorkspaceEditor id="workspace-1" initialWorkspace={workspace} initialVersion={1} />);
}

beforeEach(() => {
  installMemoryStorage();
  nav.params = new URLSearchParams();
  window.history.replaceState(null, "", "/app/workspace-1");
  actions.saveWorkspaceAction.mockImplementation(async (_id: string, _ws: Workspace, base: number) => ({
    status: "saved",
    version: base + 1,
  }));
  actions.getWorkspaceStateAction.mockResolvedValue({ workspace, version: 1 });
  actions.getWorkspaceVersionAction.mockResolvedValue(1);
});

describe("WorkspaceEditor deep links", () => {
  it("opens the home page when the URL names nothing", () => {
    renderEditor();
    expect(screen.getByText("Open page: Biology")).toBeInTheDocument();
    expect(screen.getByText("Target: none")).toBeInTheDocument();
  });

  it("selects ?page= and hands ?block= to the page", () => {
    nav.params = new URLSearchParams("page=page-2&block=todo-1");
    renderEditor();
    expect(screen.getByText("Open page: Chemistry")).toBeInTheDocument();
    expect(screen.getByText("Target: block:todo-1")).toBeInTheDocument();
  });

  it("selects the page for ?db=&row= and hands the row to the database view", () => {
    nav.params = new URLSearchParams("db=db-1&row=row-1");
    renderEditor();
    expect(screen.getByText("Open page: Chemistry")).toBeInTheDocument();
    expect(screen.getByText("Target: row:db-1/row-1")).toBeInTheDocument();
  });

  it("keeps the open page in the URL as the student navigates", async () => {
    const user = userEvent.setup();
    const push = vi.spyOn(window.history, "pushState");
    renderEditor();
    await user.click(screen.getByRole("button", { name: /^\W*Chemistry$/u }));
    expect(screen.getByText("Open page: Chemistry")).toBeInTheDocument();
    expect(push).toHaveBeenLastCalledWith(null, "", "/app/workspace-1?page=page-2");
  });

  it("follows the URL when it changes (Back, or a link from search)", () => {
    nav.params = new URLSearchParams("page=page-2");
    const view = renderEditor();
    expect(screen.getByText("Open page: Chemistry")).toBeInTheDocument();

    // Back to the entry without a page: the home page again.
    nav.params = new URLSearchParams();
    view.rerender(<WorkspaceEditor id="workspace-1" initialWorkspace={workspace} initialVersion={1} />);
    expect(screen.getByText("Open page: Biology")).toBeInTheDocument();

    // A search result links to a row.
    act(() => {
      nav.params = new URLSearchParams("page=page-2&db=db-1&row=row-1");
    });
    view.rerender(<WorkspaceEditor id="workspace-1" initialWorkspace={workspace} initialVersion={1} />);
    expect(screen.getByText("Open page: Chemistry")).toBeInTheDocument();
    expect(screen.getByText("Target: row:db-1/row-1")).toBeInTheDocument();
  });
});
