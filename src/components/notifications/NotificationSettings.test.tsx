import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { DEFAULT_PREFERENCES } from "@/lib/notifications/preferences";
import type { NotificationSettingsView } from "@/lib/notifications/service";

const push = vi.hoisted(() => ({
  pushSupport: vi.fn(),
  permission: vi.fn(),
  syncPush: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  disableEverywhere: vi.fn(),
  sendTest: vi.fn(),
  browserTimeZone: vi.fn(() => "Europe/Berlin"),
}));
vi.mock("./push-client", () => push);

import { NotificationSettings } from "./NotificationSettings";

const view = (overrides: Partial<NotificationSettingsView> = {}): NotificationSettingsView => ({
  configured: true,
  publicKey: "BPublicKey",
  preferences: { ...DEFAULT_PREFERENCES, timeZone: "Europe/Berlin" },
  devices: 0,
  agentEnabled: true,
  dailyCap: 4,
  ...overrides,
});

function renderSettings(initial = view(), dict = en, locale: "en" | "ar" = "en") {
  return render(
    <I18nProvider locale={locale} dictionary={dict}>
      <NotificationSettings initial={initial} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  push.pushSupport.mockReturnValue("supported");
  push.permission.mockReturnValue("default");
  push.syncPush.mockResolvedValue(false);
  push.enablePush.mockResolvedValue({ ok: true, devices: 1 });
  push.disablePush.mockResolvedValue({ ok: true, devices: 0 });
  push.disableEverywhere.mockResolvedValue({ ok: true, devices: 0 });
  push.sendTest.mockResolvedValue("sent");
  vi.stubGlobal("fetch", vi.fn());
});

describe("NotificationSettings: turning notifications on", () => {
  it("explains before the browser asks, and asks only after Continue", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    expect(push.enablePush).not.toHaveBeenCalled();
    const explainer = screen.getByRole("group", { name: "Before your browser asks" });
    expect(within(explainer).getByText(/never more than 4 a day/)).toBeInTheDocument();
    await user.click(within(explainer).getByRole("button", { name: "Continue" }));
    expect(push.enablePush).toHaveBeenCalledWith("BPublicKey", "en");
    expect(await screen.findByText("On for this device")).toBeInTheDocument();
    expect(screen.getByText(/^Notifications are on\./)).toBeInTheDocument();
    // The choices appear once a device is on.
    expect(screen.getByRole("switch", { name: "Your plan for the day" })).toBeChecked();
  });

  it("backs out without asking when the student says Not now", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(push.enablePush).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Turn on notifications" })).toBeInTheDocument();
  });

  it("explains how to unblock when the browser was told to block", async () => {
    const user = userEvent.setup();
    push.enablePush.mockResolvedValue({ ok: false, reason: "denied" });
    renderSettings();
    await user.click(await screen.findByRole("button", { name: "Turn on notifications" }));
    push.permission.mockReturnValue("denied");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Notifications are blocked for StudyOS")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on notifications" })).not.toBeInTheDocument();
  });

  it("tells iPhone users to add StudyOS to the home screen first", async () => {
    push.pushSupport.mockReturnValue("ios-needs-install");
    renderSettings();
    expect(await screen.findByText("On iPhone and iPad, add StudyOS to your home screen first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on notifications" })).not.toBeInTheDocument();
  });

  it("says so plainly when the browser cannot do it", async () => {
    push.pushSupport.mockReturnValue("unsupported");
    renderSettings(view({ devices: 1 }));
    expect(await screen.findByText(/can’t show notifications/)).toBeInTheDocument();
    expect(screen.getByText("On for 1 other device")).toBeInTheDocument();
  });
});

describe("NotificationSettings: when on", () => {
  beforeEach(() => {
    push.permission.mockReturnValue("granted");
    push.syncPush.mockResolvedValue(true);
  });

  it("turns off on this device just as easily", async () => {
    const user = userEvent.setup();
    renderSettings(view({ devices: 2 }));
    expect(await screen.findByText("On for this device")).toBeInTheDocument();
    expect(screen.getByText("Also on for 1 other device")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Turn off on this device" }));
    expect(push.disablePush).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Turn on notifications" })).toBeInTheDocument();
    expect(screen.getByText("Notifications are off on this device.")).toBeInTheDocument();
  });

  it("sends a test and reports the result", async () => {
    const user = userEvent.setup();
    renderSettings(view({ devices: 1 }));
    await user.click(await screen.findByRole("button", { name: "Send a test" }));
    expect(await screen.findByText("Sent. It should arrive in a few seconds.")).toBeInTheDocument();
  });

  it("saves each kind's switch, the times, lead days and quiet hours", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify({ preferences: JSON.parse(String(init?.body)) }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSettings(view({ devices: 1 }));
    await screen.findByText("On for this device");

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("switch", { name: "Streak reminder" }));
    const assignments = screen.getByRole("group", { name: "Before assignments" });
    await user.click(within(assignments).getByRole("button", { name: "3 days" }));
    await user.click(within(assignments).getByRole("button", { name: "7 days" }));
    expect(within(assignments).getByRole("button", { name: "3 days" })).toHaveAttribute("aria-pressed", "true");
    await user.click(save);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/notifications/settings");
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      streakEnabled: false,
      deadlineLeads: [3, 2, 1],
      examLeads: [14, 7, 2, 1],
      timeZone: "Europe/Berlin",
      locale: "en",
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("warns when a chosen time falls in quiet hours", async () => {
    renderSettings(view({ devices: 1 }));
    await screen.findByText("On for this device");
    const timeInputs = screen.getAllByLabelText("Time");
    fireEvent.change(timeInputs[0], { target: { value: "06:30" } });
    expect(screen.getByText(/inside your quiet hours, so it waits until 7:00/)).toBeInTheDocument();
  });

  it("points to the agent when the daily plan is paused, and every switch is labelled", async () => {
    renderSettings(view({ devices: 1, agentEnabled: false }));
    expect(await screen.findByText(/Daily Study Agent is paused/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Turn it on" })).toHaveAttribute("href", "/app/agents#settings");
    for (const name of ["Your plan for the day", "Deadline reminders", "Streak reminder", "Quiet hours"]) {
      expect(screen.getByRole("switch", { name })).toBeInTheDocument();
    }
  });

  it("renders in Arabic", async () => {
    renderSettings(view({ devices: 1 }), ar, "ar");
    expect(await screen.findByText(ar.notifications.onHere)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: ar.notifications.dailyLabel })).toBeInTheDocument();
  });
});
