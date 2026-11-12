"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FlaskConical, GraduationCap, Info, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Database, GradesBlock as GradesBlockData, GradesColumns } from "@/lib/workspace/types";
import { completionField, isDayKey, isRowComplete } from "@/lib/workspace/view-logic";
import {
  buildGradeReport,
  formatGrade,
  formatPercent,
  formatPoints,
  parseLocaleNumber,
  parseScoreInput,
  type CourseReport,
  type GradeReport,
  type ItemResult,
} from "@/lib/grades";
import { dotClass } from "@/lib/workspace/colors";
import { cn } from "@/lib/utils";
import { formatDay } from "../database/shared";
import { useWorkspace } from "../WorkspaceContext";
import { GradesSettings } from "./GradesSettings";
import { GradesSetup } from "./GradesSetup";
import { ScoreInput } from "./ScoreInput";
import { TargetPicker } from "./TargetPicker";
import { noteText, outlookText, targetText } from "./text";

const SECONDARY =
  "flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover";

/** Rounded so 42/50*100 does not store 84.00000000000001. */
const tidy = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * A live grade tracker over the workspace's list of graded work. It shows,
 * per course, the grade so far, how much of the grade is decided and what is
 * needed on the rest for a chosen target; scores are typed straight into the
 * list (one list, never a copy); "what if" tries scores without saving them.
 */
export function GradesBlock({ pageId, block }: { pageId: string; block: GradesBlockData }) {
  const { workspace, update } = useWorkspace();
  const { dict, t, locale } = useI18n();
  const g = dict.grades;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingColumns, setEditingColumns] = useState(false);
  const [whatIfOn, setWhatIfOn] = useState(false);
  // Raw text per row id, so a half-typed "8" is not reformatted under the thumb.
  const [whatIfText, setWhatIfText] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
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

  const whatIf = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, text] of Object.entries(whatIfText)) {
      const n = parseLocaleNumber(text.replace(/[%٪]/g, ""));
      if (n !== null && n >= 0) out[id] = n;
    }
    return out;
  }, [whatIfText]);

  const report = useMemo(
    () => buildGradeReport(workspace, block, { whatIf: whatIfOn ? whatIf : undefined, ukLabels: g.uk }),
    [workspace, block, whatIf, whatIfOn, g.uk],
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
      <input
        value={block.title ?? ""}
        onChange={(e) => mutateBlock((b) => void (b.title = e.target.value.slice(0, 200)))}
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
      // A score means the work was handed in and graded: mark it done.
      const done = completionField(db);
      if (done && !isRowComplete(db, row, done)) row.cells[done.property.id] = done.doneValue;
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

      {whatIfOn && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-lime-faint/60 px-3 py-2 text-sm text-ink sm:px-4">
          <FlaskConical className="size-4 shrink-0 text-lime-deep" aria-hidden />
          <p className="min-w-0 flex-1">{g.whatIfOn}</p>
          {Object.keys(whatIfText).length > 0 && (
            <button type="button" onClick={() => setWhatIfText({})} className={SECONDARY}>
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
                {summary.weighting === "credits" ? t(g.creditWeighted, { credits: summary.credits }) : g.equalWeighted}
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
            setWhatIf={(ids, text) =>
              setWhatIfText((prev) => {
                const next = { ...prev };
                for (const id of ids) {
                  if (text.trim() === "") delete next[id];
                  else next[id] = text;
                }
                return next;
              })
            }
            onScore={commitScore}
            onTarget={(target) => setTarget(course.key, target)}
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

function CourseCard({
  course,
  report,
  block,
  whatIfOn,
  whatIfText,
  setWhatIf,
  onScore,
  onTarget,
}: {
  course: CourseReport;
  report: GradeReport;
  block: GradesBlockData;
  whatIfOn: boolean;
  whatIfText: Record<string, string>;
  setWhatIf: (ids: string[], text: string) => void;
  onScore: (rowId: string, text: string) => boolean;
  onTarget: (target: number | null) => void;
}) {
  const { dict, t, locale } = useI18n();
  const g = dict.grades;
  const [open, setOpen] = useState(false);
  const [fill, setFill] = useState("");
  const grade = course.grade;
  const scale = report.scale;
  const label = course.key === "" ? g.noCourse : course.label || dict.db.untitled;
  const listId = `grades-${block.id}-${course.key || "none"}`;

  const realItems = new Map(course.items.map((i) => [i.id, i]));
  const scored = grade.items.filter((i) => i.percent !== null && !i.hypothetical).length;
  const unscored = grade.items.filter((i) => realItems.get(i.id)?.score === null);
  // What needs a score first: done-but-unscored, then by due date; graded last.
  const ordered = [...grade.items].sort((a, b) => rank(a, realItems) - rank(b, realItems) || (a.due ?? "~").localeCompare(b.due ?? "~"));

  const current = grade.current;
  const ownTarget = block.targets?.[course.key];
  const defaultTarget = block.defaultTarget;
  const outlook = outlookText(grade, course.target, scale, locale, g, t);
  const hasWhatIf = grade.items.some((i) => i.hypothetical);
  const fmtNum = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(n);

  return (
    <li className="rounded-lg border border-line bg-paper/40" data-testid="grades-course">
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 font-semibold text-ink">
              <span
                aria-hidden
                className={cn("size-2.5 shrink-0 rounded-full", dotClass(course.color))}
              />
              <span dir="auto" className="truncate">{label}</span>
              {hasWhatIf && (
                <span className="rounded-full bg-lime-faint px-2 py-0.5 text-[11px] font-semibold text-lime-deep">
                  {g.whatIfBadge}
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-ink-soft">
              {t(g.decided, { percent: formatPercent(grade.decidedShare * 100, locale, 0) })}
              {" · "}
              {t(g.scoredCount, { scored, total: grade.items.length })}
            </p>
          </div>
          <div className="text-end">
            <p className="font-display text-2xl font-bold tabular-nums text-ink" data-testid="grades-current">
              {current === null ? "—" : formatGrade(current, scale, locale)}
            </p>
            {current !== null && scale.display !== "percent" && (
              <p className="text-xs tabular-nums text-ink-soft">{formatPercent(current, locale)}</p>
            )}
            {current === null && <p className="text-xs text-ink-soft">{g.noScores}</p>}
          </div>
        </div>

        {/* How much of the grade is decided */}
        <div
          role="progressbar"
          aria-label={t(g.decided, { percent: formatPercent(grade.decidedShare * 100, locale, 0) })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(grade.decidedShare * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-hover"
        >
          <div className="h-full rounded-full bg-lime" style={{ width: `${Math.min(100, grade.decidedShare * 100)}%` }} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm font-semibold text-ink">{g.target}</span>
          <TargetPicker
            scale={scale}
            value={ownTarget ?? null}
            label={t(g.targetAria, { course: label })}
            inheritedLabel={
              defaultTarget !== undefined ? t(g.defaultTargetOption, { target: targetText(defaultTarget, scale, locale) }) : undefined
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
        {grade.notes.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-ink-soft">
            {grade.notes.map((note) => (
              <li key={note.code} className="flex gap-1.5">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{noteText(note, locale, g, t)}</span>
              </li>
            ))}
          </ul>
        )}

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
      </div>

      {open && (
        <div id={listId} className="border-t border-line">
          {whatIfOn && unscored.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm text-ink-soft">
              <span>{g.fillRest}</span>
              <span className="flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={fill}
                  aria-label={t(g.fillRestAria, { course: label })}
                  onChange={(e) => {
                    setFill(e.target.value);
                    setWhatIf(
                      unscored.map((i) => i.id),
                      e.target.value,
                    );
                  }}
                  className="h-11 w-20 rounded-lg border border-dashed border-lime bg-paper px-2 text-end font-mono text-sm text-ink outline-none focus:ring-2 focus:ring-lime/30"
                />
                %
              </span>
            </label>
          )}
          <ul className="divide-y divide-line">
            {ordered.map((item) => {
              const real = realItems.get(item.id);
              const isUnscored = real?.score === null;
              const name = item.name || g.untitledItem;
              return (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-sm text-ink">{name}</p>
                    <p className="flex flex-wrap gap-x-2 text-xs text-ink-soft">
                      {item.counted ? (
                        <span>{t(g.weightOf, { weight: formatPercent((item.weight / grade.totalWeight) * 100, locale) })}</span>
                      ) : (
                        <span>{g.notCounted}</span>
                      )}
                      {item.due && isDayKey(item.due) && (
                        <span>{formatDay(item.due, locale, { month: "short", day: "numeric" })}</span>
                      )}
                      {isUnscored && real?.done && <span className="font-semibold text-amber-300 [.light_&]:text-amber-700">{g.doneNoScore}</span>}
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
                        onChange={(e) => setWhatIf([item.id], e.target.value)}
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
      )}
    </li>
  );
}

function rank(item: ItemResult, real: Map<string, { score: number | null; done?: boolean }>): number {
  const r = real.get(item.id);
  if (r?.score === null) return r.done ? 0 : 1;
  return 2;
}
