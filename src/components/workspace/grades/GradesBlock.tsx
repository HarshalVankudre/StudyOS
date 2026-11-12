"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  FlaskConical,
  GraduationCap,
  Info,
  Layers,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Database, GradeCategory, GradesBlock as GradesBlockData, GradesColumns } from "@/lib/workspace/types";
import { completionField, isDayKey, isRowComplete } from "@/lib/workspace/view-logic";
import {
  assignRow,
  buildGradeReport,
  convertCategoryRows,
  formatGrade,
  formatPercent,
  formatPoints,
  keepCategoryRows,
  parseLocaleNumber,
  parseScoreInput,
  removeCategory,
  type CategoryResult,
  type CourseReport,
  type GradeReport,
  type ItemResult,
} from "@/lib/grades";
import { dotClass } from "@/lib/workspace/colors";
import { cn } from "@/lib/utils";
import { formatDay } from "../database/shared";
import { useWorkspace } from "../WorkspaceContext";
import { CategoryEditor } from "./CategoryEditor";
import { GradesSettings } from "./GradesSettings";
import { GradesSetup } from "./GradesSetup";
import { DraftInput } from "../editor/DraftInput";
import { ScoreInput } from "./ScoreInput";
import { TargetPicker } from "./TargetPicker";
import { noteText, outlookText, targetText } from "./text";

const SECONDARY =
  "flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover";
const CHIP =
  "flex min-h-11 items-center rounded-full border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover";

/** Rounded so 42/50*100 does not store 84.00000000000001. */
const tidy = (n: number) => Math.round(n * 10_000) / 10_000;

/** Course-wide operations on the grading scheme, from a course card. */
export interface CategoryActions {
  assign: (rowId: string, categoryId: string) => void;
  change: (id: string, patch: Partial<Pick<GradeCategory, "name" | "weight" | "dropLowest" | "expectedCount">>) => void;
  add: (courseKey: string) => void;
  remove: (id: string) => void;
}

/**
 * A live grade tracker over the workspace's list of graded work. It shows,
 * per course, the grade so far, how much of the grade is decided and what is
 * needed on the rest for a chosen target; scores are typed straight into the
 * list (one list, never a copy); "what if" tries scores without saving them.
 * A share of the grade many items have in common ("Problem sets 20%") is a
 * grading category of the list, never a row of it.
 */
export function GradesBlock({ pageId, block }: { pageId: string; block: GradesBlockData }) {
  const { workspace, update, undo } = useWorkspace();
  const { dict, t, locale, plural } = useI18n();
  const g = dict.grades;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingColumns, setEditingColumns] = useState(false);
  const [whatIfOn, setWhatIfOn] = useState(false);
  // Raw text per row id, so a half-typed "8" is not reformatted under the thumb.
  const [whatIfText, setWhatIfText] = useState<Record<string, string>>({});
  // "Fill the rest with" per course key (items still to come included).
  const [fillText, setFillText] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  // Rows just turned into categories (count), for the Undo line.
  const [converted, setConverted] = useState<number | null>(null);
  // Saving or leaving the column setup (or Escape in the settings panel)
  // removes the focused control; focus then goes back to the settings button.
  const settingsButton = useRef<HTMLButtonElement>(null);
  const refocusSettings = useRef(false);
  useEffect(() => {
    if (refocusSettings.current && settingsButton.current) {
      refocusSettings.current = false;
      settingsButton.current.focus();
    }
  });

  const parsePercents = (texts: Record<string, string>) => {
    const out: Record<string, number> = {};
    for (const [id, text] of Object.entries(texts)) {
      const n = parseLocaleNumber(text.replace(/[%٪]/g, ""));
      if (n !== null && n >= 0) out[id] = n;
    }
    return out;
  };
  const whatIf = useMemo(() => parsePercents(whatIfText), [whatIfText]);
  const whatIfFill = useMemo(() => parsePercents(fillText), [fillText]);

  const report = useMemo(
    () =>
      buildGradeReport(workspace, block, {
        whatIf: whatIfOn ? whatIf : undefined,
        whatIfFill: whatIfOn ? whatIfFill : undefined,
        ukLabels: g.uk,
      }),
    [workspace, block, whatIf, whatIfFill, whatIfOn, g.uk],
  );

  const mutateBlock = (fn: (b: GradesBlockData) => void) =>
    update((d) => {
      const b = d.pages.find((p) => p.id === pageId)?.blocks.find((x) => x.id === block.id);
      if (b?.type === "grades") fn(b);
    });

  const addScoreColumn = (db: Database): string => {
    const id = crypto.randomUUID();
    update((d) => {
      const target = d.databases.find((x) => x.id === db.id);
      target?.properties.push({ id, name: g.scoreColumnName, type: "number" });
    });
    return id;
  };

  const saveSetup = (databaseId: string, columns: GradesColumns) => {
    mutateBlock((b) => {
      if (b.databaseId !== databaseId) delete b.targets;
      b.databaseId = databaseId;
      b.columns = columns;
    });
    setEditingColumns(false);
    refocusSettings.current = true;
  };

  const needsSetup = !block.databaseId || !report || !report.columns.score;
  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-3 sm:px-4">
      <GraduationCap className="size-5 shrink-0 text-lime-deep" aria-hidden />
      <DraftInput
        value={block.title ?? ""}
        onCommit={(value) => mutateBlock((b) => void (b.title = value.slice(0, 200)))}
        maxLength={200}
        aria-label={g.titleAria}
        placeholder={g.defaultTitle}
        className="min-w-0 flex-1 rounded bg-transparent px-1 font-display text-base font-bold text-ink outline-none placeholder:text-ink-soft/40 hover:bg-hover focus:bg-hover"
      />
      {!needsSetup && !editingColumns && (
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={whatIfOn}
            onClick={() => setWhatIfOn((v) => !v)}
            className={cn(SECONDARY, whatIfOn && "border-lime bg-lime-faint text-lime-deep")}
          >
            <FlaskConical className="size-4" aria-hidden />
            {g.whatIf}
          </button>
          <button
            ref={settingsButton}
            type="button"
            aria-expanded={settingsOpen}
            aria-label={g.settings}
            title={g.settings}
            onClick={() => setSettingsOpen((v) => !v)}
            className={cn(SECONDARY, "w-11 justify-center px-0")}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );

  if (needsSetup || editingColumns) {
    return (
      <div className="my-4 overflow-hidden rounded-xl border border-line-strong bg-card shadow-card">
        {header}
        {block.databaseId && !workspace.databases.some((d) => d.id === block.databaseId) && (
          <p className="px-3 pt-3 text-sm text-ink-soft sm:px-4">{g.databaseMissing}</p>
        )}
        <GradesSetup
          workspace={workspace}
          databaseId={block.databaseId}
          columns={block.columns}
          onAddScoreColumn={addScoreColumn}
          onSave={saveSetup}
          onCancel={
            editingColumns && !needsSetup
              ? () => {
                  setEditingColumns(false);
                  refocusSettings.current = true;
                }
              : undefined
          }
        />
      </div>
    );
  }

  const r = report as GradeReport;
  const columns = r.columns;
  const categoryRowIds = new Set(r.categoryRows.map((c) => c.rowId));

  /** One edit of the list's grading scheme (found by id inside the draft). */
  const mutateDb = (fn: (db: Database) => void) =>
    update((d) => {
      const db = d.databases.find((x) => x.id === r.database.id);
      if (db) fn(db);
    });

  const categoryActions: CategoryActions = {
    assign: (rowId, categoryId) => mutateDb((db) => assignRow(db, rowId, categoryId)),
    change: (id, patch) =>
      mutateDb((db) => {
        const category = db.grading?.categories.find((c) => c.id === id);
        if (!category) return;
        for (const [key, value] of Object.entries(patch) as [keyof typeof patch, number | string | undefined][]) {
          if (value === undefined || value === 0 || value === "") delete category[key];
          else (category as unknown as Record<string, unknown>)[key] = value;
        }
        // Name and weight are required: an emptied one keeps what was there.
        if (!category.name) category.name = patch.name ?? g.categories.newName;
        if (category.weight === undefined) category.weight = 0;
      }),
    add: (courseKey) =>
      mutateDb((db) => {
        db.grading ??= { categories: [] };
        db.grading.categories.push({ id: crypto.randomUUID(), course: courseKey, name: g.categories.newName, weight: 0 });
      }),
    remove: (id) => mutateDb((db) => removeCategory(db, id)),
  };

  const convertRows = () => {
    const candidates = r.categoryRows;
    mutateDb((db) => void convertCategoryRows(db, candidates, () => crypto.randomUUID()));
    setConverted(candidates.length);
  };
  const keepRows = () => mutateDb((db) => keepCategoryRows(db, r.categoryRows.map((c) => c.rowId)));

  const commitScore = (rowId: string, text: string): boolean => {
    const parsed = parseScoreInput(text);
    if (!parsed) {
      setNotice(t(g.invalidScore, { text: text.trim() }));
      return false;
    }
    setNotice("");
    update((d) => {
      const db = d.databases.find((x) => x.id === r.database.id);
      const row = db?.rows.find((x) => x.id === rowId);
      const scoreProp = columns.score;
      if (!db || !row || !scoreProp) return;
      if (parsed.kind === "clear") {
        row.cells[scoreProp.id] = null;
        return;
      }
      let score = parsed.score;
      if (parsed.maxScore !== undefined) {
        if (columns.maxScore) row.cells[columns.maxScore.id] = parsed.maxScore;
        else score = (parsed.score / parsed.maxScore) * 100;
      }
      row.cells[scoreProp.id] = tidy(score);
      // A score means the work was handed in and graded: mark it done (not
      // a row that stands for a whole category: that is not work to do).
      const done = completionField(db);
      if (done && !categoryRowIds.has(row.id) && !isRowComplete(db, row, done)) {
        row.cells[done.property.id] = done.doneValue;
      }
    });
    return true;
  };

  const setTarget = (key: string, target: number | null) =>
    mutateBlock((b) => {
      const targets = { ...(b.targets ?? {}) };
      if (target === null) delete targets[key];
      else targets[key] = target;
      b.targets = targets;
    });

  const summary = r.summary;
  const overall =
    summary.average === null
      ? null
      : r.scale.display === "points" && summary.points !== null
        ? formatPoints(summary.points, r.scale, locale)
        : formatGrade(summary.average, r.scale, locale);
  const named = new Map(r.courses.map((c) => [c.key, c.label]));
  const graded = r.courses.filter((c) => c.key !== "");
  const hasWhatIf = Object.keys(whatIfText).length > 0 || Object.keys(fillText).length > 0;

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-line-strong bg-card shadow-card">
      {header}

      {settingsOpen && (
        <div
          onKeyDown={(e) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            e.preventDefault();
            setSettingsOpen(false);
            refocusSettings.current = true;
          }}
        >
          <GradesSettings
            scale={r.scale}
            customBands={!!block.bands?.length}
            defaultTarget={block.defaultTarget ?? null}
            onScale={(preset) =>
              mutateBlock((b) => {
                b.scale = preset;
                delete b.bands;
              })
            }
            onBands={(bands) =>
              mutateBlock((b) => {
                if (bands) b.bands = bands;
                else delete b.bands;
              })
            }
            onDefaultTarget={(target) =>
              mutateBlock((b) => {
                if (target === null) delete b.defaultTarget;
                else b.defaultTarget = target;
              })
            }
            onEditColumns={() => {
              setSettingsOpen(false);
              setEditingColumns(true);
            }}
          />
        </div>
      )}

      {r.categoryRows.length > 0 && (
        <section
          aria-label={g.cleanup.title}
          className="flex flex-col gap-2 border-b border-line bg-amber-400/10 px-3 py-3 text-sm sm:px-4"
          data-testid="grades-cleanup"
        >
          <p className="flex items-start gap-2 font-semibold text-ink">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-lime-deep" aria-hidden />
            {g.cleanup.title}
          </p>
          <p className="text-ink-soft">
            {t(g.cleanup.body, { names: r.categoryRows.map((c) => `“${c.name}”`).join(", ") })}
          </p>
          {r.categoryRows.some((c) => c.score !== null) && <p className="text-ink-soft">{g.cleanup.scoresLost}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={convertRows}
              className="flex min-h-11 items-center gap-1.5 rounded-lg bg-lime px-3 text-sm font-semibold text-lime-on transition hover:opacity-90"
            >
              <Layers className="size-4" aria-hidden />
              {g.cleanup.convert}
            </button>
            <button type="button" onClick={keepRows} className={SECONDARY}>
              {g.cleanup.keep}
            </button>
          </div>
        </section>
      )}
      {converted !== null && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-lime-faint/60 px-3 py-2 text-sm text-ink sm:px-4">
          <p role="status" className="min-w-0 flex-1">
            {plural(g.cleanup.done, converted)}
          </p>
          {undo && (
            <button
              type="button"
              onClick={() => {
                undo();
                setConverted(null);
              }}
              className={SECONDARY}
            >
              <RotateCcw className="size-4" aria-hidden />
              {g.cleanup.undo}
            </button>
          )}
          <button
            type="button"
            aria-label={g.categories.done}
            onClick={() => setConverted(null)}
            className={SECONDARY}
          >
            {g.categories.done}
          </button>
        </div>
      )}

      {whatIfOn && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-lime-faint/60 px-3 py-2 text-sm text-ink sm:px-4">
          <FlaskConical className="size-4 shrink-0 text-lime-deep" aria-hidden />
          <p className="min-w-0 flex-1">{g.whatIfOn}</p>
          {hasWhatIf && (
            <button
              type="button"
              onClick={() => {
                setWhatIfText({});
                setFillText({});
              }}
              className={SECONDARY}
            >
              <RotateCcw className="size-4" aria-hidden />
              {g.clearWhatIf}
            </button>
          )}
        </div>
      )}

      {/* Overall */}
      <section aria-label={g.overall} className="flex flex-wrap items-end gap-x-4 gap-y-1 px-3 pt-4 sm:px-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{g.overall}</p>
          <p className="font-display text-3xl font-bold tabular-nums text-ink" data-testid="grades-overall">
            {overall ?? "—"}
          </p>
        </div>
        <div className="min-w-0 flex-1 pb-1 text-xs text-ink-soft">
          {summary.average === null ? (
            <p>{g.overallNone}</p>
          ) : (
            <>
              <p>
                {r.scale.display !== "percent" && `${formatPercent(summary.average, locale)} · `}
                {t(g.coursesCounted, { count: summary.counted, total: graded.length })}
                {" · "}
                {summary.weighting === "credits" ? plural(g.creditWeighted, summary.credits) : g.equalWeighted}
              </p>
              {summary.missingCredits.length > 0 && (
                <p>
                  {t(g.missingCredits, {
                    courses: summary.missingCredits.map((k) => named.get(k) ?? k).join(", "),
                  })}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <ul className="flex flex-col gap-3 px-3 py-4 sm:px-4">
        {r.courses.map((course) => (
          <CourseCard
            key={course.key}
            course={course}
            report={r}
            block={block}
            whatIfOn={whatIfOn}
            whatIfText={whatIfText}
            fill={fillText[course.key] ?? ""}
            setFill={(text) =>
              setFillText((prev) => {
                const next = { ...prev };
                if (text.trim() === "") delete next[course.key];
                else next[course.key] = text;
                return next;
              })
            }
            setWhatIf={(id, text) =>
              setWhatIfText((prev) => {
                const next = { ...prev };
                if (text.trim() === "") delete next[id];
                else next[id] = text;
                return next;
              })
            }
            onScore={commitScore}
            onTarget={(target) => setTarget(course.key, target)}
            actions={categoryActions}
          />
        ))}
        {r.courses.length === 0 && <li className="text-sm text-ink-soft">{g.noItems}</li>}
      </ul>

      <p role="status" aria-live="polite" className="px-3 pb-3 text-xs text-ink-soft empty:hidden sm:px-4">
        {notice}
      </p>
    </div>
  );
}

/** Due date first (undated last), then name: an order a new score never changes. */
function byDue(a: ItemResult, b: ItemResult): number {
  return (a.due ?? "~").localeCompare(b.due ?? "~") || a.name.localeCompare(b.name);
}

function CourseCard({
  course,
  report,
  block,
  whatIfOn,
  whatIfText,
  fill,
  setFill,
  setWhatIf,
  onScore,
  onTarget,
  actions,
}: {
  course: CourseReport;
  report: GradeReport;
  block: GradesBlockData;
  whatIfOn: boolean;
  whatIfText: Record<string, string>;
  fill: string;
  setFill: (text: string) => void;
  setWhatIf: (id: string, text: string) => void;
  onScore: (rowId: string, text: string) => boolean;
  onTarget: (target: number | null) => void;
  actions: CategoryActions;
}) {
  const { dict, t, locale } = useI18n();
  const g = dict.grades;
  const c = g.categories;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const grade = course.grade;
  const scale = report.scale;
  const label = course.key === "" ? g.noCourse : course.label || dict.db.untitled;
  const listId = `grades-${block.id}-${course.key || "none"}`;
  const categorized = course.categories.length > 0;
  const results = grade.categories ?? [];
  const resultOf = new Map(results.map((x) => [x.id, x]));
  const nameOf = new Map(course.categories.map((x) => [x.id, x.name || c.newName]));

  const realItems = new Map(course.items.map((i) => [i.id, i]));
  const counted = categorized ? grade.items.filter((i) => i.counted) : grade.items;
  const scored = counted.filter((i) => i.percent !== null && !i.hypothetical).length;
  const uncategorized = grade.items.filter((i) => i.uncategorized).sort(byDue);
  const hasUnscored = grade.remainingCount > 0 || grade.items.some((i) => realItems.get(i.id)?.score === null);

  const ownTarget = block.targets?.[course.key];
  const defaultTarget = block.defaultTarget;
  const outlook = outlookText(grade, course.target, scale, locale, g, t);
  const hasWhatIf = grade.items.some((i) => i.hypothetical) || (whatIfOn && fill.trim() !== "");
  const fmtNum = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(n);
  const pct = (n: number, d = 1) => formatPercent(n, locale, d);
  // The uncategorised box below says it already; the other notes stay.
  const notes = grade.notes.filter((n) => !(n.code === "uncategorized" && categorized));

  // The list grouped by where each item counts, in a fixed order.
  const sections: { key: string; title: string; items: ItemResult[] }[] = categorized
    ? [
        ...course.categories.map((cat) => ({
          key: `cat-${cat.id}`,
          title: nameOf.get(cat.id) ?? "",
          items: grade.items.filter((i) => i.category === cat.id).sort(byDue),
        })),
        { key: "singles", title: c.singles, items: grade.items.filter((i) => !i.category && i.counted).sort(byDue) },
        { key: "uncategorized", title: c.notCountedSection, items: uncategorized },
        {
          key: "excluded",
          title: c.excludedSection,
          items: grade.items.filter((i) => !i.category && !i.counted && !i.uncategorized).sort(byDue),
        },
      ].filter((s) => s.items.length > 0)
    : [{ key: "all", title: "", items: [...grade.items].sort(byDue) }];

  const itemMeta = (item: ItemResult) => {
    if (categorized) {
      if (item.category) {
        return (
          <>
            <span>{t(c.inCategory, { name: nameOf.get(item.category) ?? "" })}</span>
            {item.dropped && <span className="font-semibold">{c.droppedItem}</span>}
          </>
        );
      }
      if (item.uncategorized) {
        return <span className="font-semibold text-amber-300 [.light_&]:text-amber-700">{c.uncategorized}</span>;
      }
    }
    return item.counted ? (
      <span>{t(g.weightOf, { weight: pct((item.weight / grade.totalWeight) * 100) })}</span>
    ) : (
      <span>{g.notCounted}</span>
    );
  };

  return (
    <li className="rounded-lg border border-line bg-paper/40" data-testid="grades-course">
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 font-semibold text-ink">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", dotClass(course.color))} />
              <span dir="auto" className="truncate">{label}</span>
              {hasWhatIf && (
                <span className="rounded-full bg-lime-faint px-2 py-0.5 text-[11px] font-semibold text-lime-deep">
                  {g.whatIfBadge}
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-ink-soft">
              {t(g.decided, { percent: pct(grade.decidedShare * 100, 0) })}
              {" · "}
              {t(g.scoredCount, { scored, total: counted.length })}
            </p>
          </div>
          <div className="text-end">
            <p className="font-display text-2xl font-bold tabular-nums text-ink" data-testid="grades-current">
              {grade.current === null ? "—" : formatGrade(grade.current, scale, locale)}
            </p>
            {grade.current !== null && scale.display !== "percent" && (
              <p className="text-xs tabular-nums text-ink-soft">{pct(grade.current)}</p>
            )}
            {grade.current === null && <p className="text-xs text-ink-soft">{g.noScores}</p>}
          </div>
        </div>

        {/* How much of the grade is decided */}
        <div
          role="progressbar"
          aria-label={t(g.decided, { percent: pct(grade.decidedShare * 100, 0) })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(grade.decidedShare * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-hover"
        >
          <div className="h-full rounded-full bg-lime" style={{ width: `${Math.min(100, grade.decidedShare * 100)}%` }} />
        </div>

        {categorized && !editing && (
          <section aria-label={c.title} className="flex flex-col gap-2" data-testid="grades-breakdown">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{c.title}</h4>
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
              {course.categories.map((cat) => {
                const res = resultOf.get(cat.id);
                return res ? (
                  <CategoryLine key={cat.id} result={res} name={nameOf.get(cat.id) ?? ""} onCount={(n) => actions.change(cat.id, { expectedCount: n ?? undefined })} />
                ) : null;
              })}
              {grade.items
                .filter((i) => i.counted && !i.category)
                .sort(byDue)
                .map((item) => (
                  <li key={item.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block break-words text-ink">{item.name || g.untitledItem}</span>
                      <span className="block text-xs text-ink-soft">{t(c.weight, { weight: pct(item.weight) })}</span>
                    </span>
                    <span className="shrink-0 text-end font-semibold tabular-nums text-ink">
                      {item.percent === null ? "—" : pct(item.percent)}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {categorized && uncategorized.length > 0 && !editing && (
          <section
            aria-label={c.notCountedSection}
            className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-400/10 p-3"
            data-testid="grades-uncategorized"
          >
            <p className="text-sm font-semibold text-ink">{t(g.notes.uncategorized, { count: uncategorized.length })}</p>
            <ul className="flex flex-col gap-3">
              {uncategorized.map((item) => {
                const name = item.name || g.untitledItem;
                return (
                  <li key={item.id} className="flex flex-col gap-1.5">
                    <p dir="auto" className="text-sm text-ink">
                      {name}
                      {item.due && isDayKey(item.due) && (
                        <span className="ms-2 text-xs text-ink-soft">{formatDay(item.due, locale, { month: "short", day: "numeric" })}</span>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {course.categories.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          aria-label={t(c.assignAria, { item: name, category: nameOf.get(cat.id) ?? "" })}
                          onClick={() => actions.assign(item.id, cat.id)}
                          className={CHIP}
                        >
                          {nameOf.get(cat.id)}
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-label={t(c.excludeAria, { item: name })}
                        onClick={() => actions.assign(item.id, "")}
                        className={cn(CHIP, "text-ink-soft")}
                      >
                        {c.exclude}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {editing && (
          <CategoryEditor
            categories={course.categories}
            onChange={(id, patch) => actions.change(id, patch)}
            onAdd={() => actions.add(course.key)}
            onRemove={actions.remove}
            onDone={() => setEditing(false)}
          />
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm font-semibold text-ink">{g.target}</span>
          <TargetPicker
            scale={scale}
            value={ownTarget ?? null}
            label={t(g.targetAria, { course: label })}
            inheritedLabel={
              defaultTarget !== undefined
                ? t(g.defaultTargetOption, { target: targetText(defaultTarget, scale, locale, g, t) })
                : undefined
            }
            onChange={onTarget}
          />
        </div>
        {outlook && (
          <p
            className={cn(
              "text-sm",
              course.risk === "critical"
                ? "text-red-300 [.light_&]:text-red-700"
                : course.risk === "safe"
                  ? "text-emerald-300 [.light_&]:text-emerald-700"
                  : "text-ink",
            )}
            data-testid="grades-outlook"
          >
            {outlook}
          </p>
        )}
        {notes.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-ink-soft">
            {notes.map((note) => (
              <li key={note.code} className="flex gap-1.5">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{noteText(note, locale, g, t)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
            className={cn(SECONDARY, "w-fit")}
          >
            {open ? g.hideScores : t(g.showScores, { count: grade.items.length })}
            <ChevronDown className={cn("size-4 transition", open && "rotate-180")} aria-hidden />
          </button>
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} className={cn(SECONDARY, "w-fit")}>
              <Layers className="size-4" aria-hidden />
              {categorized ? c.edit : c.add}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div id={listId} className="border-t border-line">
          {whatIfOn && hasUnscored && (
            <label className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm text-ink-soft">
              <span>{g.fillRest}</span>
              <span className="flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={fill}
                  aria-label={t(g.fillRestAria, { course: label })}
                  onChange={(e) => setFill(e.target.value)}
                  className="h-11 w-20 rounded-lg border border-dashed border-lime bg-paper px-2 text-end font-mono text-sm text-ink outline-none focus:ring-2 focus:ring-lime/30"
                />
                %
              </span>
            </label>
          )}
          {sections.map((section) => (
            <div key={section.key}>
              {section.title && (
                <p className="border-b border-line bg-hover/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  {section.title}
                </p>
              )}
              <ul className="divide-y divide-line">
                {section.items.map((item) => {
                  const real = realItems.get(item.id);
                  const isUnscored = real?.score === null;
                  const name = item.name || g.untitledItem;
                  return (
                    <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p dir="auto" className="truncate text-sm text-ink">{name}</p>
                        <p className="flex flex-wrap gap-x-2 text-xs text-ink-soft">
                          {itemMeta(item)}
                          {item.due && isDayKey(item.due) && (
                            <span>{formatDay(item.due, locale, { month: "short", day: "numeric" })}</span>
                          )}
                          {isUnscored && real?.done && (
                            <span className="font-semibold text-amber-300 [.light_&]:text-amber-700">{g.doneNoScore}</span>
                          )}
                        </p>
                      </div>
                      {whatIfOn && isUnscored ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={whatIfText[item.id] ?? ""}
                            placeholder="—"
                            aria-label={t(g.whatIfAria, { item: name })}
                            onChange={(e) => setWhatIf(item.id, e.target.value)}
                            className="h-11 w-20 rounded-lg border border-dashed border-lime bg-paper px-2 text-end font-mono text-sm text-ink outline-none focus:ring-2 focus:ring-lime/30"
                          />
                          <span className="text-sm text-ink-soft">%</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <ScoreInput
                            value={real?.score === null || real?.score === undefined ? "" : fmtNum(real.score)}
                            placeholder="—"
                            label={t(g.scoreAria, { item: name })}
                            onCommit={(text) => onScore(item.id, text)}
                          />
                          <span className="w-12 text-sm text-ink-soft">
                            {real?.maxScore !== null && real?.maxScore !== undefined ? `/ ${fmtNum(real.maxScore)}` : "%"}
                          </span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/** One category: weight, average so far, how many are scored, and the count it assumes. */
function CategoryLine({
  result,
  name,
  onCount,
}: {
  result: CategoryResult;
  name: string;
  onCount: (count: number | null) => void;
}) {
  const { dict, t, locale } = useI18n();
  const c = dict.grades.categories;
  const pct = (n: number) => formatPercent(n, locale);
  return (
    <li className="flex items-start gap-3 px-3 py-2" data-testid="grades-category">
      <div className="min-w-0 flex-1">
        <p dir="auto" className="break-words text-sm font-semibold text-ink">{name}</p>
        <p className="flex flex-wrap gap-x-2 text-xs text-ink-soft">
          <span>{t(c.weight, { weight: pct(result.weight) })}</span>
          <span aria-hidden>·</span>
          <span>{t(c.scored, { scored: result.scored, count: result.count })}</span>
          {result.dropLowest > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{t(c.dropped, { count: result.dropLowest })}</span>
            </>
          )}
        </p>
        {result.countAssumed && (
          <p className="mt-1 text-xs text-ink-soft" data-testid="grades-count-assumed">
            {result.listed > 0 ? t(c.countAssumed, { count: result.count }) : c.countEmpty}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums text-ink" data-testid="grades-category-average">
          {result.percent === null ? "—" : pct(result.percent)}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          <span>{c.countLabel}</span>
          <ScoreInput
            value={result.countAssumed ? "" : String(result.count)}
            placeholder={String(result.count)}
            label={t(c.countAria, { name })}
            className="w-14"
            onCommit={(text) => {
              const trimmed = text.trim();
              if (trimmed === "") {
                onCount(null);
                return true;
              }
              const n = parseLocaleNumber(trimmed);
              if (n === null || !Number.isInteger(n) || n < 1 || n > 200) return false;
              onCount(n);
              return true;
            }}
          />
        </label>
      </div>
    </li>
  );
}
