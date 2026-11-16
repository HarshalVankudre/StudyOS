/**
 * The focus timer's state in this browser: one small JSON value in
 * localStorage per signed-in student (so the next person on a shared device
 * never sees or saves someone else's session), read through
 * useSyncExternalStore. Other tabs' changes arrive through the `storage`
 * event, so every open tab shows the same timer.
 *
 * Storage can be missing or throw (private mode, blocked site data): every
 * access is wrapped, and the timer then simply lives in memory for this page.
 */
import {
  FOCUS_PENDING_MAX,
  IDLE_TIMER,
  parsePending,
  parseTimer,
  serializePending,
  serializeTimer,
  type FocusRecord,
  type FocusTimerState,
} from "@/lib/study/focus-timer";

const TIMER_PREFIX = "studyos:focus-timer:";
const PENDING_PREFIX = "studyos:focus-pending:";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode or full storage: the timer keeps running in memory.
  }
}

export interface FocusStore {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => FocusTimerState;
  getServerSnapshot: () => FocusTimerState;
  set: (next: FocusTimerState) => void;
  /** Saves not yet confirmed by the server. */
  pending: (now: number) => FocusRecord[];
  setPending: (records: readonly FocusRecord[]) => void;
}

function createStore(owner: string): FocusStore {
  const key = TIMER_PREFIX + owner;
  const pendingKey = PENDING_PREFIX + owner;
  const listeners = new Set<() => void>();
  // undefined = not read yet. The in-memory copy is the truth for this tab.
  let raw: string | null | undefined;
  let cache: { raw: string | null; state: FocusTimerState } = { raw: null, state: IDLE_TIMER };
  let memoryPending: string | null = null;

  const emit = () => {
    for (const listener of listeners) listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    raw = event.key === null ? null : event.newValue;
    emit();
  };

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      if (listeners.size === 1) window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot() {
      if (raw === undefined) raw = read(key);
      if (raw !== cache.raw) cache = { raw, state: parseTimer(raw) };
      return cache.state;
    },
    getServerSnapshot: () => IDLE_TIMER,
    set(next) {
      raw = serializeTimer(next);
      write(key, raw);
      emit();
    },
    pending(now) {
      return parsePending(read(pendingKey) ?? memoryPending, now);
    },
    setPending(records) {
      const value = records.length > 0 ? serializePending(records.slice(-FOCUS_PENDING_MAX)) : null;
      memoryPending = value;
      write(pendingKey, value);
    },
  };
}

const stores = new Map<string, FocusStore>();

/** The store for one signed-in student (one per page, shared by every hook). */
export function focusStore(owner: string): FocusStore {
  // On the server (rendering the page) nothing is read or kept: a fresh,
  // empty store each time, so no per-student entry piles up in memory.
  if (typeof window === "undefined") return createStore(owner);
  let store = stores.get(owner);
  if (!store) {
    store = createStore(owner);
    stores.set(owner, store);
  }
  return store;
}

/** Forget every in-memory copy, as a page load would (tests). */
export function resetFocusStores(): void {
  stores.clear();
}

export const focusStorageKeys = (owner: string) => ({ timer: TIMER_PREFIX + owner, pending: PENDING_PREFIX + owner });
