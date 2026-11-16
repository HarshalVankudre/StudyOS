import Link from "next/link";
import { CalendarDays, GraduationCap } from "lucide-react";
import { ProgressRing } from "@/components/today/ProgressRing";
import { gradeWithPercent, targetText } from "@/components/workspace/grades/text";
import { formatGermanGrade } from "@/lib/grades/german";
import { formatGrade, formatPercent, formatPoints } from "@/lib/grades/scales";
import type { GradesOverall, GradesOverview, OverallGroup, OverviewCourse, UnsetTracker } from "@/lib/grades/overview";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import type { PluralForms } from "@/lib/i18n/plural";
import { cn } from "@/lib/utils";

export interface GradesOverviewI18n {
  dict: Dictionary;
  locale: string;
  t: (template: string, vars?: Record<string, string | number>) => string;
  plural: (forms: PluralForms, count: number, vars?: Record<string, string | number>) => string;
}

/** What a student types on a page to add a tracker (the "/" menu's English keyword works in every language). */
export const GRADES_COMMAND = "/grades";

const PILL =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-deep/60";

const FAMILY_TINT: Record<OverallGroup["family"], string> = {
  percent: "bg-matcha",
  us: "bg-cloud",
  uk: "bg-heather",
  de: "bg-oat",
};

function number(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

/** A due day as "Tue, Nov 18" in the student's language. */
function formatDue(day: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(`${day}T12:00:00Z`),
    );
  } catch {
    return day;
  }
}

/** The card's name: the course, else the tracker, else the workspace. */
export function courseTitle(course: OverviewCourse, dict: Dictionary): string {
  if (course.course !== null) return course.course || dict.db.untitled;
  return course.tracker ?? course.workspaceName;
}

/** Where the course lives, when the title alone does not say it. */
function courseContext(course: OverviewCourse): string | null {
  if (course.course !== null) return [course.workspaceName, course.tracker].filter(Boolean).join(" · ");
  return course.tracker ? course.workspaceName : null;
}

/** "You need 78% on the rest to reach B+ (87%)." and its calm siblings. */
export function standingText(course: OverviewCourse, i18n: GradesOverviewI18n): string {
  const { dict, locale, t } = i18n;
  const O = dict.gradesOverview.outlook;
  const scale = course.scale;
  const o = course.outlook;
  if (!course.hasWork) return O.empty;
  if (!o || course.target === null) return course.upcoming === 0 && course.current !== null ? O.allGraded : O.pick;
  const target = targetText(course.target, scale, locale, dict.grades, t);
  switch (o.kind) {
    case "needed":
      return t(course.decidedShare > 0 ? O.needed : O.neededNoScores, { average: formatPercent(o.average, locale), target });
    case "unreachable":
      return t(O.unreachable, { target, max: formatPercent(100, locale), best: gradeWithPercent(o.best, scale, locale) });
    case "secured":
      return t(O.secured, { target });
    case "met":
      return t(O.met, { final: gradeWithPercent(o.final, scale, locale) });
    case "missed":
      return t(O.missed, { final: gradeWithPercent(o.final, scale, locale) });
  }
}

/**
 * The grades overview body: an overall figure per grading scale when one
 * means something, then every course's card (what needs attention first),
 * trackers still to set up, or a short how-to when there is none yet. No
 * hooks, so it renders on the server.
 */
export function GradesOverviewView({ overview, i18n }: { overview: GradesOverview | null; i18n: GradesOverviewI18n }) {
  const G = i18n.dict.gradesOverview;
  const empty = overview !== null && overview.courses.length === 0 && overview.unset.length === 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-7 sm:py-12">
      <Link href="/app" className="text-sm font-medium text-ink-soft transition hover:text-ink">
        {G.back}
      </Link>

      <div className="mt-5 min-w-0">
        <h1 className="font-display text-3xl leading-tight sm:text-4xl">{G.title}</h1>
        <p className="mt-2 text-[15px] text-ink-soft">{G.subtitle}</p>
      </div>

      {overview === null ? (
        <p role="alert" className="mt-8 rounded-3xl bg-oat px-6 py-8 text-center text-[15px] text-ink">
          {G.loadFailed}
        </p>
      ) : empty ? (
        <EmptyState i18n={i18n} />
      ) : (
        <>
          {overview.overall && <Overall overall={overview.overall} i18n={i18n} />}
          {overview.courses.length > 0 && (
            <section aria-labelledby="grades-courses" className="mt-10">
              <h2 id="grades-courses" className="font-display text-2xl">
                {G.coursesTitle}
              </h2>
              <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {overview.courses.map((course) => (
                  <CourseCard key={course.id} course={course} i18n={i18n} />
                ))}
              </ul>
            </section>
          )}
          {overview.unset.length > 0 && <Unset trackers={overview.unset} i18n={i18n} />}
        </>
      )}

      {overview && !empty && <p className="mt-10 text-center text-xs text-ink-faint">{G.free}</p>}
    </div>
  );
}

/** A module of a tracker of module grades: its grade, its credits and where it stands; no percentages. */
function ModuleCard({ course, i18n }: { course: OverviewCourse; i18n: GradesOverviewI18n }) {
  const { dict, locale, t } = i18n;
  const G = dict.gradesOverview;
  const M = dict.grades.modules;
  const E = dict.tools.gradeCalculator.ects;
  const title = courseTitle(course, dict);
  const context = courseContext(course);
  const mod = course.module!;
  const status =
    mod.status === "passed"
      ? { text: M.passed, className: "bg-matcha text-ink" }
      : mod.status === "failed"
        ? { text: E.failedTag, className: "border border-red-600/30 text-red-700 dark:border-red-400/40 dark:text-red-300" }
        : mod.status === "invalid"
          ? { text: M.notAGrade, className: "bg-oat text-ink" }
          : { text: M.open, className: "border border-line-strong text-ink-soft" };

  return (
    <li className="flex min-w-0 flex-col rounded-3xl border border-line bg-card p-5 sm:p-6" data-testid="grades-overview-course">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl leading-snug text-ink">
            <bdi>{title}</bdi>
          </h3>
          {context && (
            <p className="mt-0.5 truncate text-[13px] text-ink-soft">
              {course.workspaceIcon && (
                <span aria-hidden className="me-1">
                  {course.workspaceIcon}
                </span>
              )}
              <bdi>{context}</bdi>
            </p>
          )}
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", status.className)} data-testid="grades-overview-status">
          {status.text}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="min-w-0 rounded-2xl bg-matcha px-3.5 py-3">
          <dt className="text-[13px] font-medium text-ink-soft">{E.gradeColumn}</dt>
          <dd className="mt-0.5 font-display text-2xl leading-tight tabular-nums text-ink" data-testid="grades-overview-current">
            {mod.grade === null ? "—" : formatGermanGrade(mod.grade, locale)}
          </dd>
        </div>
        <div className="min-w-0 rounded-2xl bg-oat px-3.5 py-3">
          <dt className="text-[13px] font-medium text-ink-soft">{E.ectsColumn}</dt>
          <dd className="mt-0.5 font-display text-2xl leading-tight tabular-nums text-ink" data-testid="grades-overview-credits">
            {course.credits === null ? "—" : number(course.credits, locale)}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex pt-5">
        <Link
          href={course.href}
          aria-label={t(G.openAria, { name: title })}
          className={cn(PILL, "border border-line-strong bg-paper text-ink hover:bg-hover")}
        >
          <GraduationCap className="h-4 w-4" aria-hidden />
          {G.open}
        </Link>
      </div>
    </li>
  );
}

function CourseCard({ course, i18n }: { course: OverviewCourse; i18n: GradesOverviewI18n }) {
  if (course.module) return <ModuleCard course={course} i18n={i18n} />;
  const { dict, locale, t } = i18n;
  const G = dict.gradesOverview;
  const g = dict.grades;
  const scale = course.scale;
  const title = courseTitle(course, dict);
  const context = courseContext(course);
  const decided = Math.round(Math.min(1, Math.max(0, course.decidedShare)) * 100);
  const decidedText = t(g.decided, { percent: formatPercent(decided, locale, 0) });
  const counts = t(g.scoredCount, {
    scored: number(course.graded, locale),
    total: number(course.graded + course.upcoming, locale),
  });

  return (
    <li className="flex min-w-0 flex-col rounded-3xl border border-line bg-card p-5 sm:p-6" data-testid="grades-overview-course">
      <div className="flex items-start gap-4">
        <ProgressRing
          done={decided}
          total={100}
          size={60}
          label={t(G.decidedRing, { course: title })}
          caption={decidedText}
        >
          <span aria-hidden className="text-[13px] font-semibold tabular-nums text-ink">
            {formatPercent(decided, locale, 0)}
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl leading-snug text-ink">
            <bdi>{title}</bdi>
          </h3>
          {context && (
            <p className="mt-0.5 truncate text-[13px] text-ink-soft">
              {course.workspaceIcon && (
                <span aria-hidden className="me-1">
                  {course.workspaceIcon}
                </span>
              )}
              <bdi>{context}</bdi>
            </p>
          )}
          <p className="mt-1 text-xs text-ink-faint">
            {decidedText} · {counts}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="min-w-0 rounded-2xl bg-matcha px-3.5 py-3">
          <dt className="text-[13px] font-medium text-ink-soft">{G.soFar}</dt>
          <dd className="mt-0.5 font-display text-2xl leading-tight tabular-nums text-ink" data-testid="grades-overview-current">
            {course.current === null ? "—" : formatGrade(course.current, scale, locale)}
          </dd>
          {(course.current === null || scale.display !== "percent") && (
            <dd className="text-xs tabular-nums text-ink-soft">
              {course.current === null ? g.noScores : formatPercent(course.current, locale)}
            </dd>
          )}
        </div>
        <div className="min-w-0 rounded-2xl bg-oat px-3.5 py-3">
          <dt className="text-[13px] font-medium text-ink-soft">{G.target}</dt>
          <dd className="mt-0.5 break-words font-display text-lg leading-tight text-ink" data-testid="grades-overview-target">
            {course.target === null ? G.noTarget : targetText(course.target, scale, locale, g, t)}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-[15px] leading-snug text-ink" data-testid="grades-overview-standing">
        {standingText(course, i18n)}
      </p>

      <p className="mt-2 flex items-start gap-2 text-sm text-ink-soft">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {course.next ? (
          <span className="min-w-0">
            <span className="block truncate text-ink">
              <bdi>{t(G.next, { title: course.next.title || g.untitledItem })}</bdi>
            </span>
            <span className="block text-xs">
              {t(G.nextMeta, { date: formatDue(course.next.due, locale), weight: formatPercent(course.next.weight, locale) })}
            </span>
          </span>
        ) : (
          <span>{G.nothingNext}</span>
        )}
      </p>

      <div className="mt-auto flex pt-5">
        <Link
          href={course.href}
          aria-label={t(G.openAria, { name: title })}
          className={cn(PILL, "border border-line-strong bg-paper text-ink hover:bg-hover")}
        >
          <GraduationCap className="h-4 w-4" aria-hidden />
          {G.open}
        </Link>
      </div>
    </li>
  );
}

function groupLabel(group: OverallGroup, dict: Dictionary): string {
  const G = dict.gradesOverview;
  if (group.kind === "gpa") return G.overallGpa;
  if (group.kind === "german") return G.overallGerman;
  return group.family === "uk" ? G.overallUk : G.overallAverage;
}

function scaleName(group: OverallGroup, dict: Dictionary): string {
  const P = dict.grades.presets;
  switch (group.family) {
    case "us":
      return group.letters || group.kind === "average" ? P.us_letter : P.us_gpa;
    case "uk":
      return P.uk_degree;
    case "de":
      return P.de_grade;
    default:
      return P.percent;
  }
}

function Overall({ overall, i18n }: { overall: GradesOverall; i18n: GradesOverviewI18n }) {
  const { dict, locale, t, plural } = i18n;
  const G = dict.gradesOverview;
  const g = dict.grades;
  return (
    <section aria-labelledby="grades-overall" className="mt-8">
      <h2 id="grades-overall" className="font-display text-2xl">
        {G.overallTitle}
      </h2>
      {overall.mixed && <p className="mt-1 text-sm text-ink-soft">{G.mixedScales}</p>}
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {overall.groups.map((group) => {
          const { summary } = group;
          const value =
            group.value === null
              ? null
              : group.kind === "average"
                ? formatPercent(group.value, locale)
                : formatPoints(group.value, group.scale!, locale);
          const band = group.kind === "average" && group.value !== null && group.scale ? formatGrade(group.value, group.scale, locale) : null;
          const weighting = summary.weighting === "credits" ? plural(g.creditWeighted, summary.credits) : g.equalWeighted;
          return (
            <div key={group.family} data-overall={group.family} className={cn("flex min-w-0 flex-col rounded-3xl p-5", FAMILY_TINT[group.family])}>
              <dt className="text-[13px] font-medium text-ink-soft">
                {groupLabel(group, dict)}
                {overall.mixed && <> · {scaleName(group, dict)}</>}
              </dt>
              {value !== null ? (
                <>
                  <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-display text-3xl leading-tight tabular-nums text-ink" data-testid="grades-overview-overall">
                      {value}
                    </span>
                    {band && (
                      <span className="rounded-full bg-card px-2.5 py-0.5 text-sm font-semibold text-ink">{band}</span>
                    )}
                  </dd>
                  <dd className="mt-1 text-xs leading-snug text-ink-soft">
                    {t(g.coursesCounted, { count: number(summary.counted, locale), total: number(group.courses, locale) })}
                    {" · "}
                    {weighting}
                  </dd>
                  {group.missingCredits.length > 0 && (
                    <dd className="mt-1 text-xs leading-snug text-ink-soft">
                      {t(g.missingCredits, { courses: group.missingCredits.join(", ") })}
                    </dd>
                  )}
                </>
              ) : (
                <dd className="mt-2 text-sm text-ink">{G.germanNeedsCredits}</dd>
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function Unset({ trackers, i18n }: { trackers: UnsetTracker[]; i18n: GradesOverviewI18n }) {
  const { dict } = i18n;
  const G = dict.gradesOverview;
  return (
    <section aria-labelledby="grades-unset" className="mt-10">
      <h2 id="grades-unset" className="font-display text-xl">
        {G.unsetTitle}
      </h2>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-card">
        {trackers.map((tracker) => (
          <li key={tracker.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-matcha text-lg" aria-hidden>
              {tracker.workspaceIcon ?? dict.app.fallbackIcon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">
                <bdi>{tracker.workspaceName}</bdi>
              </span>
              <span className="block text-xs text-ink-soft">{G.unsetDetail}</span>
            </span>
            <Link href={tracker.href} className={cn(PILL, "min-h-10 border border-line-strong bg-paper px-4 text-ink hover:bg-hover")}>
              {G.unsetOpen}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "On any page, type /grades and pick …" with the command kept left-to-right. */
function WithCommand({ template, vars, t }: { template: string; vars: Record<string, string>; t: GradesOverviewI18n["t"] }) {
  const [before, after = ""] = template.split("{command}");
  return (
    <>
      {t(before, vars)}
      <kbd dir="ltr" className="rounded-md border border-line-strong bg-paper px-1.5 py-0.5 font-mono text-[13px] text-ink">
        {GRADES_COMMAND}
      </kbd>
      {t(after, vars)}
    </>
  );
}

function EmptyState({ i18n }: { i18n: GradesOverviewI18n }) {
  const { dict, t } = i18n;
  const G = dict.gradesOverview;
  const step = (n: number, body: React.ReactNode) => (
    <li className="flex items-start gap-3">
      <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-matcha text-xs font-semibold tabular-nums">
        {number(n, i18n.locale)}
      </span>
      <span className="min-w-0 pt-0.5">{body}</span>
    </li>
  );
  return (
    <section aria-labelledby="grades-empty" className="mt-8 rounded-3xl bg-oat px-6 py-10 sm:px-14 sm:py-14">
      <h2 id="grades-empty" className="text-center font-display text-2xl text-ink sm:text-3xl">
        {G.emptyTitle}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-center text-[15px] text-ink-soft">{G.emptyBody}</p>
      <div className="mx-auto mt-6 max-w-md rounded-3xl bg-card p-5 sm:p-6">
        <h3 className="font-display text-lg text-ink">{G.howToTitle}</h3>
        <ol className="mt-3 flex flex-col gap-3 text-sm text-ink">
          {step(1, G.howTo1)}
          {step(2, <WithCommand template={G.howTo2} vars={{ label: dict.grades.insertLabel }} t={t} />)}
          {step(3, G.howTo3)}
        </ol>
      </div>
      <div className="mt-6 flex justify-center">
        <Link href="/app" className={cn(PILL, "bg-lime text-lime-on hover:bg-lime-hover")}>
          {G.openCourses}
        </Link>
      </div>
    </section>
  );
}
