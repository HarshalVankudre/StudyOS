import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";

const push = vi.hoisted(() => ({
  pushSupport: vi.fn(),
  permission: vi.fn(),
  syncPush: vi.fn(),
  enablePush: vi.fn(),
  fetchSettings: vi.fn(),
}));
vi.mock("./push-client", () => push);

import { NotificationPrompt } from "./NotificationPrompt";

const renderPrompt = () =>
  render(
    <I18nProvider locale="en" dictionary={en}>
      <NotificationPrompt />
    </I18nProvider>,
  );

// A plain in-memory Storage (the test DOM's own may be unavailable).
const memory = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  },
});

beforeEach(() => {
  memory.clear();
  push.pushSupport.mockReturnValue("supported");
  push.permission.mockReturnValue("default");
  push.syncPush.mockResolvedValue(false);
  push.enablePush.mockResolvedValue({ ok: true, devices: 1 });
  push.fetchSettings.mockResolvedValue({ configured: true, publicKey: "BKey", devices: 0 });
});

describe("NotificationPrompt on Today", () => {
  it("offers notifications, explains, then asks the browser", async () => {
    const user = userEvent.setup();
    renderPrompt();
    expect(await screen.findByText("Want a nudge in the morning?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Turn on notifications" }));
    expect(push.enablePush).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(push.enablePush).toHaveBeenCalledWith("BKey", "en");
    expect(await screen.findByRole("status")).toHaveTextContent("Notifications are on.");
    expect(screen.getByRole("link", { name: "Notification settings" })).toHaveAttribute("href", "/app/settings#notifications");
  });

  it("stays away for a while after Not now", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPrompt();
    await user.click(await screen.findByRole("button", { name: "Hide this suggestion" }));
    expect(screen.queryByText("Want a nudge in the morning?")).not.toBeInTheDocument();
    unmount();
    renderPrompt();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Want a nudge in the morning?")).not.toBeInTheDocument();
  });

  it("explains the home-screen step on an iPhone", async () => {
    push.pushSupport.mockReturnValue("ios-needs-install");
    renderPrompt();
    expect(await screen.findByText(/add StudyOS to your home screen first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on notifications" })).not.toBeInTheDocument();
  });

  it("shows nothing when push is not configured, unsupported, blocked, or already on somewhere", async () => {
    push.fetchSettings.mockResolvedValue({ configured: false, publicKey: null, devices: 0 });
    const a = renderPrompt();
    await waitFor(() => expect(push.fetchSettings).toHaveBeenCalled());
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();

    push.fetchSettings.mockResolvedValue({ configured: true, publicKey: "BKey", devices: 1 });
    const b = renderPrompt();
    await waitFor(() => expect(push.fetchSettings).toHaveBeenCalledTimes(2));
    expect(b.container).toBeEmptyDOMElement();
    b.unmount();

    push.fetchSettings.mockResolvedValue({ configured: true, publicKey: "BKey", devices: 0 });
    push.permission.mockReturnValue("denied");
    const c = renderPrompt();
    await waitFor(() => expect(push.fetchSettings).toHaveBeenCalledTimes(3));
    expect(c.container).toBeEmptyDOMElement();
    c.unmount();

    push.pushSupport.mockReturnValue("unsupported");
    const d = renderPrompt();
    expect(d.container).toBeEmptyDOMElement();
    expect(push.fetchSettings).toHaveBeenCalledTimes(3);
  });

  it("quietly keeps an already-on device in sync instead of prompting", async () => {
    push.permission.mockReturnValue("granted");
    push.syncPush.mockResolvedValue(true);
    const { container } = renderPrompt();
    await waitFor(() => expect(push.syncPush).toHaveBeenCalledWith("BKey", "en"));
    expect(container).toBeEmptyDOMElement();
  });
});
