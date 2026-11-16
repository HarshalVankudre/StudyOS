/**
 * The focus timer as pure state: presets, phases, time left, and what is kept
 * in the browser's storage. No React and no browser APIs, so every rule is
 * testable with plain numbers.
 *
 * Time left is always computed from a stored end timestamp (`endsAt`), never
 * by counting ticks: a throttled background tab, a sleeping laptop or a page
 * refresh cannot make the timer drift. While paused, the time left is frozen
 * in `pausedLeft` instead.
 *
 *   idle ──start──▶ focus ──ends──▶ focusDone ──break──▶ break ──ends──▶ breakDone
 *                     │                 │                  │                │
 *                   stop              next block         stop/skip        next block
 *
 * A focus block that ends, or is stopped after at least a minute, yields a
 * FocusRecord for the server. Breaks are never recorded.
 */
import { FOCUS_MIN_SECONDS, FOCUS_CLIENT_ID_RE, FOCUS_LABEL_MAX } from "./focus";

export const FOCUS_PRESETS = {
  classic: { focusMinutes: 25, breakMinutes: 5 },
  deep: { focusMinutes: 50, breakMinutes: 10 },
  quick: { focusMinutes: 15, breakMinutes: 5 },
} as const;

export type FocusPresetId = keyof typeof FOCUS_PRESETS;
/** The order the presets are offered in. */
export const FOCUS_PRESET_ORDER: readonly FocusPresetId[] = ["classic", "deep", "quick"];

export type FocusPhase = "idle" | "focus" | "focusDone" | "break" | "breakDone";

/** What a session is about. Every field is optional: "just focus" is fine. */
export interface FocusTarget {
  /** The item's title or the student's own words. */
  label: string | null;
  /** The course (workspace) it belongs to, shown under the label. */
  course: string | null;
  workspaceId: string | null;
  /** The Today plan item the session was started from. */
  itemKey: string | null;
}

export interface FocusTimerState extends FocusTarget {
  phase: FocusPhase;
  preset: FocusPresetId;
  /** Length of the current block, ms. */
  durationMs: number;
  /** While running: when the block ends (epoch ms). */
  endsAt: number | null;
  /** While paused: ms left. */
  pausedLeft: number | null;
  /** When the current block first started (epoch ms). */
  startedAt: number | null;
  /** The browser's random id for the current focus block (idempotent saves). */
  clientId: string | null;
  /** When the last block ended (epoch ms), in the done phases. */
  endedAt: number | null;
  /** Seconds of focus the last focus block recorded (for "25 min recorded"). */
  lastFocusSeconds: number;
  /** No chime at the end of a block. */
  muted: boolean;
}

/** A finished focus block, ready to send to the server. */
export interface FocusRecord extends FocusTarget {
  clientId: string;
  /** Epoch ms. */
  startedAt: number;
  seconds: number;
  /** Ran to the end (false: stopped early). */
  completed: boolean;
}

export const IDLE_TIMER: FocusTimerState = {
  phase: "idle",
  preset: "classic",
  durationMs: 0,
  endsAt: null,
  pausedLeft: null,
  startedAt: null,
  clientId: null,
  endedAt: null,
  lastFocusSeconds: 0,
  label: null,
  course: null,
  workspaceId: null,
  itemKey: null,
  muted: false,
};

/** A done screen older than this is cleared when the timer is next looked at. */
export const DONE_STALE_MS = 6 * 60 * 60 * 1000;
/** A block paused longer than this is stopped (and its focus so far recorded). */
export const PAUSED_STALE_MS = 12 * 60 * 60 * 1000;

const NO_TARGET: FocusTarget = { label: null, course: null, workspaceId: null, itemKey: null };

export function presetMinutes(preset: FocusPresetId, phase: "focus" | "break"): number {
  const p = FOCUS_PRESETS[preset];
  return phase === "focus" ? p.focusMinutes : p.breakMinutes;
}

/** A focus or break block is on the clock (running or paused). */
export function isActive(state: FocusTimerState): boolean {
  return state.phase === "focus" || state.phase === "break";
}

export function isRunning(state: FocusTimerState): boolean {
  return isActive(state) && state.endsAt !== null;
}

export function isPaused(state: FocusTimerState): boolean {
  return isActive(state) && state.endsAt === null && state.pausedLeft !== null;
}

/** Ms left in the current block (0 outside a block). */
export function remainingMs(state: FocusTimerState, now: number): number {
  if (!isActive(state)) return 0;
  if (state.endsAt !== null) return Math.max(0, Math.min(state.durationMs, state.endsAt - now));
  return Math.max(0, Math.min(state.durationMs, state.pausedLeft ?? 0));
}

/** Ms of the current block already done (pauses not counted). */
export function elapsedMs(state: FocusTimerState, now: number): number {
  if (!isActive(state)) return 0;
  return state.durationMs - remainingMs(state, now);
}

/** "24:59", or "1:02:03" past an hour. Seconds round up, so a fresh 25-minute block reads 25:00. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

export function targetOf(state: FocusTimerState): FocusTarget {
  return { label: state.label, course: state.course, workspaceId: state.workspaceId, itemKey: state.itemKey };
}

/** Back to idle, keeping the chosen preset and the mute choice. */
export function toIdle(state: FocusTimerState): FocusTimerState {
  return { ...IDLE_TIMER, preset: state.preset, muted: state.muted };
}

/** Start a focus block now. */
export function startFocus(
  state: FocusTimerState,
  input: { preset: FocusPresetId; clientId: string; now: number; target?: Partial<FocusTarget> },
): FocusTimerState {
  const durationMs = presetMinutes(input.preset, "focus") * 60_000;
  return {
    ...toIdle(state),
    ...NO_TARGET,
    ...cleanTarget(input.target),
    phase: "focus",
    preset: input.preset,
    durationMs,
    endsAt: input.now + durationMs,
    startedAt: input.now,
    clientId: input.clientId,
  };
}

/** Another focus block about the same thing, with the same preset. */
export function nextFocus(state: FocusTimerState, input: { clientId: string; now: number }): FocusTimerState {
  return startFocus(state, { preset: state.preset, clientId: input.clientId, now: input.now, target: targetOf(state) });
}

/** The break that follows a focus block. */
export function startBreak(state: FocusTimerState, now: number): FocusTimerState {
  const durationMs = presetMinutes(state.preset, "break") * 60_000;
  return {
    ...state,
    phase: "break",
    durationMs,
    endsAt: now + durationMs,
    pausedLeft: null,
    startedAt: now,
    clientId: null,
    endedAt: null,
  };
}

/** "Skip break": the break ends now, and the next block is offered. */
export function skipBreak(state: FocusTimerState, now: number): FocusTimerState {
  if (state.phase !== "break") return state;
  return { ...state, phase: "breakDone", endsAt: null, pausedLeft: null, endedAt: now };
}

export function pauseTimer(state: FocusTimerState, now: number): FocusTimerState {
  if (!isRunning(state)) return state;
  return { ...state, endsAt: null, pausedLeft: remainingMs(state, now) };
}

export function resumeTimer(state: FocusTimerState, now: number): FocusTimerState {
  if (!isPaused(state)) return state;
  return { ...state, endsAt: now + (state.pausedLeft ?? 0), pausedLeft: null };
}

function recordOf(state: FocusTimerState, seconds: number, completed: boolean): FocusRecord | null {
  if (!state.clientId || state.startedAt === null) return null;
  return { ...targetOf(state), clientId: state.clientId, startedAt: state.startedAt, seconds, completed };
}

export interface Transition {
  state: FocusTimerState;
  /** The block that just ended on its own, if one did. */
  ended: "focus" | "break" | null;
  /** Focus to save, if any. */
  record: FocusRecord | null;
}

/**
 * Move a running block past its end, if its time is up. A focus block that
 * ran out records its full length.
 */
export function settleTimer(state: FocusTimerState, now: number): Transition {
  if (!isRunning(state) || state.endsAt === null || now < state.endsAt) {
    return { state, ended: null, record: null };
  }
  if (state.phase === "focus") {
    const seconds = Math.round(state.durationMs / 1000);
    return {
      state: { ...state, phase: "focusDone", endsAt: null, pausedLeft: null, endedAt: state.endsAt, lastFocusSeconds: seconds },
      ended: "focus",
      record: recordOf(state, seconds, true),
    };
  }
  return {
    state: { ...state, phase: "breakDone", endsAt: null, pausedLeft: null, endedAt: state.endsAt },
    ended: "break",
    record: null,
  };
}

/**
 * Stop now. Stopping a focus block early keeps what was done, if it was at
 * least a minute; stopping a break or a done screen just goes idle.
 */
export function stopTimer(state: FocusTimerState, now: number): Transition {
  if (state.phase !== "focus") return { state: toIdle(state), ended: null, record: null };
  const seconds = Math.floor(elapsedMs(state, now) / 1000);
  return {
    state: toIdle(state),
    ended: null,
    record: seconds >= FOCUS_MIN_SECONDS ? recordOf(state, seconds, false) : null,
  };
}

/**
 * Tidy a timer that was left alone: a done screen from hours ago goes idle,
 * and a block paused for half a day is stopped (keeping its focus so far).
 * Running blocks are left to settleTimer.
 */
export function expireTimer(state: FocusTimerState, now: number): Transition {
  if ((state.phase === "focusDone" || state.phase === "breakDone") && now - (state.endedAt ?? 0) > DONE_STALE_MS) {
    return { state: toIdle(state), ended: null, record: null };
  }
  if (isPaused(state) && now - (state.startedAt ?? 0) > PAUSED_STALE_MS) return stopTimer(state, now);
  return { state, ended: null, record: null };
}

// ---- What the browser keeps ------------------------------------------------

export const FOCUS_STORAGE_VERSION = 1;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, max).join("");
}

function cleanTarget(target: Partial<FocusTarget> | undefined): FocusTarget {
  return {
    label: cleanText(target?.label, FOCUS_LABEL_MAX),
    course: cleanText(target?.course, FOCUS_LABEL_MAX),
    workspaceId: cleanText(target?.workspaceId, 200),
    itemKey: cleanText(target?.itemKey, 400),
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const time = (v: unknown): number | null => (finite(v) && v >= 0 ? v : null);
const PHASES: readonly FocusPhase[] = ["idle", "focus", "focusDone", "break", "breakDone"];

export function serializeTimer(state: FocusTimerState): string {
  return JSON.stringify({ v: FOCUS_STORAGE_VERSION, ...state });
}

/**
 * The stored timer, checked field by field. Anything malformed or
 * inconsistent (a block with neither an end time nor a paused time, a focus
 * block without an id) falls back to idle, keeping the mute choice when that
 * part is readable.
 */
export function parseTimer(raw: string | null | undefined): FocusTimerState {
  if (!raw) return IDLE_TIMER;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return IDLE_TIMER;
    data = parsed as Record<string, unknown>;
  } catch {
    return IDLE_TIMER;
  }
  const muted = data.muted === true;
  const preset: FocusPresetId =
    typeof data.preset === "string" && data.preset in FOCUS_PRESETS ? (data.preset as FocusPresetId) : "classic";
  const base: FocusTimerState = { ...IDLE_TIMER, preset, muted };
  if (data.v !== FOCUS_STORAGE_VERSION) return base;
  const phase = PHASES.find((p) => p === data.phase);
  if (!phase || phase === "idle") return base;

  const durationMs = time(data.durationMs);
  const endsAt = time(data.endsAt);
  const pausedLeft = time(data.pausedLeft);
  const startedAt = time(data.startedAt);
  const endedAt = time(data.endedAt);
  const clientId = typeof data.clientId === "string" && FOCUS_CLIENT_ID_RE.test(data.clientId) ? data.clientId : null;
  const lastFocusSeconds = time(data.lastFocusSeconds) ?? 0;
  const maxBlock = presetMinutes(preset, phase === "break" || phase === "breakDone" ? "break" : "focus") * 60_000;
  if (durationMs === null || durationMs <= 0 || durationMs > maxBlock) return base;

  const state: FocusTimerState = {
    ...base,
    ...cleanTarget(data as Partial<FocusTarget>),
    phase,
    durationMs,
    endsAt: null,
    pausedLeft: null,
    startedAt,
    clientId,
    endedAt,
    lastFocusSeconds: Math.round(lastFocusSeconds),
  };
  if (phase === "focus" || phase === "break") {
    if (startedAt === null) return base;
    if (phase === "focus" && clientId === null) return base;
    // Exactly one of: running (an end time) or paused (time left).
    if (endsAt !== null && pausedLeft === null) return { ...state, endsAt };
    if (endsAt === null && pausedLeft !== null && pausedLeft <= durationMs) return { ...state, pausedLeft };
    return base;
  }
  return endedAt === null ? base : state;
}

/** Saves not yet confirmed by the server, oldest first. */
export const FOCUS_PENDING_MAX = 20;
/** A save older than this would be refused by the server, so it is dropped. */
export const FOCUS_PENDING_MAX_AGE_MS = 23 * 60 * 60 * 1000;

export function parsePending(raw: string | null | undefined, now: number): FocusRecord[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: FocusRecord[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.clientId !== "string" || !FOCUS_CLIENT_ID_RE.test(e.clientId) || seen.has(e.clientId)) continue;
    const startedAt = time(e.startedAt);
    if (startedAt === null || now - startedAt > FOCUS_PENDING_MAX_AGE_MS) continue;
    if (!finite(e.seconds) || e.seconds < FOCUS_MIN_SECONDS) continue;
    seen.add(e.clientId);
    out.push({
      ...cleanTarget(e as Partial<FocusTarget>),
      clientId: e.clientId,
      startedAt,
      seconds: Math.floor(e.seconds),
      completed: e.completed === true,
    });
  }
  return out.slice(-FOCUS_PENDING_MAX);
}

export function serializePending(records: readonly FocusRecord[]): string {
  return JSON.stringify(records.slice(-FOCUS_PENDING_MAX));
}
