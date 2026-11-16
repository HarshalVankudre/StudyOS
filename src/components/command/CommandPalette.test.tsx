import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import type { SearchResults } from "@/lib/search";
import { CommandPalette, workspaceIdFromPath } from "./CommandPalette";
import { OPEN_EXPORT_EVENT, OPEN_FEEDBACK_EVENT, OPEN_NOTION_IMPORT_EVENT, OPEN_STUDY_HUB_EVENT, START_FOCUS_EVENT } from "./events";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  pathname: "/app",
  setTheme: vi.fn(),
  setLocale: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => mocks.pathname,
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: mocks.setTheme }) }));
vi.mock("@/lib/i18n/actions", () => ({ setLocale: mocks.setLocale }));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  const { pluralizer } = await import("@/lib/i18n/plural");
  return { useI18n: () => ({ dict: en, t: fmt, plural: pluralizer("en"), dir: "ltr", locale: "en" }) };
});

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const C = en.command;

const workspacesOnly: SearchResults = {
  query: "",
  total: 1,
  groups: [
    {
      kind: "workspace",
      hits: [{ kind: "workspace", href: "/app/w1", title: "Fall semester", snippet: "", context: "", icon: "🍂", workspaceId: "w1", workspaceName: "Fall semester", score: 0 }],
    },
  ],
};

const calculusResults: SearchResults = {
  query: "calc",
  total: 2,
  groups: [
    {
      kind: "page",
      hits: [{ kind: "page", href: "/app/w1?page=p1", title: "Calculus notes", snippet: "", context: "🍂 Fall semester", icon: "🧮", workspaceId: "w1", workspaceName: "Fall semester", workspaceIcon: "🍂", score: 90 }],
    },
    {
      kind: "row",
      hits: [{ kind: "row", href: "/app/w1?page=p2&db=d1&row=r1", title: "Calculus problem set", snippet: "Open · 2026-11-20", context: "📚 Assignments", workspaceId: "w1", workspaceName: "Fall semester", workspaceIcon: "🍂", score: 60 }],
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  mocks.pathname = "/app";
  fetchMock = vi.fn((url: string) => {
    const q = new URL(url, "http://x").searchParams.get("q") ?? "";
    if (q === "") return respond(workspacesOnly);
    if (q === "zzz") return respond({ query: q, total: 0, groups: [] });
    if (q === "limit") return respond({ error: "rate_limited" }, 429);
    return respond(calculusResults);
  });
  vi.stubGlobal("fetch", fetchMock);
});

/**
 * Type a query and wait until the palette has fetched and rendered its
 * results, so a click never lands on an option the debounced search is about
 * to replace (which happens under load and makes the click a no-op).
 */
async function typeSettled(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, text: string) {
  await user.type(input, text);
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`q=${encodeURIComponent(text)}`))).toBe(true),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderPalette(extra: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const onOpenChange = vi.fn();
  const onShowShortcuts = vi.fn();
  render(<CommandPalette open onOpenChange={onOpenChange} onShowShortcuts={onShowShortcuts} apple={false} {...extra} />);
  return { onOpenChange, onShowShortcuts, input: screen.getByRole("combobox", { name: C.title }) };
}

describe("CommandPalette", () => {
  it("opens with actions and the student's workspaces", async () => {
    renderPalette();
    expect(screen.getByRole("option", { name: C.actions.newWorkspace })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: C.actions.today })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /Fall semester/ })).toBeInTheDocument();
    // Workspace-only actions are hidden outside a workspace.
    expect(screen.queryByRole("option", { name: C.actions.studyHub })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: C.actions.export })).not.toBeInTheDocument();
  });

  it("searches on the server and opens the exact place", async () => {
    const user = userEvent.setup();
    const { input, onOpenChange } = renderPalette();
    await user.type(input, "calc");
    const row = await screen.findByRole("option", { name: /Calculus problem set/ });
    expect(within(row).getByText(/Open · 2026-11-20/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: C.groups.page })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: C.groups.row })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/search?q=calc", expect.anything());

    // The first result is active; arrow down moves to the row.
    expect(screen.getByRole("option", { name: /Calculus notes/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(mocks.push).toHaveBeenCalledWith("/app/w1?page=p2&db=d1&row=r1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("tells the student when nothing matches or the limit is hit", async () => {
    const user = userEvent.setup();
    const { input } = renderPalette();
    await user.type(input, "zzz");
    expect(await screen.findByText("No matches for “zzz”.")).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "limit");
    expect(await screen.findByText(C.rateLimited)).toBeInTheDocument();
  });

  it("filters actions by the query", async () => {
    const user = userEvent.setup();
    const { input } = renderPalette();
    await user.type(input, "settings");
    expect(await screen.findByRole("option", { name: C.actions.settings })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: C.actions.newWorkspace })).not.toBeInTheDocument();
  });

  it("switches theme and opens the shortcut sheet", async () => {
    const user = userEvent.setup();
    const { onShowShortcuts } = renderPalette();
    await user.click(screen.getByRole("option", { name: C.actions.themeLight }));
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
    await user.click(screen.getByRole("option", { name: C.actions.shortcuts }));
    expect(onShowShortcuts).toHaveBeenCalled();
  });

  it("changes language from a nested list", async () => {
    const user = userEvent.setup();
    mocks.setLocale.mockResolvedValue(undefined);
    renderPalette();
    await user.click(screen.getByRole("option", { name: C.actions.language }));
    expect(screen.getByRole("group", { name: C.groups.languages })).toBeInTheDocument();
    await user.type(screen.getByRole("combobox"), "deut");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(mocks.setLocale).toHaveBeenCalledWith("de"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("a language change that cannot reach the server says so instead of failing the page", async () => {
    const user = userEvent.setup();
    mocks.refresh.mockClear();
    mocks.setLocale.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPalette();
    await user.click(screen.getByRole("option", { name: C.actions.language }));
    await user.type(screen.getByRole("combobox"), "deut");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(en.safety.actionFailed));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("offers the study hub and export inside a workspace", async () => {
    mocks.pathname = "/app/w1";
    const user = userEvent.setup();
    const hub = vi.fn();
    const exp = vi.fn();
    window.addEventListener(OPEN_STUDY_HUB_EVENT, hub);
    window.addEventListener(OPEN_EXPORT_EVENT, exp);
    renderPalette();
    await user.click(screen.getByRole("option", { name: C.actions.studyHub }));
    expect(hub).toHaveBeenCalled();
    await user.click(screen.getByRole("option", { name: C.actions.export }));
    expect(exp).toHaveBeenCalled();
    window.removeEventListener(OPEN_STUDY_HUB_EVENT, hub);
    window.removeEventListener(OPEN_EXPORT_EVENT, exp);
  });

  it("opens the feedback dialog from anywhere, closing itself first", async () => {
    const user = userEvent.setup();
    const feedback = vi.fn();
    window.addEventListener(OPEN_FEEDBACK_EVENT, feedback);
    const { onOpenChange, input } = renderPalette();
    await typeSettled(user, input, "feedb");
    await user.click(await screen.findByRole("option", { name: en.feedback.open }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(feedback).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_FEEDBACK_EVENT, feedback);
  });

  it("opens the Notion import from anywhere, closing itself first", async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    window.addEventListener(OPEN_NOTION_IMPORT_EVENT, opened);
    const { onOpenChange, input } = renderPalette();
    await typeSettled(user, input, "notion");
    await user.click(await screen.findByRole("option", { name: en.notionImport.paletteAction }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_NOTION_IMPORT_EVENT, opened);
  });

  it("starts the focus timer from anywhere, closing itself first", async () => {
    const user = userEvent.setup();
    const focus = vi.fn();
    window.addEventListener(START_FOCUS_EVENT, focus);
    const { onOpenChange, input } = renderPalette();
    await typeSettled(user, input, "focus");
    await user.click(await screen.findByRole("option", { name: en.focus.paletteAction }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(focus).toHaveBeenCalledTimes(1);
    window.removeEventListener(START_FOCUS_EVENT, focus);
  });
});

describe("CommandPalette: insights", () => {
  it("opens the insights page from anywhere, closing itself first", async () => {
    const user = userEvent.setup();
    const { onOpenChange, input } = renderPalette();
    await typeSettled(user, input, "insights");
    await user.click(await screen.findByRole("option", { name: en.insights.paletteAction }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.push).toHaveBeenCalledWith("/app/insights");
  });

  it("does not take the insights page for a workspace", () => {
    mocks.pathname = "/app/insights";
    renderPalette();
    expect(screen.getByRole("option", { name: en.insights.paletteAction })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: C.actions.studyHub })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: C.actions.export })).not.toBeInTheDocument();
  });
});

describe("CommandPalette: agenda", () => {
  it("opens the agenda from anywhere, closing itself first", async () => {
    const user = userEvent.setup();
    const { onOpenChange, input } = renderPalette();
    await typeSettled(user, input, "agenda");
    await user.click(await screen.findByRole("option", { name: en.agenda.paletteAction }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.push).toHaveBeenCalledWith("/app/agenda");
  });

  it("does not take the agenda for a workspace", () => {
    mocks.pathname = "/app/agenda";
    renderPalette();
    expect(screen.getByRole("option", { name: en.agenda.paletteAction })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: C.actions.studyHub })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: C.actions.export })).not.toBeInTheDocument();
    expect(workspaceIdFromPath("/app/agenda")).toBeNull();
  });
});

describe("CommandPalette: grades overview", () => {
  it("opens the grades overview from anywhere, closing itself first", async () => {
    const user = userEvent.setup();
    const { onOpenChange, input } = renderPalette();
    await typeSettled(user, input, "grades");
    await user.click(await screen.findByRole("option", { name: en.gradesOverview.paletteAction }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.push).toHaveBeenCalledWith("/app/grades");
  });

  it("does not take the grades overview for a workspace", () => {
    mocks.pathname = "/app/grades";
    renderPalette();
    expect(screen.getByRole("option", { name: en.gradesOverview.paletteAction })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: C.actions.studyHub })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: C.actions.export })).not.toBeInTheDocument();
    expect(workspaceIdFromPath("/app/grades")).toBeNull();
  });
});

describe("workspaceIdFromPath", () => {
  it("recognises workspace routes only", () => {
    expect(workspaceIdFromPath("/app/abc")).toBe("abc");
    expect(workspaceIdFromPath("/app/abc/x")).toBe("abc");
    expect(workspaceIdFromPath("/app")).toBeNull();
    expect(workspaceIdFromPath("/app/settings")).toBeNull();
    expect(workspaceIdFromPath("/app/insights")).toBeNull();
    expect(workspaceIdFromPath("/app/admin")).toBeNull();
    expect(workspaceIdFromPath("/generate")).toBeNull();
  });
});
