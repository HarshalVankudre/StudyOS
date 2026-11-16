"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { recordFocusSession } from "@/app/app/focus-actions";
import { START_FOCUS_EVENT } from "@/components/command/events";
import { formatDuration } from "@/lib/agents/daily-study/present";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/interpolate";
import {
  expireTimer,
  formatClock,
  isActive,
  isPaused,
  nextFocus,
  pauseTimer,
  presetMinutes,
  remainingMs,
  resumeTimer,
  settleTimer,
  skipBreak,
  startBreak,
  startFocus,
  stopTimer,
  toIdle,
  type FocusPresetId,
  type FocusRecord,
  type FocusTarget,
} from "@/lib/study/focus-timer";
import { notifyBlockEnd, playChime, unlockAudio } from "./alerts";
import { focusStore } from "./focus-store";
import { FocusTimer, type FocusPanel } from "./FocusTimer";
import { FocusLauncherContext, type FocusLauncher } from "./launcher";

/** A block that ended longer ago than this (the tab was closed) ends quietly. */
const LIVE_END_MS = 90_000;

const NO_TARGET: FocusTarget = { label: null, course: null, workspaceId: null, itemKey: null };

function newClientId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Pages that show the focus summary (refreshed after a save). */
function showsSummary(pathname: string | null): boolean {
  return pathname === "/app" || pathname === "/app/";
}

/**
 * The focus timer for every signed-in page: one timer per student, kept in
 * this browser's storage (see focus-store.ts) so it survives moving between
 * pages and refreshing. Renders the floating panel and a polite live region
 * that announces changes (start, pause, a block ending), never every second.
 */
export function FocusTimerProvider({ owner, children }: { owner: string; children: React.ReactNode }) {
  const store = focusStore(owner);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const { dict } = useI18n();
  const F = dict.focus;
  const T = dict.today;
  const router = useRouter();
  const pathname = usePathname();
  const [panel, setPanel] = useState<FocusPanel>("closed");
  const [draft, setDraft] = useState<FocusTarget>(NO_TARGET);
  // Where keyboard focus goes after the student opens or minimizes the timer
  // (never moved when a block ends on its own).
  const [focusRequest, setFocusRequest] = useState<FocusPanel | null>(null);
  // The count makes a repeated message (pause, pause again) read out again.
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, count: a.count + 1 })), []);
  const pathRef = useRef(pathname);
  const flushing = useRef(false);
  const flushAgain = useRef(false);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const minutesText = useCallback((minutes: number) => formatDuration(minutes, T), [T]);

  /** Send every save not yet confirmed. Returns false when one could not be sent. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (flushing.current) {
      // A save arrived while others were being sent: send it in the same run.
      flushAgain.current = true;
      return true;
    }
    flushing.current = true;
    let saved = false;
    let ok = true;
    try {
      do {
        flushAgain.current = false;
        for (const record of store.pending(Date.now())) {
          let result: Awaited<ReturnType<typeof recordFocusSession>> | null = null;
          try {
            result = await recordFocusSession({ ...record, timeZone: browserTimeZone() });
          } catch {
            // Offline, or the app was updated meanwhile: kept for the next try.
            result = null;
          }
          // Saved, a duplicate of a save, or a session the server can never take.
          if (result && (result.ok || result.reason === "invalid")) {
            store.setPending(store.pending(Date.now()).filter((r) => r.clientId !== record.clientId));
            if (result.ok && result.stored) saved = true;
          } else {
            ok = false;
            break;
          }
        }
      } while (ok && flushAgain.current);
    } finally {
      flushing.current = false;
    }
    if (saved && showsSummary(pathRef.current)) router.refresh();
    return ok;
  }, [router, store]);

  const save = useCallback(
    (record: FocusRecord | null) => {
      if (!record) return;
      const others = store.pending(Date.now()).filter((r) => r.clientId !== record.clientId);
      store.setPending([...others, record]);
      void flush().then((ok) => {
        if (!ok) toast(F.saveFailed);
      });
    },
    [F.saveFailed, flush, store],
  );

  /** Move the timer on if its block is over (or it was left alone for hours). */
  const settle = useCallback(() => {
    const now = Date.now();
    const current = store.getSnapshot();
    const expired = expireTimer(current, now);
    if (expired.state !== current) {
      store.set(expired.state);
      save(expired.record);
      return;
    }
    const step = settleTimer(current, now);
    if (!step.ended) return;
    store.set(step.state);
    save(step.record);
    const focusTime = minutesText(Math.round(step.state.lastFocusSeconds / 60));
    announce(step.ended === "focus" ? fmt(F.announceFocusDone, { time: focusTime }) : F.announceBreakDone);
    // Only a block that ended just now chimes; one that ran out while the tab was closed does not.
    if (current.endsAt !== null && now - current.endsAt < LIVE_END_MS) {
      if (!current.muted) playChime();
      void (step.ended === "focus"
        ? notifyBlockEnd(F.notifyFocusTitle, fmt(F.notifyFocusBody, { time: focusTime }))
        : notifyBlockEnd(F.notifyBreakTitle, F.notifyBreakBody));
      setPanel("open");
    }
  }, [F, announce, minutesText, save, store]);

  // On load: settle what happened while the page was closed, send unsent
  // saves, and keep sending them when the connection comes back.
  useEffect(() => {
    const first = window.setTimeout(() => {
      settle();
      void flush();
    }, 0);
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("online", online);
    };
  }, [flush, settle]);

  // End the block on time, even in a background tab (a single timeout is not
  // throttled the way a repeating one is).
  useEffect(() => {
    if (state.endsAt === null || !isActive(state)) return;
    const id = window.setTimeout(settle, Math.max(0, state.endsAt - Date.now()) + 50);
    return () => window.clearTimeout(id);
  }, [settle, state]);

  // The countdown in the tab title while a block is on the clock.
  useEffect(() => {
    if (!isActive(state)) return;
    let base = document.title;
    let written = "";
    const update = () => {
      // The page changed the title (navigation): that is the new base.
      if (document.title !== written) base = document.title;
      const current = store.getSnapshot();
      if (!isActive(current)) return;
      const clock = formatClock(remainingMs(current, Date.now()));
      const prefix = isPaused(current)
        ? `${F.titlePaused} ${clock}`
        : fmt(current.phase === "focus" ? F.titleFocus : F.titleBreak, { time: clock });
      written = `${prefix} · ${base}`;
      document.title = written;
    };
    update();
    const id = window.setInterval(() => {
      update();
      // A backup for the end-of-block timeout (e.g. after the computer slept).
      const current = store.getSnapshot();
      if (current.endsAt !== null && Date.now() >= current.endsAt) settle();
    }, 1000);
    return () => {
      window.clearInterval(id);
      if (document.title === written) document.title = base;
    };
  }, [F.titleBreak, F.titleFocus, F.titlePaused, settle, state, store]);

  const open = useCallback(
    (target?: Partial<FocusTarget>) => {
      const current = store.getSnapshot();
      setFocusRequest("open");
      if (isActive(current)) {
        setPanel("open");
        return;
      }
      // A new session replaces a done screen.
      if (current.phase !== "idle") store.set(toIdle(current));
      setDraft({ ...NO_TARGET, ...target });
      setPanel("open");
    },
    [store],
  );

  const showPanel = useCallback((next: FocusPanel) => {
    setFocusRequest(next);
    setPanel(next);
  }, []);
  const focusTaken = useCallback(() => setFocusRequest(null), []);

  // The command palette's "Start focus timer".
  useEffect(() => {
    const onStart = () => open();
    window.addEventListener(START_FOCUS_EVENT, onStart);
    return () => window.removeEventListener(START_FOCUS_EVENT, onStart);
  }, [open]);

  const start = useCallback(
    (preset: FocusPresetId, label?: string) => {
      unlockAudio();
      const typed = label?.trim();
      const target = typed ? { ...draft, label: typed } : draft;
      store.set(startFocus(store.getSnapshot(), { preset, clientId: newClientId(), now: Date.now(), target }));
      announce(fmt(F.announceStart, { time: minutesText(presetMinutes(preset, "focus")) }));
      setPanel("open");
    },
    [F.announceStart, announce, draft, minutesText, store],
  );

  const pause = useCallback(() => {
    store.set(pauseTimer(store.getSnapshot(), Date.now()));
    announce(F.announcePaused);
  }, [F.announcePaused, announce, store]);

  const resume = useCallback(() => {
    unlockAudio();
    store.set(resumeTimer(store.getSnapshot(), Date.now()));
    announce(F.announceResumed);
  }, [F.announceResumed, announce, store]);

  /** Stop now, without asking: focus of a minute or more is saved. */
  const stop = useCallback(() => {
    const current = store.getSnapshot();
    const step = stopTimer(current, Date.now());
    store.set(step.state);
    save(step.record);
    if (current.phase === "focus") {
      toast(step.record ? fmt(F.focusDoneBody, { time: minutesText(Math.round(step.record.seconds / 60)) }) : F.tooShort);
    }
    announce(F.announceStopped);
    setDraft(NO_TARGET);
    setPanel("closed");
  }, [F.announceStopped, F.focusDoneBody, F.tooShort, announce, minutesText, save, store]);

  const takeBreak = useCallback(() => {
    unlockAudio();
    const next = startBreak(store.getSnapshot(), Date.now());
    store.set(next);
    announce(fmt(F.announceBreak, { time: minutesText(Math.round(next.durationMs / 60_000)) }));
  }, [F.announceBreak, announce, minutesText, store]);

  const endBreak = useCallback(() => {
    store.set(skipBreak(store.getSnapshot(), Date.now()));
    announce(F.announceBreakDone);
  }, [F.announceBreakDone, announce, store]);

  const nextBlock = useCallback(() => {
    unlockAudio();
    const next = nextFocus(store.getSnapshot(), { clientId: newClientId(), now: Date.now() });
    store.set(next);
    announce(fmt(F.announceStart, { time: minutesText(Math.round(next.durationMs / 60_000)) }));
  }, [F.announceStart, announce, minutesText, store]);

  /** "Done for now", or closing the panel outside a block. */
  const finish = useCallback(() => {
    const current = store.getSnapshot();
    if (!isActive(current) && current.phase !== "idle") store.set(toIdle(current));
    setDraft(NO_TARGET);
    setPanel("closed");
  }, [store]);

  const toggleMute = useCallback(() => {
    const current = store.getSnapshot();
    store.set({ ...current, muted: !current.muted });
  }, [store]);

  const activeItemKey = isActive(state) ? state.itemKey : null;
  const launcher = useMemo<FocusLauncher>(() => ({ open, activeItemKey }), [open, activeItemKey]);

  return (
    <FocusLauncherContext.Provider value={launcher}>
      {children}
      <FocusTimer
        state={state}
        panel={panel}
        draft={draft}
        focusRequest={focusRequest}
        onFocused={focusTaken}
        onPanel={showPanel}
        onStart={start}
        onPause={pause}
        onResume={resume}
        onStop={stop}
        onSkipBreak={endBreak}
        onBreak={takeBreak}
        onNext={nextBlock}
        onFinish={finish}
        onToggleMute={toggleMute}
      />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement.text}
        {announcement.count % 2 === 1 ? " " : ""}
      </div>
    </FocusLauncherContext.Provider>
  );
}
