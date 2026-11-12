import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { AppShell } from "./AppShell";
import { ShortcutSheet } from "./ShortcutSheet";
import { emit, isTypingTarget, modKey, OPEN_PALETTE_EVENT } from "./events";
import { SHORTCUT_GROUPS } from "./shortcuts";

const mocks = vi.hoisted(() => ({ pathname: "/app" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => mocks.pathname,
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }) }));
vi.mock("@/lib/i18n/actions", () => ({ setLocale: vi.fn() }));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  return { useI18n: () => ({ dict: en, t: fmt, dir: "ltr", locale: "en" }) };
});

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  mocks.pathname = "/app";
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ query: "", total: 0, groups: [] })))),
  );
});

describe("ShortcutSheet", () => {
  it("lists every shortcut group and item", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} apple={false} />);
    const dialog = screen.getByRole("dialog", { name: en.shortcuts.title });
    for (const { group, items } of SHORTCUT_GROUPS) {
      const section = within(dialog).getByRole("region", { name: en.shortcuts.groups[group] });
      for (const def of items) expect(within(section).getAllByText(en.shortcuts.items[def.item]).length).toBeGreaterThan(0);
    }
    expect(within(dialog).getAllByText("Ctrl").length).toBeGreaterThan(0);
  });

  it("uses ⌘ on Apple devices", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} apple />);
    expect(screen.getAllByText("⌘").length).toBeGreaterThan(0);
    // Only the literal Ctrl+Y redo alternative still says Ctrl.
    expect(screen.getAllByText("Ctrl")).toHaveLength(1);
  });

  it("closes from its close button", async () => {
    const onOpenChange = vi.fn();
    render(<ShortcutSheet open onOpenChange={onOpenChange} apple={false} />);
    await userEvent.click(screen.getByRole("button", { name: en.shortcuts.close }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("AppShell keyboard and events", () => {
  it("opens the palette with Ctrl+K and the sheet with ?", async () => {
    render(<AppShell />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("combobox", { name: en.command.title })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("combobox")).toBeNull();

    fireEvent.keyDown(document.body, { key: "?" });
    expect(await screen.findByRole("dialog", { name: en.shortcuts.title })).toBeInTheDocument();
  });

  it("ignores ? while the student is typing", () => {
    render(
      <>
        <textarea aria-label="note" />
        <AppShell />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("note"), { key: "?" });
    expect(screen.queryByRole("dialog", { name: en.shortcuts.title })).toBeNull();
  });

  it("opens from the floating search button and the open event", async () => {
    mocks.pathname = "/app/agents";
    render(<AppShell />);
    await userEvent.click(screen.getByRole("button", { name: en.command.search }));
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
  });

  it("opens when another component asks", async () => {
    render(<AppShell />);
    emit(OPEN_PALETTE_EVENT);
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
  });
});

describe("event helpers", () => {
  it("formats the modifier per platform", () => {
    expect(modKey("K", true)).toBe("⌘K");
    expect(modKey("K", false)).toBe("Ctrl+K");
  });

  it("knows which targets take text", () => {
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    const cb = document.createElement("input");
    cb.type = "checkbox";
    expect(isTypingTarget(cb)).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
  });
});

describe("AppShell floating search (QA round 2: it covered Today on phones)", () => {
  it("is not shown on the home screen, whose header has search", () => {
    mocks.pathname = "/app";
    render(<AppShell />);
    expect(screen.queryByRole("button", { name: en.command.search })).toBeNull();
  });

  it("is shown on other app pages", () => {
    mocks.pathname = "/app/agents";
    render(<AppShell />);
    expect(screen.getByRole("button", { name: en.command.search })).toBeInTheDocument();
  });
});
