import Link from "next/link";
import { ArrowUpRight, CalendarPlus, Check, Eye, EyeOff, Sparkles } from "lucide-react";
import { FocusItemButton, type FocusItemCopy } from "@/components/focus/FocusItemButton";
import { KIND_ICON, KIND_TINT } from "@/components/today/kind-style";
import { formatDay, formatLongDay, formatWeekday } from "@/lib/agents/daily-study/present";
import type { AgendaData } from "@/lib/agenda/agenda";
import {
  agendaHref,
  buildAgenda,
  type Agenda,
  type AgendaDay,
  type AgendaItem,
  type AgendaParams,
} from "@/lib/agenda/build";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import type { PluralForms } from "@/lib/i18n/plural";
import { cn } from "@/lib/utils";

export interface AgendaI18n {
  dict: Dictionary;
  locale: string;
  t: (template: string, vars?: Record<string, string | number>) => string;
  plural: (forms: PluralForms, count: number, vars?: Record<string, string | number>) => string;
}

const PILL =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60";

/** Anchor of a day's section (the week strip links to it). */
function dayAnchor(date: string): string {
  return `agenda-${date}`;
}

/** "09:30" (a wall-clock time as written) in the student's language. */
function formatTime(time: string, locale: string): string {
  const [h, m] = time.split(":").map(Number);
  try {
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
      new Date(Date.UTC(2000, 0, 1, h, m)),
    );
  } catch {
    return time;
  }
}

function dayNumber(day: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  } catch {
    return day.slice(8);
  }
}

function shortWeekday(day: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  } catch {
    return formatWeekday(day, locale);
  }
}

/**
 * The agenda page body: the next fourteen days at a glance, a course filter
 * and a "show done" switch (both plain links, so a view can be shared), then
 * what is overdue and every day with something on it. No hooks, so it
 * renders on the server; only the Focus buttons run in the browser.
 */
export function AgendaView({
  data,
  params,
  i18n,
}: {
  /** null: it could not be read. */
  data: AgendaData | null;
  params: AgendaParams;
  i18n: AgendaI18n;
}) {
  const { dict, plural, t } = i18n;
  const A = dict.agenda;
  const agenda = data ? buildAgenda(data.items, data.courses, data.today, params) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-7 sm:py-12">
      <Link href="/app" className="text-sm font-medium text-ink-soft transition hover:text-ink">
        {A.back}
      </Link>

      <div className="mt-5 min-w-0">
        <h1 className="font-display text-3xl leading-tight sm:text-4xl">{A.title}</h1>
        <p className="mt-2 text-[15px] text-ink-soft">
          {A.subtitle}
          {agenda && agenda.total > 0 && <span className="text-ink-faint"> · {plural(A.summary, agenda.total)}</span>}
        </p>
      </div>

      {data === null || agenda === null ? (
        <p role="alert" className="mt-8 rounded-3xl bg-oat px-6 py-8 text-center text-[15px] text-ink">
          {A.loadFailed}
        </p>
      ) : data.courses.length === 0 ? (
        <NoWorkspaces i18n={i18n} />
      ) : (
        <>
          <Filters agenda={agenda} i18n={i18n} />
          {agenda.total === 0 ? (
            <Empty agenda={agenda} i18n={i18n} />
          ) : (
            <>
              <WeekStrip days={agenda.days} today={agenda.today} i18n={i18n} />
              {agenda.overdue.length > 0 && (
                <DaySection id="agenda-overdue" heading={A.overdue} items={agenda.overdue} overdue i18n={i18n} />
              )}
              {agenda.days.map((day, i) =>
                i === 0 || day.items.length > 0 ? (
                  <DaySection
                    key={day.date}
                    id={dayAnchor(day.date)}
                    heading={i === 0 ? A.today : i === 1 ? A.tomorrow : formatLongDay(day.date, i18n.locale)}
                    date={i <= 1 ? formatLongDay(day.date, i18n.locale) : undefined}
                    items={day.items}
                    empty={A.todayEmpty}
                    i18n={i18n}
                  />
                ) : null,
              )}
            </>
          )}
          <footer className="mt-10 flex flex-col items-center gap-2 text-center text-xs text-ink-faint">
            <Link
              href="/app/settings#calendar"
              className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-ink-soft transition hover:text-ink"
            >
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
              {A.calendarLink}
            </Link>
            {data.partial && <p>{A.partial}</p>}
            <p>
              {t(dict.insights.zoneNote, { zone: data.timeZone })} {dict.today.free}
            </p>
          </footer>
        </>
      )}
    </div>
  );
}

function Filters({ agenda, i18n }: { agenda: Agenda; i18n: AgendaI18n }) {
  const A = i18n.dict.agenda;
  const pill = (active: boolean) =>
    cn(
      "inline-flex min-h-9 max-w-[16rem] items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60",
      active ? "bg-ink text-paper" : "border border-line bg-card text-ink-soft hover:text-ink",
    );
  const DoneIcon = agenda.showDone ? EyeOff : Eye;
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      {agenda.courses.length > 0 ? (
        <nav aria-label={A.filterLabel} className="min-w-0">
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link
                href={agendaHref({ course: null, showDone: agenda.showDone })}
                scroll={false}
                aria-current={agenda.course === null ? "page" : undefined}
                className={pill(agenda.course === null)}
              >
                {A.allCourses}
              </Link>
            </li>
            {agenda.courses.map((course) => {
              const active = agenda.course?.id === course.id;
              return (
                <li key={course.id} className="min-w-0">
                  <Link
                    href={agendaHref({ course: course.id, showDone: agenda.showDone })}
                    scroll={false}
                    aria-current={active ? "page" : undefined}
                    className={pill(active)}
                  >
                    {course.icon && <span aria-hidden>{course.icon}</span>}
                    <bdi className="truncate">{course.name}</bdi>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : (
        <span />
      )}
      <Link
        href={agendaHref({ course: agenda.course?.id ?? null, showDone: !agenda.showDone })}
        scroll={false}
        className={cn(PILL, "min-h-9 shrink-0 self-start border border-line-strong bg-card px-3.5 text-ink hover:bg-hover")}
      >
        <DoneIcon className="h-4 w-4" aria-hidden />
        {agenda.showDone ? A.hideDone : A.showDone}
      </Link>
    </div>
  );
}

/** Fourteen small day cells; a day with something on it jumps to its section. */
function WeekStrip({ days, today, i18n }: { days: AgendaDay[]; today: string; i18n: AgendaI18n }) {
  const { dict, locale, plural, t } = i18n;
  const A = dict.agenda;
  return (
    <nav aria-label={A.weekLabel} className="mt-6">
      <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((day) => {
          const count = day.items.length;
          const isToday = day.date === today;
          const label = t(A.dayCell, {
            day: formatLongDay(day.date, locale),
            items: count > 0 ? plural(dict.counts.items, count) : A.nothingDue,
          });
          const body = (
            <>
              <span aria-hidden className="block truncate text-[11px] font-medium leading-4">
                {shortWeekday(day.date, locale)}
              </span>
              <span aria-hidden className="block font-display text-lg leading-6 tabular-nums">
                {dayNumber(day.date, locale)}
              </span>
              <span
                aria-hidden
                className={cn(
                  "mx-auto mt-0.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-semibold tabular-nums",
                  count === 0 ? "invisible" : isToday ? "bg-paper text-ink" : "bg-matcha text-ink",
                )}
              >
                {count > 0 ? new Intl.NumberFormat(locale).format(count) : "0"}
              </span>
              <span className="sr-only">{label}</span>
            </>
          );
          const cell = cn(
            "block min-w-0 rounded-2xl px-0.5 py-2 text-center",
            isToday ? "bg-ink text-paper" : count > 0 ? "border border-line bg-card text-ink" : "text-ink-faint",
          );
          return (
            <li key={day.date} className="min-w-0">
              {count > 0 ? (
                <a
                  href={`#${dayAnchor(day.date)}`}
                  aria-current={isToday ? "date" : undefined}
                  className={cn(
                    cell,
                    "transition hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60",
                  )}
                >
                  {body}
                </a>
              ) : (
                <span className={cell} aria-current={isToday ? "date" : undefined}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function DaySection({
  id,
  heading,
  date,
  items,
  empty,
  overdue = false,
  i18n,
}: {
  id: string;
  heading: string;
  /** The full date beside "Today" / "Tomorrow". */
  date?: string;
  items: AgendaItem[];
  /** Said when the day has nothing (only Today is shown empty). */
  empty?: string;
  overdue?: boolean;
  i18n: AgendaI18n;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className="mt-8 scroll-mt-24">
      <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-2.5 font-display text-2xl text-ink">
        {heading}
        {date && <span className="font-sans text-sm font-medium text-ink-soft">{date}</span>}
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          <Sparkles className="h-4 w-4 text-ink-faint" aria-hidden />
          {empty}
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map((item) => (
            <AgendaRow key={item.id} item={item} overdue={overdue} i18n={i18n} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AgendaRow({ item, overdue, i18n }: { item: AgendaItem; overdue: boolean; i18n: AgendaI18n }) {
  const { dict, locale, t } = i18n;
  const A = dict.agenda;
  const F = dict.focus;
  const Icon = KIND_ICON[item.kind];
  const focusCopy: FocusItemCopy = {
    itemButton: F.itemButton,
    itemActive: F.itemActive,
    expand: F.expand,
    itemAria: F.itemAria,
    itemAriaNoCourse: F.itemAriaNoCourse,
  };
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-line px-4 py-3 sm:flex-row sm:items-center sm:gap-4",
        item.done ? "bg-surface" : "bg-card",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-medium text-ink",
              KIND_TINT[item.kind],
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {item.kind === "exam" ? A.kindExam : item.formality ? A.kindFormality : A.kindDeadline}
          </span>
          {item.time && (
            <span className="font-semibold tabular-nums text-ink">
              <time dateTime={`${item.date}T${item.time}`}>{formatTime(item.time, locale)}</time>
            </span>
          )}
          {overdue && (
            <span className="text-ink-soft">
              {t(A.wasDue, { date: `${formatWeekday(item.date, locale)}, ${formatDay(item.date, locale)}` })}
            </span>
          )}
          {item.done && (
            <span className="inline-flex items-center gap-1 font-medium text-ink-soft">
              <Check className="h-3.5 w-3.5" aria-hidden />
              {A.done}
            </span>
          )}
        </div>

        <Link
          href={item.href}
          aria-label={t(dict.today.openAria, { title: item.title })}
          className={cn(
            "group/link mt-1.5 flex items-start gap-1 font-display text-[17px] leading-6 outline-none transition hover:text-lime-deep focus-visible:underline",
            item.done ? "text-ink-faint line-through decoration-ink-faint/60" : "text-ink",
          )}
        >
          <span dir="auto" className="min-w-0 break-words">
            {item.title}
          </span>
          <ArrowUpRight
            className="mt-1 h-4 w-4 shrink-0 text-ink-faint transition group-hover/link:text-lime-deep rtl:-scale-x-100"
            aria-hidden
          />
        </Link>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 font-medium text-ink-soft">
            {item.workspaceIcon && <span aria-hidden>{item.workspaceIcon}</span>}
            <bdi className="truncate">{item.workspaceName}</bdi>
          </span>
          {item.subject && (
            <span dir="auto" className="min-w-0 max-w-full truncate">
              {item.subject}
            </span>
          )}
          {item.source && (
            <span dir="auto" className="min-w-0 max-w-full truncate">
              {item.source}
            </span>
          )}
        </div>
      </div>
      {!item.done && (
        <div className="shrink-0">
          <FocusItemButton
            itemKey={item.id}
            label={item.title}
            course={item.workspaceName || item.source || null}
            workspaceId={item.workspaceId}
            copy={focusCopy}
          />
        </div>
      )}
    </li>
  );
}

function Empty({ agenda, i18n }: { agenda: Agenda; i18n: AgendaI18n }) {
  const { dict, t } = i18n;
  const A = dict.agenda;
  return (
    <section className="mt-8 rounded-3xl bg-oat px-6 py-10 text-center sm:px-14 sm:py-14">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-matcha text-ink">
        <Sparkles className="h-5 w-5" aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-2xl text-ink sm:text-3xl">
        {agenda.course ? t(A.emptyCourse, { course: agenda.course.name }) : A.emptyTitle}
      </h2>
      {!agenda.course && <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-soft">{A.emptyBody}</p>}
      {agenda.course && (
        <Link
          href={agendaHref({ course: null, showDone: agenda.showDone })}
          className={cn(PILL, "mt-6 min-h-11 border border-line-strong bg-card text-ink hover:bg-hover")}
        >
          {A.showAll}
        </Link>
      )}
    </section>
  );
}

function NoWorkspaces({ i18n }: { i18n: AgendaI18n }) {
  const { dict } = i18n;
  const A = dict.agenda;
  return (
    <section className="mt-8 rounded-3xl bg-oat px-6 py-10 text-center sm:px-14 sm:py-14">
      <h2 className="font-display text-2xl text-ink sm:text-3xl">{A.noWorkspacesTitle}</h2>
      <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-soft">{A.noWorkspacesBody}</p>
      <Link href="/generate" className={cn(PILL, "mt-6 min-h-11 bg-lime px-6 text-lime-on hover:bg-lime-hover")}>
        {dict.app.emptyGenerate}
      </Link>
    </section>
  );
}
