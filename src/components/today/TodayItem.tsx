"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  BookOpenCheck,
  Check,
  Clock3,
  FileQuestion,
  GraduationCap,
  Layers,
  ListTodo,
  NotebookPen,
} from "lucide-react";
import { fmt } from "@/lib/i18n/interpolate";
import type { DailyStudyPlanItem } from "@/lib/agents/daily-study/types";
import {
  formatDay,
  formatDuration,
  itemHref,
  itemNotes,
  itemReason,
  itemSource,
  itemTitle,
  kindLabel,
  type TodayCopy,
} from "@/lib/agents/daily-study/present";
import { cn } from "@/lib/utils";

const KIND_ICON = {
  deadline: NotebookPen,
  exam: GraduationCap,
  flashcards: Layers,
  quiz: FileQuestion,
  task: ListTodo,
} as const;

/** One plan item: checkbox, title (a deep link), time, reason, source. */
export function TodayItem({
  item,
  T,
  locale,
  onSet,
}: {
  item: DailyStudyPlanItem;
  T: TodayCopy;
  locale: string;
  onSet: (item: DailyStudyPlanItem, completed: boolean, finish?: boolean) => void;
}) {
  const title = itemTitle(item, T);
  const Icon = KIND_ICON[item.kind];
  const notes = itemNotes(item, T, locale);
  const done = item.completed;
  const canFinish = !done && item.mode === "session" && item.kind === "deadline";

  return (
    <li className={cn("flex gap-2 px-2 py-3 sm:gap-3 sm:px-4", done && "bg-surface-2/60")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={fmt(done ? T.markNotDone : T.markDone, { title })}
        onClick={() => onSet(item, !done)}
        className="group grid h-11 w-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-lime/60"
      >
        <span
          className={cn(
            "grid h-6 w-6 place-items-center rounded-full border-2 transition",
            done
              ? "border-lime bg-lime text-lime-on"
              : "border-line-strong bg-surface text-transparent group-hover:border-lime/70",
          )}
          aria-hidden
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      </button>

      <div className="min-w-0 flex-1 py-1.5 pe-2">
        {item.startHere && !done && (
          <span className="mb-1 inline-flex items-center rounded-full bg-lime-faint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-lime-deep">
            {T.startHere}
          </span>
        )}
        <Link
          href={itemHref(item)}
          aria-label={fmt(T.openAria, { title })}
          className={cn(
            "group/link flex items-start gap-1 text-[15px] font-semibold leading-6 outline-none transition hover:text-lime-deep focus-visible:underline",
            done ? "text-ink-faint line-through decoration-ink-faint/60" : "text-ink",
          )}
        >
          <span dir="auto" className="min-w-0 break-words">{title}</span>
          <ArrowUpRight
            className="mt-1 h-4 w-4 shrink-0 text-ink-faint transition group-hover/link:text-lime-deep rtl:-scale-x-100"
            aria-hidden
          />
        </Link>

        {!done && <p className="mt-0.5 text-sm leading-6 text-ink-soft">{itemReason(item, T, locale)}</p>}
        {!done && notes.length > 0 && (
          <p className="mt-0.5 text-xs leading-5 text-ink-faint">{notes.join(" ")}</p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-1 font-medium text-ink-soft">
            <Clock3 className="h-3.5 w-3.5" aria-hidden />
            {formatDuration(item.minutes, T)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {kindLabel(item, T)}
          </span>
          {item.dueDate && item.kind === "deadline" && (
            <span>{fmt(T.due, { date: formatDay(item.dueDate, locale) })}</span>
          )}
          {item.progress && item.progress.total > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <BookOpenCheck className="h-3.5 w-3.5" aria-hidden />
              {fmt(T.cardsProgress, { done: item.progress.done, total: item.progress.total })}
            </span>
          )}
          <span dir="auto" className="min-w-0 max-w-full truncate">{itemSource(item)}</span>
        </div>

        {item.mode === "study" && !done && (
          <p className="mt-1 text-[11px] text-ink-faint">{T.selfChecking}</p>
        )}
        {canFinish && (
          <button
            type="button"
            onClick={() => onSet(item, true, true)}
            aria-label={fmt(T.finishedAria, { title })}
            className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-xs font-semibold text-ink transition hover:bg-hover"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            {T.finished}
          </button>
        )}
      </div>
    </li>
  );
}
