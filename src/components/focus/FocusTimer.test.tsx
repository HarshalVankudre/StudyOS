import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { START_FOCUS_EVENT } from "@/components/command/events";
import { IDLE_TIMER, parsePending, parseTimer, serializeTimer, startFocus } from "@/lib/study/focus-timer";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    record: vi.fn(),
    refresh,
    // Stable, like Next's router.
    router: { refresh },
    toast: vi.fn(),
    pathname: "/app",
    chimes: 0,
  };
});

vi.mock("@/app/app/focus-actions", () => ({ recordFocusSession: mocks.record }));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => mocks.pathname,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { FocusTimerProvider } from "./FocusTimerProvider";
import { focusStorageKeys, resetFocusStores } from "./focus-store";
import { useFocusLauncher } from "./launcher";

const F = en.focus;
const MIN = 60_000;
const T0 = Date.parse("2026-11-13T09:00:00Z");
const KEYS = focusStorageKeys("user_1");

/** A Web Audio stand-in that counts chimes (each chime starts two notes). */
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = async () => {};
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n };
  }
  createOscillator() {
    return {
      type: "sine",
      frequency: { value: 0 },
      connect: (n: unknown) => n,
      start() {
        mocks.chimes += 0.5;
      },
      stop() {},
    };
  }
}

/** A plain in-memory Storage (the test DOM's own may be unavailable). */
const memory = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, String(v)),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
};
function setStorage(storage: typeof memoryStorage) {
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
}

function Launch() {
  const focus = useFocusLauncher();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          focus?.open({ label: "History essay", course: "Semester HQ", workspaceId: "ws", itemKey: "deadline:ws:db:essay" })
        }
      >
        open essay
      </button>
      <p>active item: {focus?.activeItemKey ?? "none"}</p>
    </>
  );
}

function renderTimer(owner = "user_1") {
  return render(
    <I18nProvider locale="en" dictionary={en}>
      <FocusTimerProvider owner={owner}>
        <Launch />
      </FocusTimerProvider>
    </I18nProvider>,
  );
}

/** Let timers and promises (the save round trip) run. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * The wall clock jumps ahead at once (a sleeping laptop, a throttled tab),
 * then a little over a second passes: the timer must catch up from its stored
 * end time alone. Total time passed: `ms` + 1.1 s.
 */
async function jump(ms: number) {
  vi.setSystemTime(Date.now() + ms);
  await advance(1_100);
}

const stored = () => parseTimer(memory.get(KEYS.timer));
const pending = () => parsePending(memory.get(KEYS.pending), Date.now());

async function openFromPalette() {
  await act(async () => {
    window.dispatchEvent(new Event(START_FOCUS_EVENT));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  memory.clear();
  setStorage(memoryStorage);
  resetFocusStores();
  mocks.record.mockResolvedValue({ ok: true, stored: true });
  mocks.pathname = "/app";
  mocks.chimes = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  document.title = "StudyOS";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FocusTimer", () => {
  it("shows nothing until it is opened", async () => {
    renderTimer();
    await advance(0);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: F.timerLabel })).not.toBeInTheDocument();
  });

  it("starts from the command palette, counts down from the stored end, pauses and resumes", async () => {
    renderTimer();
    await openFromPalette();
    const panel = screen.getByRole("region", { name: F.setupTitle });
    fireEvent.change(within(panel).getByLabelText(F.labelField), { target: { value: "Chapter 4 reading" } });
    fireEvent.click(within(panel).getByRole("button", { name: /Classic/ }));

    expect(screen.getByRole("heading", { name: F.phaseFocus })).toBeInTheDocument();
    expect(screen.getByText("Chapter 4 reading")).toBeInTheDocument();
    const timer = screen.getByRole("timer");
    expect(timer).toHaveAttribute("aria-live", "off");
    expect(timer).toHaveTextContent("25:00");
    expect(stored()).toMatchObject({ phase: "focus", endsAt: T0 + 25 * MIN, label: "Chapter 4 reading" });
    expect(screen.getByRole("status")).toHaveTextContent("Focus block started: 25 min.");

    await advance(3_000);
    expect(screen.getByRole("timer")).toHaveTextContent("24:57");
    expect(document.title).toBe("24:57 focus · StudyOS");

    // Ten minutes pass in one go (the tab slept): read from the end time, no drift.
    await jump(10 * MIN);
    expect(screen.getByRole("timer")).toHaveTextContent("14:56");

    fireEvent.click(screen.getByRole("button", { name: F.pause }));
    expect(screen.getByRole("heading", { name: F.paused })).toBeInTheDocument();
    await jump(5 * MIN);
    expect(screen.getByRole("timer")).toHaveTextContent("14:56");
    expect(document.title).toBe("Paused 14:56 · StudyOS");

    fireEvent.click(screen.getByRole("button", { name: F.resume }));
    await advance(2_000);
    expect(screen.getByRole("timer")).toHaveTextContent("14:54");
  });

  it("stopping early saves what was done, without asking", async () => {
    renderTimer();
    await openFromPalette();
    fireEvent.click(screen.getByRole("button", { name: /Quick start/ }));
    await jump(12 * MIN);
    fireEvent.click(screen.getByRole("button", { name: F.stopEarly }));
    await advance(0);

    expect(mocks.record).toHaveBeenCalledTimes(1);
    const sent = mocks.record.mock.calls[0][0];
    expect(sent).toMatchObject({ startedAt: T0, seconds: 721, completed: false, label: null, workspaceId: null });
    expect(sent.clientId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(typeof sent.timeZone).toBe("string");
    expect(mocks.toast).toHaveBeenCalledWith("12 min of focus saved.");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(stored().phase).toBe("idle");
    expect(pending()).toEqual([]);
    // The summary on Today is redrawn with the new minutes.
    expect(mocks.refresh).toHaveBeenCalled();
    expect(document.title).toBe("StudyOS");
  });

  it("does not save a session stopped within the first minute", async () => {
    renderTimer();
    await openFromPalette();
    fireEvent.click(screen.getByRole("button", { name: /Classic/ }));
    await advance(40_000);
    fireEvent.click(screen.getByRole("button", { name: F.stopEarly }));
    await advance(0);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(F.tooShort);
  });

  it("a block that runs out saves its full length, chimes, and offers the break and the next block", async () => {
    renderTimer();
    await openFromPalette();
    fireEvent.click(screen.getByRole("button", { name: /Classic/ }));
    await jump(25 * MIN);

    expect(screen.getByRole("heading", { name: F.focusDoneTitle })).toBeInTheDocument();
    expect(screen.getByText("25 min of focus saved.")).toBeInTheDocument();
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ seconds: 1500, completed: true, startedAt: T0 }));
    expect(mocks.chimes).toBe(1);
    expect(screen.getByRole("status")).toHaveTextContent("Focus block done. 25 min saved.");
    expect(document.title).toBe("StudyOS");

    fireEvent.click(screen.getByRole("button", { name: "Take a 5 min break" }));
    expect(screen.getByRole("heading", { name: F.phaseBreak })).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("05:00");
    // A block that ends on its own never pulls keyboard focus away.
    const elsewhere = screen.getByRole("button", { name: "open essay" });
    elsewhere.focus();
    await jump(5 * MIN);
    expect(screen.getByRole("heading", { name: F.breakDoneTitle })).toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
    expect(mocks.chimes).toBe(2);
    // Breaks are never saved.
    expect(mocks.record).toHaveBeenCalledTimes(1);

    const firstId = mocks.record.mock.calls[0][0].clientId;
    fireEvent.click(screen.getByRole("button", { name: F.nextBlock }));
    expect(screen.getByRole("timer")).toHaveTextContent("25:00");
    expect(stored().clientId).not.toBe(firstId);
  });

  it("can skip the break, and then offers the next block", async () => {
    renderTimer();
    await openFromPalette();
    fireEvent.click(screen.getByRole("button", { name: /Quick start/ }));
    await jump(15 * MIN);
    fireEvent.click(screen.getByRole("button", { name: "Take a 5 min break" }));
    fireEvent.click(screen.getByRole("button", { name: F.skipBreak }));
    expect(screen.getByRole("heading", { name: F.breakDoneTitle })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: F.nextBlock })).toBeInTheDocument();
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  it("ends the block on time from its own timeout, not only on a visible tick", async () => {
    renderTimer();
    await openFromPalette();
    fireEvent.click(screen.getByRole("button", { name: /Quick start/ }));
    await advance(15 * MIN + 100);
    expect(screen.getByRole("heading", { name: F.focusDoneTitle })).toBeInTheDocument();
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ seconds: 900, completed: true }));
  });

  it("stays quiet when muted", async () => {
    renderTimer();
    await openFromPalette();
    fireEvent.click(screen.getByRole("button", { name: F.mute }));
    expect(screen.getByRole("button", { name: F.unmute })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Quick start/ }));
    await jump(15 * MIN);
    expect(screen.getByRole("heading", { name: F.focusDoneTitle })).toBeInTheDocument();
    expect(mocks.chimes).toBe(0);
    expect(stored().muted).toBe(true);
  });

  it("starts from a Today item with its title, course, workspace and item", async () => {
    renderTimer();
    fireEvent.click(screen.getByRole("button", { name: "open essay" }));
    const panel = screen.getByRole("region", { name: F.setupTitle });
    expect(within(panel).getByText("History essay")).toBeInTheDocument();
    expect(within(panel).getByText("Semester HQ")).toBeInTheDocument();
    // The item names the session: no label field.
    expect(within(panel).queryByLabelText(F.labelField)).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: /Deep work/ }));
    expect(screen.getByText("active item: deadline:ws:db:essay")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("50:00");

    await jump(30 * MIN);
    fireEvent.click(screen.getByRole("button", { name: F.stopEarly }));
    await advance(0);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "History essay",
        course: "Semester HQ",
        workspaceId: "ws",
        itemKey: "deadline:ws:db:essay",
        seconds: 1801,
      }),
    );
    expect(screen.getByText("active item: none")).toBeInTheDocument();
  });

  it("minimizes to a pill that keeps counting, and opens again", async () => {
    renderTimer();
    await openFromPalette();
    // Opening the timer takes keyboard focus to it.
    expect(screen.getByRole("heading", { name: F.setupTitle })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /Classic/ }));
    fireEvent.click(screen.getByRole("button", { name: F.minimize }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    const pill = screen.getByRole("group", { name: F.timerLabel });
    // Minimizing keeps focus on the timer (the pill), not lost on the page.
    expect(within(pill).getByRole("button", { name: new RegExp(F.expand) })).toHaveFocus();
    await advance(2_000);
    expect(pill).toHaveTextContent("24:58");
    fireEvent.click(within(pill).getByRole("button", { name: F.pause }));
    expect(within(pill).getByRole("button", { name: F.resume })).toBeInTheDocument();
    fireEvent.click(within(pill).getByRole("button", { name: new RegExp(F.expand) }));
    expect(screen.getByRole("region", { name: F.paused })).toBeInTheDocument();
  });

  it("survives a refresh: the running block is restored from storage", async () => {
    const running = startFocus(IDLE_TIMER, {
      preset: "classic",
      clientId: "restored-block-01",
      now: T0 - 5 * MIN,
      target: { label: "Lab report" },
    });
    memory.set(KEYS.timer, serializeTimer(running));
    renderTimer();
    await advance(0);
    const pill = screen.getByRole("group", { name: F.timerLabel });
    expect(pill).toHaveTextContent("20:00");
    fireEvent.click(within(pill).getByRole("button", { name: new RegExp(F.expand) }));
    expect(screen.getByRole("timer")).toHaveTextContent("20:00");
    expect(screen.getByText("Lab report")).toBeInTheDocument();
  });

  it("a block that ran out while the page was closed is saved on return, quietly", async () => {
    const running = startFocus(IDLE_TIMER, { preset: "classic", clientId: "closed-tab-block", now: T0 - 2 * 60 * MIN });
    memory.set(KEYS.timer, serializeTimer(running));
    renderTimer();
    await advance(0);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ clientId: "closed-tab-block", seconds: 1500, completed: true }));
    expect(mocks.chimes).toBe(0);
    expect(screen.getByRole("group", { name: F.timerLabel })).toHaveTextContent(F.focusDoneTitle);
  });

  it("keeps a save that could not be sent and sends it when back online", async () => {
    mocks.record.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderTimer();
    await openFromPalette();
    fireEvent.click(screen.getByRole("button", { name: /Classic/ }));
    await jump(3 * MIN);
    fireEvent.click(screen.getByRole("button", { name: F.stopEarly }));
    await advance(0);
    expect(mocks.toast).toHaveBeenCalledWith(F.saveFailed);
    expect(pending()).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.record).toHaveBeenCalledTimes(2);
    // The retry carries the same id, so the server counts it once.
    expect(mocks.record.mock.calls[1][0].clientId).toBe(mocks.record.mock.calls[0][0].clientId);
    expect(pending()).toEqual([]);
  });

  it("never shows one student's session to the next person on the device", async () => {
    const running = startFocus(IDLE_TIMER, { preset: "classic", clientId: "someone-elses-01", now: T0 });
    memory.set(KEYS.timer, serializeTimer(running));
    renderTimer("user_2");
    await advance(0);
    expect(screen.queryByRole("group", { name: F.timerLabel })).not.toBeInTheDocument();
  });

  it("works without storage (private mode): the timer runs in memory", async () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    setStorage({ getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked });
    renderTimer();
    await openFromPalette();
    fireEvent.click(screen.getByRole("button", { name: /Classic/ }));
    await advance(2_000);
    expect(screen.getByRole("timer")).toHaveTextContent("24:58");
  });

  it("offers notifications only on request, and never asks by itself", async () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    vi.stubGlobal("Notification", Object.assign(function Notification() {}, { permission: "default", requestPermission }));
    renderTimer();
    await openFromPalette();
    fireEvent.click(screen.getByRole("button", { name: /Classic/ }));
    await jump(25 * MIN);
    expect(screen.getByRole("heading", { name: F.focusDoneTitle })).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: F.notifyOffer }));
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});
