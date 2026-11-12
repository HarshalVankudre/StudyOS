"use client";

import { Check, ListChecks, X } from "lucide-react";
import Link from "next/link";
import { Popover } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, OPEN_STUDY_HUB_EVENT, SHOW_GETTING_STARTED_EVENT } from "@/components/command/events";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { STUDIED_EVENT } from "@/components/workspace/study/useReviewRecorder";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import {
  getOnboardingStateAction,
  markOnboardingItemAction,
  setOnboardingDismissedAction,
} from "./actions";
import {
  CHECKLIST_ITEMS,
  baselineOf,
  sessionProgress,
  type ChecklistItem,
  type OnboardingState,
} from "./checklist";

const SEEN_KEY = "studyos:getting-started-seen";

function seenBefore(): boolean {
  try {
    if (localStorage.getItem(SEEN_KEY)) return true;
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage unavailable: treat as seen so the panel never pops up uninvited twice.
    return true;
  }
  return false;
}

/**
 * The student came in through a link to a particular page, block or row (the
 * Today plan, search, a shared link): they came to see that, not the guide.
 */
function arrivedByDeepLink(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.has("page") || params.has("block") || params.has("row");
  } catch {
    return false;
  }
}

const GUIDE_ATTR = "data-getting-started";

/** Dialogs other than this guide that are showing (a row's details, a study session, ...). */
function openDialogs(): HTMLElement[] {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  return Array.from(dialogs).filter(
    (el) => !el.closest(`[${GUIDE_ATTR}]`) && el.getAttribute("data-state") !== "closed" && !el.closest("[hidden]"),
  );
}

const otherDialogOpen = () => openDialogs().length > 0;

/**
 * The first-run checklist, as a small progress button in the workspace
 * header that opens a non-modal panel. Items tick themselves as the student
 * does them; "Hide this guide" hides it on every device (it can be brought
 * back from the palette). It opens by itself once, on a large screen only,
 * and never covers the page on a phone unless tapped. It never opens by
 * itself when the student arrived through a deep link, and it steps aside
 * whenever a dialog opens, so it never sits on top of one.
 */
export function GettingStarted({ onAskAi }: { onAskAi: () => void }) {
  const { dict, t } = useI18n();
  const G = dict.gettingStarted;
  const { workspace, agentBusy } = useWorkspace();
  const [server, setServer] = useState<OnboardingState | null>(null);
  const [open, setOpen] = useState(false);
  // Finished before this visit: nothing to show.
  const [hiddenForGood, setHiddenForGood] = useState(false);
  const [baseline] = useState(() => baselineOf(workspace));
  const recorded = useRef(new Set<ChecklistItem>());

  const refresh = useCallback(async () => {
    const state = await getOnboardingStateAction().catch(() => null);
    if (state) setServer(state);
    return state;
  }, []);

  // First load; open by itself the very first time on a large screen.
  useEffect(() => {
    let active = true;
    // Read now: the editor rewrites the URL once the linked target is shown.
    const linked = arrivedByDeepLink();
    getOnboardingStateAction()
      .catch(() => null)
      .then((state) => {
        if (!active || !state) return;
        setServer(state);
        if (state.done.length === CHECKLIST_ITEMS.length) setHiddenForGood(true);
        else if (
          !state.dismissed &&
          !linked &&
          window.matchMedia?.("(min-width: 1024px)").matches &&
          !otherDialogOpen() &&
          // Last: this records the one automatic opening as used.
          !seenBefore()
        ) {
          setOpen(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Never sit on top of a dialog: step aside as soon as one opens.
  useEffect(() => {
    if (!open) return;
    // A dialog already showing when the guide was asked for (the palette it
    // was opened from, closing) is not one it would cover.
    const before = new Set(openDialogs());
    const check = () => {
      if (openDialogs().some((el) => !before.has(el))) setOpen(false);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "role"],
    });
    return () => observer.disconnect();
  }, [open]);

  // Studying and agent runs are recorded on the server: re-read afterwards.
  const wasBusy = useRef(agentBusy);
  useEffect(() => {
    if (wasBusy.current && !agentBusy) void refresh();
    wasBusy.current = agentBusy;
  }, [agentBusy, refresh]);
  useEffect(() => {
    const onStudied = () => void refresh();
    window.addEventListener(STUDIED_EVENT, onStudied);
    return () => window.removeEventListener(STUDIED_EVENT, onStudied);
  }, [refresh]);

  // Bring the guide back from the palette.
  useEffect(() => {
    const onShow = () => {
      setHiddenForGood(false);
      setServer((s) => (s ? { ...s, dismissed: false } : s));
      setOpen(true);
      void setOnboardingDismissedAction(false);
    };
    window.addEventListener(SHOW_GETTING_STARTED_EVENT, onShow);
    return () => window.removeEventListener(SHOW_GETTING_STARTED_EVENT, onShow);
  }, []);

  // What the student just did in this workspace counts immediately.
  const local = useMemo(() => sessionProgress(workspace, baseline), [workspace, baseline]);
  useEffect(() => {
    for (const item of local) {
      if (server?.done.includes(item) || recorded.current.has(item)) continue;
      recorded.current.add(item);
      void markOnboardingItemAction(item);
    }
  }, [local, server]);

  if (!server || server.dismissed || hiddenForGood) return null;

  const done = new Set<ChecklistItem>([...server.done, ...local]);
  const count = CHECKLIST_ITEMS.filter((i) => done.has(i)).length;
  const total = CHECKLIST_ITEMS.length;
  const allDone = count === total;
  const hasCards = workspace.pages.some((p) => p.blocks.some((b) => b.type === "flashcards"));

  const dismiss = () => {
    setOpen(false);
    setServer({ ...server, dismissed: true });
    void setOnboardingDismissedAction(true);
  };

  const onOpenChange = (next: boolean) => {
    // Closing a finished checklist retires it.
    if (!next && allDone) dismiss();
    else setOpen(next);
  };

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const actionFor = (item: ChecklistItem): React.ReactNode => {
    const cls =
      "mt-1.5 inline-flex min-h-11 items-center rounded-md border border-line-strong bg-card px-3 text-xs font-semibold text-ink transition hover:bg-hover sm:min-h-8";
    switch (item) {
      case "askAi":
        return <button type="button" className={cls} onClick={run(onAskAi)}>{G.items.askAi.action}</button>;
      case "deadlines":
        return <button type="button" className={cls} onClick={run(onAskAi)}>{G.items.deadlines.action}</button>;
      case "study":
        return hasCards ? (
          <button type="button" className={cls} onClick={run(() => emit(OPEN_STUDY_HUB_EVENT))}>
            {G.items.study.action}
          </button>
        ) : null;
      case "calendar":
        return (
          <Link href="/app/settings" className={cls} onClick={() => setOpen(false)}>
            {G.items.calendar.action}
          </Link>
        );
      default:
        return null;
    }
  };

  const progressText = t(G.progress, { done: count, total });
  const pct = Math.round((count / total) * 100);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={`${G.button} · ${progressText}`}
        title={G.button}
        data-print="hide"
        className={cn(
          "flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold text-ink-soft transition hover:bg-hover hover:text-ink sm:min-h-9",
          // Phones: the guide is opened from the header's "More actions" menu.
          // The trigger stays in the layout (invisible, not focusable) under
          // that menu button, so the guide opens just below it.
          "max-sm:invisible max-sm:absolute max-sm:end-3 max-sm:top-full max-sm:h-0 max-sm:min-h-0 max-sm:w-11 max-sm:min-w-0 max-sm:overflow-hidden max-sm:p-0",
          open && "bg-hover text-ink",
        )}
      >
        <span className="relative grid h-5 w-5 place-items-center" aria-hidden>
          <svg viewBox="0 0 20 20" className="absolute inset-0 -rotate-90">
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--line-strong)" strokeWidth="2.5" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 50.27} 50.27`}
            />
          </svg>
          {allDone && <Check className="h-3 w-3 text-lime" />}
        </span>
        <span className="hidden xl:inline">{G.button}</span>
        <span className="font-mono text-[11px] text-ink-faint" dir="ltr">
          {count}/{total}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Opened from a menu (the phone header's "More actions"), focus
          // returns to that menu's button just after: that must not close
          // the guide. A tap or click outside still does.
          onFocusOutside={(e) => e.preventDefault()}
          aria-label={G.title}
          {...{ [GUIDE_ATTR]: "" }}
          className="z-50 w-[min(22rem,calc(100vw-1rem))] rounded-xl border border-line-strong bg-card p-4 text-ink shadow-pop outline-none"
        >
          <div className="flex items-start gap-2">
            <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-lime" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-bold leading-tight">{G.title}</h2>
              <p className="mt-0.5 text-xs text-ink-soft">{allDone ? G.allDone : G.subtitle}</p>
            </div>
            <Popover.Close
              aria-label={G.close}
              className="-me-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden />
            </Popover.Close>
          </div>

          <div
            role="progressbar"
            aria-label={G.button}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={count}
            aria-valuetext={progressText}
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-hover"
          >
            <div className="h-full rounded-full bg-lime transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>

          <ul className="mt-3 space-y-2.5">
            {CHECKLIST_ITEMS.map((item) => {
              const isDone = done.has(item);
              const copy = G.items[item];
              return (
                <li key={item} className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                      isDone ? "border-lime bg-lime text-lime-on" : "border-line-strong",
                    )}
                  >
                    {isDone && <Check className="h-3 w-3" aria-hidden />}
                    <span className="sr-only">{isDone ? G.done : G.notDone}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-medium", isDone && "text-ink-soft line-through decoration-ink-faint")}>
                      {copy.title}
                    </p>
                    {!isDone && (
                      <>
                        <p className="text-xs text-ink-soft">{copy.hint}</p>
                        {actionFor(item)}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <span className="text-[11px] text-ink-faint">{G.dismissHint}</span>
            <button
              type="button"
              onClick={dismiss}
              className="min-h-11 rounded-md px-2 text-xs font-semibold text-ink-soft transition hover:bg-hover hover:text-ink sm:min-h-8"
            >
              {G.dismiss}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
