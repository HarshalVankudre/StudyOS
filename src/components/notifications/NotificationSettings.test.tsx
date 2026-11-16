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
  email: null,
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
    for (const name of ["Your plan for the day", "Deadline reminders", "Streak reminder", "Weekly recap", "Quiet hours"]) {
      expect(screen.getByRole("switch", { name })).toBeInTheDocument();
    }
  });

  it("hydrates without a mismatch when the browser's zone is not the server's", async () => {
    // The server renders the saved zone; the browser then shows its own.
    push.browserTimeZone.mockReturnValue("Asia/Tokyo");
    const tree = (
      <I18nProvider locale="en" dictionary={en}>
        <NotificationSettings initial={view({ devices: 1 })} />
      </I18nProvider>
    );
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    expect(container.textContent).toContain("Europe/Berlin");
    expect(container.textContent).not.toContain("Asia/Tokyo");
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const root = await act(async () => hydrateRoot(container, tree, { onRecoverableError }));
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Asia/Tokyo");
    act(() => root.unmount());
    container.remove();
    push.browserTimeZone.mockReturnValue("Europe/Berlin");
  });

  it("renders in Arabic", async () => {
    renderSettings(view({ devices: 1 }), ar, "ar");
    expect(await screen.findByText(ar.notifications.onHere)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: ar.notifications.dailyLabel })).toBeInTheDocument();
    const weekly = screen.getByRole("switch", { name: ar.notifications.weeklyLabel });
    expect(weekly).not.toBeChecked();
    expect(weekly).toHaveAccessibleDescription(/الأحد/);
  });
});

describe("NotificationSettings: weekly recap", () => {
  beforeEach(() => {
    push.permission.mockReturnValue("granted");
    push.syncPush.mockResolvedValue(true);
  });

  it("is off by default, and says when it would come", async () => {
    renderSettings(view({ devices: 1 }));
    await screen.findByText("On for this device");
    const toggle = screen.getByRole("switch", { name: "Weekly recap" });
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(
      /^A short look back at your week, every Sunday at 6:00\sPM\. Skipped when you took the week off\.$/,
    );
    expect(screen.queryByLabelText("Day")).not.toBeInTheDocument();
  });

  it("turns on with a day and a time, and saves them", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify({ preferences: JSON.parse(String(init?.body)) }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSettings(view({ devices: 1 }));
    await screen.findByText("On for this device");

    await user.click(screen.getByRole("switch", { name: "Weekly recap" }));
    const day = screen.getByLabelText("Day");
    expect(day).toHaveValue("0");
    // The week from Monday, every day by name.
    expect(within(day).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    await user.selectOptions(day, "Wednesday");
    const times = screen.getAllByLabelText("Time");
    fireEvent.change(times[times.length - 1], { target: { value: "07:30" } });
    expect(screen.getByRole("switch", { name: "Weekly recap" })).toHaveAccessibleDescription(/every Wednesday at 7:30\sAM\./);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      weeklyEnabled: true,
      weeklyDay: 3,
      weeklyMinute: 7 * 60 + 30,
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("warns when the chosen time falls in quiet hours", async () => {
    renderSettings(view({ devices: 1, preferences: { ...DEFAULT_PREFERENCES, weeklyEnabled: true, weeklyMinute: 23 * 60 } }));
    await screen.findByText("On for this device");
    expect(screen.getByText("That’s inside your quiet hours, so it won’t be sent.")).toBeInTheDocument();
  });
});

describe("NotificationSettings: reminders by email", () => {
  const address = "me@example.com";
  const email = (overrides: Partial<NonNullable<NotificationSettingsView["email"]>> = {}) => ({
    enabled: false,
    address,
    verified: true,
    bounced: false,
    unavailable: false,
    ...overrides,
  });
  /** fetch answering the email switch and the test endpoint. */
  function server(answers: { email?: () => Response; test?: () => Response } = {}) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/notifications/email") {
        if (answers.email) return answers.email();
        const { enabled } = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, email: email({ enabled }) }), { status: 200 });
      }
      if (url === "/api/notifications/test") return answers.test?.() ?? new Response(JSON.stringify({ ok: true, delivered: 1 }));
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("names the address, and turns email on at once with the device's zone and language", async () => {
    const user = userEvent.setup();
    const fetchMock = server();
    renderSettings(view({ email: email() }));
    const toggle = await screen.findByRole("switch", { name: `Send reminders by email to ${address}` });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAccessibleDescription(/never in quiet hours\. Every email has a link to stop them\.$/);
    // No device and email off: nothing to choose yet.
    expect(screen.queryByRole("switch", { name: "Your plan for the day" })).not.toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/notifications/email", expect.objectContaining({ method: "PUT" })));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ enabled: true, timeZone: "Europe/Berlin", locale: "en" });
    expect(await screen.findByText("Email reminders are on.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: `Send reminders by email to ${address}` })).toBeChecked();
    // Email alone is enough for the choices to appear.
    expect(screen.getByRole("switch", { name: "Your plan for the day" })).toBeInTheDocument();
  });

  it("says “also” when a device is on too", async () => {
    push.permission.mockReturnValue("granted");
    push.syncPush.mockResolvedValue(true);
    renderSettings(view({ devices: 1, email: email({ enabled: true }) }));
    expect(await screen.findByRole("switch", { name: `Also send reminders by email to ${address}` })).toBeChecked();
  });

  it("cannot be turned on without a verified address, and says what to do", async () => {
    const { unmount } = renderSettings(view({ email: email({ verified: false }) }));
    const unverified = await screen.findByRole("switch", { name: `Send reminders by email to ${address}` });
    expect(unverified).toBeDisabled();
    expect(unverified).toHaveAccessibleDescription(`Verify ${address} under “Manage account” above, then turn this on.`);
    unmount();

    renderSettings(view({ email: email({ address: null, verified: false }) }));
    const missing = await screen.findByRole("switch", { name: "Reminders by email" });
    expect(missing).toBeDisabled();
    expect(missing).toHaveAccessibleDescription("Add an email address under “Manage account” above, then turn this on.");
  });

  it("can always be turned off, even when the address is no longer verified", async () => {
    const user = userEvent.setup();
    const fetchMock = server();
    renderSettings(view({ email: email({ enabled: true, verified: false }) }));
    const toggle = await screen.findByRole("switch", { name: `Send reminders by email to ${address}` });
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    expect(await screen.findByText("Email reminders are off.")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ enabled: false });
  });

  it("explains a refused address, shown as off until the student turns it on again", async () => {
    renderSettings(view({ email: email({ enabled: true, bounced: true }) }));
    const toggle = await screen.findByRole("switch", { name: `Send reminders by email to ${address}` });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAccessibleDescription(`Emails to ${address} were refused, so they stopped. Check the address, then turn this on again.`);
  });

  it("sends a test email and reports where it went, or that it was limited", async () => {
    const user = userEvent.setup();
    const fetchMock = server();
    renderSettings(view({ email: email({ enabled: true }) }));
    await user.click(await screen.findByRole("button", { name: "Send a test email" }));
    expect(await screen.findByText(`Sent to ${address}. It should arrive within a minute or two.`)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls.find(([u]) => u === "/api/notifications/test")!;
    expect(url).toBe("/api/notifications/test");
    expect(JSON.parse(String(init?.body))).toEqual({ channel: "email" });

    server({ test: () => new Response("{}", { status: 429 }) });
    await user.click(screen.getByRole("button", { name: "Send a test email" }));
    expect(await screen.findByText("A few tests went out already. Try again in a few minutes.")).toBeInTheDocument();
  });

  it("has no test email button while email is off", async () => {
    renderSettings(view({ email: email() }));
    await screen.findByRole("switch", { name: `Send reminders by email to ${address}` });
    expect(screen.queryByRole("button", { name: "Send a test email" })).not.toBeInTheDocument();
  });

  it("disables the switch when the server finds the address unverified after all", async () => {
    const user = userEvent.setup();
    server({ email: () => new Response(JSON.stringify({ error: "unverified" }), { status: 409 }) });
    renderSettings(view({ email: email() }));
    await user.click(await screen.findByRole("switch", { name: `Send reminders by email to ${address}` }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: `Send reminders by email to ${address}` })).toBeDisabled(),
    );
  });

  it("shows only email on a server without push", async () => {
    renderSettings(view({ publicKey: null, email: email() }));
    expect(await screen.findByRole("switch", { name: `Send reminders by email to ${address}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on notifications" })).not.toBeInTheDocument();
    expect(push.syncPush).not.toHaveBeenCalled();
  });

  it("shows no email row on a server without email", async () => {
    renderSettings(view());
    await screen.findByRole("button", { name: "Turn on notifications" });
    expect(screen.queryByRole("switch", { name: /by email/ })).not.toBeInTheDocument();
  });

  it("renders in Arabic", async () => {
    renderSettings(view({ email: email({ enabled: true }) }), ar, "ar");
    expect(await screen.findByRole("switch", { name: `أرسل التذكيرات بالبريد الإلكتروني إلى ${address}` })).toBeChecked();
    expect(screen.getByRole("button", { name: ar.notifications.sendTestEmail })).toBeInTheDocument();
  });
});
