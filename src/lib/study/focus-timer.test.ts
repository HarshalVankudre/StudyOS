import { describe, expect, it } from "vitest";
import {
  DONE_STALE_MS,
  FOCUS_PENDING_MAX,
  FOCUS_PENDING_MAX_AGE_MS,
  IDLE_TIMER,
  PAUSED_STALE_MS,
  elapsedMs,
  expireTimer,
  formatClock,
  isPaused,
  isRunning,
  nextFocus,
  parsePending,
  parseTimer,
  pauseTimer,
  remainingMs,
  resumeTimer,
  serializePending,
  serializeTimer,
  settleTimer,
  skipBreak,
  startBreak,
  startFocus,
  stopTimer,
  type FocusRecord,
} from "./focus-timer";

const T0 = Date.parse("2026-11-13T09:00:00Z");
const MIN = 60_000;
const ID = "c0ffee00-1111-2222-3333-444455556666";
const essay = { label: "History essay", course: "Semester HQ", workspaceId: "ws", itemKey: "deadline:ws:db:essay" };

const running = () => startFocus(IDLE_TIMER, { preset: "classic", clientId: ID, now: T0, target: essay });

describe("time left", () => {
  it("comes from the end timestamp, so a late tick never drifts", () => {
    const s = running();
    expect(s.phase).toBe("focus");
    expect(s.endsAt).toBe(T0 + 25 * MIN);
    expect(remainingMs(s, T0)).toBe(25 * MIN);
    expect(remainingMs(s, T0 + 10 * MIN + 500)).toBe(15 * MIN - 500);
    // A tab asleep for an hour: never negative.
    expect(remainingMs(s, T0 + 60 * MIN)).toBe(0);
    // A clock set back: never more than the block.
    expect(remainingMs(s, T0 - 5 * MIN)).toBe(25 * MIN);
    expect(elapsedMs(s, T0 + 10 * MIN)).toBe(10 * MIN);
  });

  it("reads as a clock, rounding seconds up", () => {
    expect(formatClock(25 * MIN)).toBe("25:00");
    expect(formatClock(25 * MIN - 1)).toBe("25:00");
    expect(formatClock(61_000)).toBe("01:01");
    expect(formatClock(1)).toBe("00:01");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(62 * MIN)).toBe("1:02:00");
  });

  it("is 0 outside a block", () => {
    expect(remainingMs(IDLE_TIMER, T0)).toBe(0);
    expect(elapsedMs(IDLE_TIMER, T0)).toBe(0);
  });
});

describe("pause and resume", () => {
  it("freezes the time left and moves the end on resume", () => {
    const paused = pauseTimer(running(), T0 + 10 * MIN);
    expect(isPaused(paused)).toBe(true);
    expect(paused.endsAt).toBeNull();
    expect(remainingMs(paused, T0 + 50 * MIN)).toBe(15 * MIN);
    const resumed = resumeTimer(paused, T0 + 40 * MIN);
    expect(isRunning(resumed)).toBe(true);
    expect(resumed.endsAt).toBe(T0 + 55 * MIN);
    // The pause does not count as focus.
    expect(elapsedMs(resumed, T0 + 45 * MIN)).toBe(15 * MIN);
  });

  it("ignores pausing a paused timer and resuming a running one", () => {
    const paused = pauseTimer(running(), T0 + MIN);
    expect(pauseTimer(paused, T0 + 2 * MIN)).toBe(paused);
    const s = running();
    expect(resumeTimer(s, T0)).toBe(s);
    expect(pauseTimer(IDLE_TIMER, T0)).toBe(IDLE_TIMER);
  });
});

describe("a block ending", () => {
  it("does nothing before the end", () => {
    const s = running();
    expect(settleTimer(s, T0 + 25 * MIN - 1)).toEqual({ state: s, ended: null, record: null });
  });

  it("turns a focus block into a done screen and a full-length record", () => {
    const { state, ended, record } = settleTimer(running(), T0 + 25 * MIN);
    expect(ended).toBe("focus");
    expect(state.phase).toBe("focusDone");
    expect(state.endedAt).toBe(T0 + 25 * MIN);
    expect(state.lastFocusSeconds).toBe(1500);
    expect(record).toEqual({ ...essay, clientId: ID, startedAt: T0, seconds: 1500, completed: true });
  });

  it("offers the preset's break, then the next block on the same item with a new id", () => {
    const done = settleTimer(running(), T0 + 25 * MIN).state;
    const rest = startBreak(done, T0 + 26 * MIN);
    expect(rest.phase).toBe("break");
    expect(rest.durationMs).toBe(5 * MIN);
    expect(rest.clientId).toBeNull();
    const over = settleTimer(rest, T0 + 31 * MIN);
    expect(over).toMatchObject({ ended: "break", record: null });
    expect(over.state.phase).toBe("breakDone");
    const next = nextFocus(over.state, { clientId: "next-block-0001", now: T0 + 32 * MIN });
    expect(next).toMatchObject({ phase: "focus", preset: "classic", clientId: "next-block-0001", ...essay });
    expect(next.endsAt).toBe(T0 + 57 * MIN);
  });

  it("can skip the break straight to the next-block offer", () => {
    const rest = startBreak(settleTimer(running(), T0 + 25 * MIN).state, T0 + 25 * MIN);
    const skipped = skipBreak(rest, T0 + 26 * MIN);
    expect(skipped).toMatchObject({ phase: "breakDone", endsAt: null, endedAt: T0 + 26 * MIN, ...essay });
    // Only a break can be skipped.
    const s = running();
    expect(skipBreak(s, T0)).toBe(s);
  });

  it("uses each preset's lengths", () => {
    const deep = startFocus(IDLE_TIMER, { preset: "deep", clientId: ID, now: T0 });
    expect(deep.durationMs).toBe(50 * MIN);
    expect(startBreak(settleTimer(deep, T0 + 50 * MIN).state, T0).durationMs).toBe(10 * MIN);
    expect(startFocus(IDLE_TIMER, { preset: "quick", clientId: ID, now: T0 }).durationMs).toBe(15 * MIN);
  });
});

describe("stopping early", () => {
  it("records what was done, pauses not counted", () => {
    let s = running();
    s = pauseTimer(s, T0 + 4 * MIN);
    s = resumeTimer(s, T0 + 30 * MIN);
    const { state, record } = stopTimer(s, T0 + 36 * MIN);
    expect(state.phase).toBe("idle");
    expect(record).toEqual({ ...essay, clientId: ID, startedAt: T0, seconds: 600, completed: false });
  });

  it("does not record less than a minute", () => {
    expect(stopTimer(running(), T0 + 59_000).record).toBeNull();
    expect(stopTimer(running(), T0 + 60_000).record?.seconds).toBe(60);
  });

  it("stopping a break or a done screen just goes idle, keeping preset and mute", () => {
    const done = { ...settleTimer(running(), T0 + 25 * MIN).state, preset: "deep" as const, muted: true };
    expect(stopTimer(done, T0)).toEqual({ state: { ...IDLE_TIMER, preset: "deep", muted: true }, ended: null, record: null });
    expect(stopTimer(startBreak(done, T0), T0 + MIN).record).toBeNull();
  });
});

describe("a timer left alone", () => {
  it("clears a done screen after hours", () => {
    const done = settleTimer(running(), T0 + 25 * MIN).state;
    expect(expireTimer(done, T0 + 25 * MIN + DONE_STALE_MS).state).toBe(done);
    expect(expireTimer(done, T0 + 25 * MIN + DONE_STALE_MS + 1).state.phase).toBe("idle");
  });

  it("stops a block paused for half a day, keeping its focus so far", () => {
    const paused = pauseTimer(running(), T0 + 20 * MIN);
    const { state, record } = expireTimer(paused, T0 + PAUSED_STALE_MS + 1);
    expect(state.phase).toBe("idle");
    expect(record).toMatchObject({ seconds: 1200, completed: false });
    expect(expireTimer(paused, T0 + PAUSED_STALE_MS).state).toBe(paused);
  });

  it("leaves running blocks to settleTimer", () => {
    const s = running();
    expect(expireTimer(s, T0 + 2 * PAUSED_STALE_MS).state).toBe(s);
  });
});

describe("what the browser keeps", () => {
  it("round-trips every phase", () => {
    const states = [
      running(),
      pauseTimer(running(), T0 + MIN),
      settleTimer(running(), T0 + 25 * MIN).state,
      startBreak(settleTimer(running(), T0 + 25 * MIN).state, T0 + 26 * MIN),
      { ...IDLE_TIMER, preset: "quick" as const, muted: true },
    ];
    for (const s of states) expect(parseTimer(serializeTimer(s))).toEqual(s);
  });

  it("falls back to idle on anything unreadable", () => {
    expect(parseTimer(null)).toEqual(IDLE_TIMER);
    expect(parseTimer("{not json")).toEqual(IDLE_TIMER);
    expect(parseTimer("[1,2]")).toEqual(IDLE_TIMER);
    expect(parseTimer(JSON.stringify({ v: 99, phase: "focus" }))).toEqual(IDLE_TIMER);
  });

  it("rejects inconsistent blocks but keeps the mute choice", () => {
    const base = JSON.parse(serializeTimer({ ...running(), muted: true }));
    const bad = [
      { ...base, endsAt: null }, // neither running nor paused
      { ...base, pausedLeft: 1000 }, // both
      { ...base, clientId: null }, // a focus block without an id
      { ...base, clientId: "<script>" },
      { ...base, durationMs: 999 * MIN }, // longer than its preset allows
      { ...base, durationMs: -1 },
      { ...base, endsAt: "soon" },
      { ...base, startedAt: null },
      { ...base, phase: "nap" },
      { ...base, phase: "focusDone", endedAt: null },
      { ...base, endsAt: null, pausedLeft: 26 * MIN },
    ];
    for (const entry of bad) {
      expect(parseTimer(JSON.stringify(entry)), JSON.stringify(entry)).toEqual({ ...IDLE_TIMER, muted: true });
    }
  });

  it("cleans the label fields it reads", () => {
    const raw = JSON.parse(serializeTimer(running()));
    const parsed = parseTimer(JSON.stringify({ ...raw, label: "  x".repeat(300), course: 42, workspaceId: "" }));
    expect(Array.from(parsed.label!).length).toBeLessThanOrEqual(200);
    expect(parsed.course).toBeNull();
    expect(parsed.workspaceId).toBeNull();
  });
});

describe("unsent saves", () => {
  const record = (o: Partial<FocusRecord> = {}): FocusRecord => ({
    ...essay,
    clientId: ID,
    startedAt: T0,
    seconds: 1500,
    completed: true,
    ...o,
  });

  it("round-trip, newest last", () => {
    const list = [record(), record({ clientId: "second-block-01", seconds: 600, completed: false })];
    expect(parsePending(serializePending(list), T0 + MIN)).toEqual(list);
  });

  it("drop malformed, duplicate, too short and too old entries", () => {
    const raw = JSON.stringify([
      record(),
      record(), // duplicate id
      record({ clientId: "x" }),
      record({ clientId: "short-block-001", seconds: 30 }),
      record({ clientId: "old-block-00001", startedAt: T0 - FOCUS_PENDING_MAX_AGE_MS - 1 }),
      "nonsense",
      null,
    ]);
    expect(parsePending(raw, T0).map((r) => r.clientId)).toEqual([ID]);
    expect(parsePending("{", T0)).toEqual([]);
    expect(parsePending(JSON.stringify({ a: 1 }), T0)).toEqual([]);
  });

  it("keep at most the newest few", () => {
    const many = Array.from({ length: FOCUS_PENDING_MAX + 5 }, (_, i) => record({ clientId: `block-${String(i).padStart(4, "0")}` }));
    const kept = parsePending(serializePending(many), T0);
    expect(kept).toHaveLength(FOCUS_PENDING_MAX);
    expect(kept.at(-1)?.clientId).toBe(`block-${String(FOCUS_PENDING_MAX + 4).padStart(4, "0")}`);
  });
});
