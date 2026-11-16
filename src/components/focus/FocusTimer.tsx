"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Bell, Check, Coffee, Minus, Pause, Play, SkipForward, Square, Timer, Volume2, VolumeX, X } from "lucide-react";
import { ProgressRing } from "@/components/today/ProgressRing";
import { formatDuration } from "@/lib/agents/daily-study/present";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/interpolate";
import {
  FOCUS_PRESET_ORDER,
  elapsedMs,
  formatClock,
  isActive,
  isPaused,
  isRunning,
  presetMinutes,
  remainingMs,
  type FocusPresetId,
  type FocusTarget,
  type FocusTimerState,
} from "@/lib/study/focus-timer";
import { FOCUS_LABEL_MAX } from "@/lib/study/focus";
import { cn } from "@/lib/utils";
import { notificationState, requestNotifications } from "./alerts";

/** "open": the full panel. "closed": a small pill while a session exists, else nothing. */
export type FocusPanel = "closed" | "open";

export interface FocusTimerProps {
  state: FocusTimerState;
  panel: FocusPanel;
  /** What the next session will be about (the setup screen). */
  draft: FocusTarget;
  /** The view the student just opened or minimized: it takes keyboard focus once. */
  focusRequest: FocusPanel | null;
  onFocused: () => void;
  onPanel: (panel: FocusPanel) => void;
  onStart: (preset: FocusPresetId, label?: string) => void;
  onPause: () => void;
  onResume: () => void;
  /** Stop a focus block early. */
  onStop: () => void;
  onSkipBreak: () => void;
  onBreak: () => void;
  onNext: () => void;
  onFinish: () => void;
  onToggleMute: () => void;
}

const POSITION = "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] start-4 z-40";
const PRIMARY =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-lime px-5 text-sm font-semibold text-lime-on transition hover:bg-lime-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card";
const SECONDARY =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-line-strong px-5 text-sm font-semibold text-ink transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60";
const ICON_BUTTON =
  "grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60";

const noop = () => () => {};

/**
 * The current time while a block runs (`endsAt` set), refreshed just after
 * each displayed second changes. Display only: time left always comes from
 * the stored end.
 */
function useNow(endsAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    let id = 0;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const left = endsAt - t;
      // A timeout never fires early; one that reads the clock a hair before the
      // second changes simply ticks again 1 ms later.
      id = window.setTimeout(tick, left > 0 ? left % 1000 || 1000 : 1000);
    };
    id = window.setTimeout(tick, 0);
    return () => window.clearTimeout(id);
  }, [endsAt]);
  return now;
}

/** Move keyboard focus to `ref` once, when the student asked for this view. */
function useTakeFocus<T extends HTMLElement>(wanted: boolean, onFocused: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!wanted) return;
    ref.current?.focus();
    onFocused();
  }, [wanted, onFocused]);
  return ref;
}

/**
 * The floating focus timer: a full panel (setup, countdown, done screens) or,
 * minimized, a small pill with the time left. Sits at the bottom start corner
 * of every signed-in page, above the page but below dialogs.
 */
export function FocusTimer(props: FocusTimerProps) {
  if (props.panel !== "open" && props.state.phase === "idle") return null;
  return <TimerView {...props} />;
}

function TimerView(props: FocusTimerProps) {
  const { state, panel } = props;
  const { dict } = useI18n();
  const F = dict.focus;
  const running = isRunning(state);
  const now = useNow(running ? state.endsAt : null);
  const active = isActive(state);
  const paused = isPaused(state);
  const clock = formatClock(remainingMs(state, now));
  const heading =
    state.phase === "idle"
      ? F.setupTitle
      : state.phase === "focusDone"
        ? F.focusDoneTitle
        : state.phase === "breakDone"
          ? F.breakDoneTitle
          : paused
            ? F.paused
            : state.phase === "focus"
              ? F.phaseFocus
              : F.phaseBreak;

  if (panel === "open") return <FullPanel {...props} heading={heading} clock={clock} now={now} />;
  return <MiniPill {...props} heading={heading} clock={clock} running={running} active={active} paused={paused} />;
}

function MiniPill({
  focusRequest,
  onFocused,
  onPanel,
  onPause,
  onResume,
  heading,
  clock,
  running,
  active,
  paused,
}: FocusTimerProps & { heading: string; clock: string; running: boolean; active: boolean; paused: boolean }) {
  const { dict } = useI18n();
  const F = dict.focus;
  const expandRef = useTakeFocus<HTMLButtonElement>(focusRequest === "closed", onFocused);
  return (
    <div
      role="group"
      aria-label={F.timerLabel}
      className={cn(POSITION, "flex items-center gap-0.5 rounded-full border border-line bg-card p-1 text-ink shadow-pop")}
    >
      <button
        ref={expandRef}
        type="button"
        onClick={() => onPanel("open")}
        className="flex min-h-10 items-center gap-2 rounded-full pe-3 ps-3 text-sm font-semibold transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60"
      >
        <span
          aria-hidden
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            running ? "bg-lime motion-safe:animate-pulse" : active ? "bg-ink-faint" : "bg-lime",
          )}
        />
        <span>{heading}</span>
        {active && (
          <span dir="ltr" className="tabular-nums text-ink-soft">
            {clock}
          </span>
        )}
        <span className="sr-only">{F.expand}</span>
      </button>
      {active && (
        <button
          type="button"
          onClick={paused ? onResume : onPause}
          aria-label={paused ? F.resume : F.pause}
          className={ICON_BUTTON}
        >
          {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
        </button>
      )}
    </div>
  );
}

function FullPanel({
  state,
  draft,
  heading,
  clock,
  now,
  focusRequest,
  onFocused,
  onPanel,
  onStart,
  onPause,
  onResume,
  onStop,
  onSkipBreak,
  onBreak,
  onNext,
  onFinish,
  onToggleMute,
}: FocusTimerProps & { heading: string; clock: string; now: number }) {
  const { dict } = useI18n();
  const F = dict.focus;
  const T = dict.today;
  const headingId = useId();
  const headingRef = useTakeFocus<HTMLHeadingElement>(focusRequest === "open", onFocused);
  const active = isActive(state);
  const paused = isPaused(state);
  const target = state.phase === "idle" ? draft : state;
  const minutes = (m: number) => formatDuration(m, T);

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        POSITION,
        "w-[min(21rem,calc(100vw-2rem))] rounded-3xl border border-line bg-card p-4 text-ink shadow-pop sm:p-5",
      )}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1 pt-1.5">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-display text-xl leading-tight outline-none">
            {heading}
          </h2>
          {target.label && (
            <p dir="auto" className="mt-1 truncate text-sm font-medium text-ink">
              {target.label}
            </p>
          )}
          {target.course && (
            <p dir="auto" className="truncate text-xs text-ink-soft">
              {target.course}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={state.muted ? F.unmute : F.mute}
          className={ICON_BUTTON}
        >
          {state.muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </button>
        {active ? (
          <button type="button" onClick={() => onPanel("closed")} aria-label={F.minimize} className={ICON_BUTTON}>
            <Minus className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <button type="button" onClick={onFinish} aria-label={F.close} className={ICON_BUTTON}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {state.phase === "idle" && <Setup state={state} draft={draft} onStart={onStart} />}

      {active && (
        <div className="mt-4 flex items-center gap-4">
          <ProgressRing decorative done={elapsedMs(state, now)} total={state.durationMs} size={112}>
            <span role="timer" aria-live="off" aria-atomic="true" className="font-display text-[1.65rem] leading-none text-ink">
              <span className="sr-only">{state.phase === "focus" ? F.timerFocusAria : F.timerBreakAria}: </span>
              <span dir="ltr" className="tabular-nums">
                {clock}
              </span>
            </span>
          </ProgressRing>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {paused ? (
              <button type="button" onClick={onResume} className={PRIMARY}>
                <Play className="h-4 w-4" aria-hidden />
                {F.resume}
              </button>
            ) : (
              <button type="button" onClick={onPause} className={PRIMARY}>
                <Pause className="h-4 w-4" aria-hidden />
                {F.pause}
              </button>
            )}
            <button type="button" onClick={state.phase === "focus" ? onStop : onSkipBreak} className={SECONDARY}>
              {state.phase === "focus" ? (
                <Square className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <SkipForward className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
              )}
              {state.phase === "focus" ? F.stopEarly : F.skipBreak}
            </button>
          </div>
        </div>
      )}

      {state.phase === "focusDone" && (
        <>
          <p className="mt-3 flex items-center gap-2.5 rounded-2xl bg-matcha px-3.5 py-2.5 text-sm text-ink">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lime text-lime-on">
              <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
            </span>
            {fmt(F.focusDoneBody, { time: minutes(Math.round(state.lastFocusSeconds / 60)) })}
          </p>
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={onBreak} className={PRIMARY}>
              <Coffee className="h-4 w-4" aria-hidden />
              {fmt(F.takeBreak, { time: minutes(presetMinutes(state.preset, "break")) })}
            </button>
            <button type="button" onClick={onNext} className={SECONDARY}>
              <Timer className="h-4 w-4" aria-hidden />
              {F.anotherBlock}
            </button>
            <button
              type="button"
              onClick={onFinish}
              className="inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm font-semibold text-ink-soft transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60"
            >
              {F.finish}
            </button>
          </div>
        </>
      )}

      {state.phase === "breakDone" && (
        <>
          <p className="mt-2 text-sm text-ink-soft">{F.breakDoneBody}</p>
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={onNext} className={PRIMARY}>
              <Timer className="h-4 w-4" aria-hidden />
              {F.nextBlock}
            </button>
            <button type="button" onClick={onFinish} className={SECONDARY}>
              {F.finish}
            </button>
          </div>
        </>
      )}

      {state.phase !== "breakDone" && <NotifyOffer label={F.notifyOffer} />}
    </section>
  );
}

function Setup({
  state,
  draft,
  onStart,
}: {
  state: FocusTimerState;
  draft: FocusTarget;
  onStart: (preset: FocusPresetId, label?: string) => void;
}) {
  const { dict } = useI18n();
  const F = dict.focus;
  const T = dict.today;
  const [text, setText] = useState("");
  const inputId = useId();
  const minutes = (m: number) => formatDuration(m, T);
  const names: Record<FocusPresetId, string> = {
    classic: F.presetClassic,
    deep: F.presetDeep,
    quick: F.presetQuick,
  };

  return (
    <>
      {!draft.label && (
        <div className="mt-3">
          <label htmlFor={inputId} className="text-sm font-medium text-ink-soft">
            {F.labelField}
          </label>
          <input
            id={inputId}
            value={text}
            dir="auto"
            maxLength={FOCUS_LABEL_MAX}
            placeholder={F.labelPlaceholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onStart(state.preset, text);
              }
            }}
            className="mt-1.5 w-full rounded-full border border-line-strong bg-paper px-4 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-ink-faint focus-visible:ring-2 focus-visible:ring-lime-deep/40"
          />
        </div>
      )}
      <div role="group" aria-label={F.presetsLabel} className="mt-4 grid gap-2">
        {FOCUS_PRESET_ORDER.map((id) => {
          const focus = presetMinutes(id, "focus");
          const detail =
            id === "quick"
              ? fmt(F.presetQuickDetail, { focus: minutes(focus) })
              : fmt(F.presetDetail, { focus: minutes(focus), rest: minutes(presetMinutes(id, "break")) });
          const preferred = id === state.preset;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onStart(id, text)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60",
                preferred
                  ? "bg-lime text-lime-on hover:bg-lime-hover"
                  : "border border-line bg-paper text-ink hover:border-line-strong hover:bg-hover",
              )}
            >
              <span className="min-w-0">
                <span className="block font-semibold">{names[id]}</span>
                <span className={cn("block text-xs", preferred ? "text-lime-on/80" : "text-ink-soft")}>{detail}</span>
              </span>
              <span aria-hidden className="shrink-0 font-display text-2xl tabular-nums">
                {focus}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-ink-faint">{F.free}</p>
    </>
  );
}

/**
 * "Notify me when time's up": shown only while the browser has not been
 * asked yet. Permission is only ever requested from this click.
 */
function NotifyOffer({ label }: { label: string }) {
  const [, setAsked] = useState(0);
  const permission = useSyncExternalStore(noop, notificationState, () => "unsupported" as const);
  if (permission !== "default") return null;
  return (
    <button
      type="button"
      onClick={() => {
        void requestNotifications().then(() => setAsked((n) => n + 1));
      }}
      className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full text-xs font-semibold text-ink-soft transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60"
    >
      <Bell className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
