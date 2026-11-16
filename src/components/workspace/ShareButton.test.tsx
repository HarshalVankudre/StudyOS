import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";

const m = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

vi.mock("@/app/app/share-actions", () => ({ getPageShareAction: m.get, setPageShareAction: m.set }));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { fmt } = await import("@/lib/i18n/interpolate");
  const { pluralizer } = await import("@/lib/i18n/plural");
  return { useI18n: () => ({ dict: en, t: fmt, plural: pluralizer("en"), dir: "ltr", locale: "en" }) };
});

import { OPEN_SHARE_EVENT, ShareButton } from "./ShareButton";

const S = en.share;
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const on = { enabled: true, path: `/s/${TOKEN}`, createdAt: "2026-11-13T10:00:00.000Z", viewCount: 3 };

beforeEach(() => {
  m.get.mockReset().mockResolvedValue({ ok: true, share: { enabled: false } });
  m.set.mockReset();
});

describe("Share (the open page)", () => {
  it("is off by default and says what visitors would see", async () => {
    const user = userEvent.setup();
    render(<ShareButton workspaceId="ws_1" pageId="pg_1" />);
    await user.click(screen.getByRole("button", { name: S.title }));
    const toggle = await screen.findByRole("switch", { name: S.toggle });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(m.get).toHaveBeenCalledWith({ workspaceId: "ws_1", pageId: "pg_1" });
    expect(screen.getByText(S.offNote)).toBeInTheDocument();
    expect(screen.getByText(S.visibleNote)).toBeInTheDocument();
    // Tables and calendars publish their views' columns; trashing ends the links.
    expect(screen.getByText(S.columnsNote)).toBeInTheDocument();
    expect(screen.getByText(S.trashNote)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("explains a page an operator turned off, and keeps the switch off", async () => {
    const user = userEvent.setup();
    m.get.mockResolvedValue({ ok: true, share: { enabled: false, blocked: "page" } });
    render(<ShareButton workspaceId="ws_1" pageId="pg_1" />);
    await user.click(screen.getByRole("button", { name: S.title }));
    expect(await screen.findByText(S.errors.pageDisabled)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: S.toggle })).toBeDisabled();
    expect(screen.queryByText(S.offNote)).toBeNull();
  });

  it("explains a refusal to turn sharing on: blocked account, too many toggles", async () => {
    const user = userEvent.setup();
    m.set.mockResolvedValueOnce({ ok: false, error: "rate_limited" }).mockResolvedValueOnce({ ok: false, error: "sharing_blocked" });
    render(<ShareButton workspaceId="ws_1" pageId="pg_1" />);
    await user.click(screen.getByRole("button", { name: S.title }));
    await user.click(await screen.findByRole("switch", { name: S.toggle }));
    expect(await screen.findByRole("alert")).toHaveTextContent(S.errors.rateLimited);
    await user.click(screen.getByRole("switch", { name: S.toggle }));
    expect(await screen.findByText(S.errors.accountBlocked)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: S.toggle })).toBeDisabled();
  });

  it("turns the link on, shows it with its views, and off again", async () => {
    const user = userEvent.setup();
    m.set.mockResolvedValueOnce({ ok: true, share: on }).mockResolvedValueOnce({ ok: true, share: { enabled: false } });
    render(<ShareButton workspaceId="ws_1" pageId="pg_1" />);
    await user.click(screen.getByRole("button", { name: S.title }));
    await user.click(await screen.findByRole("switch", { name: S.toggle }));
    expect(m.set).toHaveBeenCalledWith({ workspaceId: "ws_1", pageId: "pg_1", enabled: true });
    const link = await screen.findByRole("textbox", { name: S.linkLabel });
    expect(link).toHaveValue(`${window.location.origin}/s/${TOKEN}`);
    expect(screen.getByText(/3 views/)).toBeInTheDocument();
    expect(screen.getByText(S.offHint)).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: S.toggle }));
    expect(m.set).toHaveBeenLastCalledWith({ workspaceId: "ws_1", pageId: "pg_1", enabled: false });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(screen.getByRole("switch", { name: S.toggle })).toHaveAttribute("aria-checked", "false");
  });

  it("explains the limit", async () => {
    const user = userEvent.setup();
    m.set.mockResolvedValue({ ok: false, error: "limit" });
    render(<ShareButton workspaceId="ws_1" pageId="pg_1" />);
    await user.click(screen.getByRole("button", { name: S.title }));
    await user.click(await screen.findByRole("switch", { name: S.toggle }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You’re sharing 100 pages already");
  });

  it("opens from the phone menu's event", async () => {
    render(<ShareButton workspaceId="ws_1" pageId="pg_1" />);
    act(() => {
      window.dispatchEvent(new Event(OPEN_SHARE_EVENT));
    });
    expect(await screen.findByRole("switch", { name: S.toggle })).toBeInTheDocument();
  });
});
