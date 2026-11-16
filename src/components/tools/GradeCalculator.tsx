"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Info, Link2, Plus, X } from "lucide-react";
import {
  germanNeededValue,
  germanOutlookText,
  gradeWithPercent,
  noteText,
  outlookText,
} from "@/components/workspace/grades/text";
import { parseLocaleNumber } from "@/lib/grades/calc";
import { formatGermanGrade } from "@/lib/grades/german";
import { bandName, formatGrade, formatPercent, GRADE_SCALE_PRESETS, resolveScale, targetChoices } from "@/lib/grades/scales";
import { useI18n } from "@/lib/i18n/client";
import {
  activeRows,
  calculate,
  calculateModules,
  decodeState,
  defaultModeFor,
  emptyRows,
  encodeState,
  exampleModules,
  exampleState,
  initialState,
  isBlankRow,
  MAX_NAME_LENGTH,
  MAX_NUMBER_LENGTH,
  MAX_ROWS,
  MAX_SCORE_LENGTH,
  nextRowId,
  type CalcMode,
  type CalcResult,
  type CalcRow,
  type CalcState,
  type ModulesResult,
} from "@/lib/tools/grade-calculator";
import type { GradeScalePreset } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

/** How long the address waits for typing to pause before it is rewritten (browsers throttle rapid rewrites). */
export const URL_WRITE_DELAY_MS = 400;

const FIELD =
  "h-11 w-full min-w-0 rounded-xl border border-line-strong bg-paper px-3 text-[15px] text-ink outline-none transition placeholder:text-ink-faint focus:border-lime-deep aria-invalid:border-red-600 dark:aria-invalid:border-red-400";
const PILL =
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-[15px] font-semibold transition";
const PILL_PRIMARY = `${PILL} bg-lime text-lime-on hover:bg-lime-hover`;
const PILL_SECONDARY = `${PILL} border border-line-strong bg-card text-ink hover:bg-hover`;
const ERROR = "text-sm text-red-700 dark:text-red-300";
/** A result tile: label on top, value and its note at the bottom, so values line up when a label wraps. */
const TILE = "flex min-w-0 flex-col rounded-2xl bg-card p-4";
const TILE_LABEL = "text-sm text-ink-soft";
const TILE_VALUE = "mt-auto pt-1 font-display text-3xl leading-tight break-words text-ink tabular-nums sm:text-4xl";
const TILE_SUB = "mt-0.5 text-sm text-ink-soft tabular-nums";
/** Columns of a row: name, the number, the score or grade, remove. Narrower numbers for modules. */
const ROW_GRID = {
  course: "sm:grid-cols-[minmax(0,1fr)_6.5rem_7.5rem_2.75rem]",
  ects: "sm:grid-cols-[minmax(0,1fr)_5.5rem_6rem_2.75rem]",
} as const;
const NBSP = " ";

// ---------------------------------------------------------------------------
// The address fragment the page was opened with
// ---------------------------------------------------------------------------
//
// The calculator writes its state into the fragment as the student types
// (history.replaceState, which fires no event). It reads the fragment only
// when the page opens and when something else changes it (a pasted link, Back
// to an earlier visit): `generation` counts those, and the snapshot is the
// fragment as it was then, so the calculator's own writes never reload it.
// The server has no fragment; it renders the blank calculator.

let generation = 0;
let captured: { generation: number; fragment: string } | null = null;

function subscribe(onChange: () => void): () => void {
  const changed = () => {
    generation += 1;
    onChange();
  };
  window.addEventListener("hashchange", changed);
  return () => window.removeEventListener("hashchange", changed);
}

function openedFragment(): string {
  if (!captured || captured.generation !== generation) captured = { generation, fragment: window.location.hash };
  return `${captured.generation}|${captured.fragment}`;
}

const SERVER_FRAGMENT = "0|";

function writeFragment(encoded: string): void {
  const next = encoded ? `#${encoded}` : "";
  if (window.location.hash === next) return;
  try {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
  } catch {
    // The browser throttles address changes; the next change writes it again.
  }
}

/**
 * The free grade calculator, in two modes: one course (rows of graded work
 * with weights and scores, a grading scale and a target) and the German
 * grade average (modules with credits and grades 1,0..5,0, a target
 * average), the default for German visitors. Results come from the same
 * grade math as the app (lib/grades: calc, german) and, for a course, the
 * grade tracker's own sentences (workspace/grades/text.ts). The state is the
 * page address (lib/tools/grade-calculator.ts), so nothing is stored anywhere.
 */
export function GradeCalculator() {
  const { locale } = useI18n();
  const defaultMode = defaultModeFor(locale);
  const opened = useSyncExternalStore(subscribe, openedFragment, () => SERVER_FRAGMENT);
  // Leaving the page: the next visit reads the address afresh.
  useEffect(
    () => () => {
      generation += 1;
    },
    [],
  );
  const fragment = opened.slice(opened.indexOf("|") + 1);
  return (
    <Calculator
      key={opened}
      defaultMode={defaultMode}
      initial={fragment ? decodeState(fragment, defaultMode) : initialState(defaultMode)}
    />
  );
}

type CopyStatus = "idle" | "copied" | "failed";

function Calculator({ initial, defaultMode }: { initial: CalcState; defaultMode: CalcMode }) {
  const { dict, t, locale } = useI18n();
  const g = dict.grades;
  const T = dict.tools.gradeCalculator;
  const E = T.ects;
  const ids = useId();
  const [state, setState] = useState(initial);
  // The box being typed in: an unreadable value is pointed out once the student leaves it.
  const [focused, setFocused] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  const nameRefs = useRef(new Map<number, HTMLInputElement>());
  const removeRefs = useRef(new Map<number, HTMLButtonElement>());
  const addRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<{ kind: "name" | "remove"; id: number } | "add" | null>(null);

  const ects = state.mode === "ects";
  const rows = activeRows(state);
  const course = useMemo(() => calculate(state), [state]);
  const modules = useMemo(() => calculateModules(state.modules), [state.modules]);

  // The address follows the state once typing pauses.
  useEffect(() => {
    const timer = window.setTimeout(() => writeFragment(encodeState(state, defaultMode)), URL_WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state, defaultMode]);

  // Focus after adding or removing a row (the element exists only after the render).
  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    if (next === "add") addRef.current?.focus();
    else (next.kind === "name" ? nameRefs.current : removeRefs.current).get(next.id)?.focus();
  }, [rows]);

  useEffect(() => {
    if (copyStatus !== "copied") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const update = (fn: (s: CalcState) => CalcState) => {
    setState(fn);
    setCopyStatus("idle");
  };
  /** Change the rows of the mode on screen. */
  const updateRows = (fn: (rows: CalcRow[]) => CalcRow[]) =>
    update((s) => (s.mode === "ects" ? { ...s, modules: { ...s.modules, rows: fn(s.modules.rows) } } : { ...s, rows: fn(s.rows) }));
  const setRow = (id: number, patch: Partial<Omit<CalcRow, "id">>) =>
    updateRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = () => {
    if (rows.length >= MAX_ROWS) return;
    const id = nextRowId(rows);
    focusNext.current = { kind: "name", id };
    updateRows((list) => [...list, ...emptyRows(1, id)]);
  };

  const removeRow = (id: number) => {
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) return;
    if (rows.length === 1) {
      // The last row is emptied rather than removed, so there is always one to type in.
      const fresh = nextRowId(rows);
      focusNext.current = { kind: "name", id: fresh };
      updateRows(() => emptyRows(1, fresh));
      return;
    }
    const neighbour = rows[index + 1] ?? rows[index - 1];
    focusNext.current = neighbour ? { kind: "remove", id: neighbour.id } : "add";
    updateRows((list) => list.filter((r) => r.id !== id));
  };

  const loadExample = () =>
    update((s) =>
      s.mode === "ects" ? exampleModules(E.example, s, locale) : exampleState(dict.landing.samples.grades, s),
    );

  const copyLink = async () => {
    const encoded = encodeState(state, defaultMode);
    writeFragment(encoded);
    const url = `${window.location.origin}${window.location.pathname}${encoded ? `#${encoded}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  const blank = rows.every(isBlankRow);
  const rowName = (row: CalcRow, index: number) => row.name.trim() || t(T.itemN, { n: index + 1 });
  const modes: CalcMode[] = defaultMode === "ects" ? ["ects", "course"] : ["course", "ects"];

  // What each column is called and how a row's numbers are checked, by mode.
  const columns = ects
    ? {
        name: E.moduleColumn,
        namePlaceholder: E.namePlaceholder,
        weight: E.ectsColumn,
        weightSuffix: null,
        score: E.gradeColumn,
        scorePlaceholder: E.gradePlaceholder,
        scoreMax: MAX_NUMBER_LENGTH,
        weightError: (row: CalcRow) => (modules.invalidEcts.has(row.id) ? t(E.invalidEcts, { text: row.weight.trim() }) : null),
        scoreError: (row: CalcRow) => (modules.invalidGrade.has(row.id) ? t(E.invalidGrade, { text: row.score.trim() }) : null),
        hint: E.hint,
      }
    : {
        name: T.nameColumn,
        namePlaceholder: T.namePlaceholder,
        weight: g.columns.weight,
        weightSuffix: "%",
        score: g.columns.score,
        scorePlaceholder: T.scorePlaceholder,
        scoreMax: MAX_SCORE_LENGTH,
        weightError: (row: CalcRow) => (course.invalidWeight.has(row.id) ? t(T.invalidWeight, { text: row.weight.trim() }) : null),
        scoreError: (row: CalcRow) => (course.invalidScore.has(row.id) ? t(g.invalidScore, { text: row.score.trim() }) : null),
        hint: T.scoreHint,
      };

  return (
    <div className="mt-8">
      {/* ---- Which calculation ---- */}
      <fieldset>
        <legend className="text-[15px] font-semibold text-ink">{T.modeLegend}</legend>
        <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-[1.75rem] border border-line bg-card p-1 sm:inline-grid sm:w-auto sm:auto-cols-max sm:grid-flow-col">
          {modes.map((mode) => (
            <label
              key={mode}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-full px-4 py-1.5 text-center text-[15px] leading-tight font-semibold text-ink-soft transition hover:text-ink has-[:checked]:bg-lime has-[:checked]:text-lime-on has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name={`${ids}-mode`}
                value={mode}
                checked={state.mode === mode}
                onChange={() => update((s) => ({ ...s, mode }))}
                className="sr-only"
              />
              {T.modes[mode]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-6">
        {/* ---- What the student types ---- */}
        <section aria-labelledby={`${ids}-work`} className="min-w-0 rounded-3xl border border-line bg-card p-4 sm:p-6">
          <h2 id={`${ids}-work`} className="font-display text-2xl leading-tight text-ink">
            {ects ? E.workTitle : T.workTitle}
          </h2>

          <div
            aria-hidden
            className={cn("mt-5 hidden gap-x-2 px-1 text-sm font-medium text-ink-soft sm:grid", ROW_GRID[state.mode])}
          >
            <span>{columns.name}</span>
            <span>{columns.weight}</span>
            <span>{columns.score}</span>
          </div>

          <ul className="mt-3 divide-y divide-line sm:mt-2 sm:divide-y-0">
            {rows.map((row, index) => {
              const key = `${ids}-${row.id}`;
              const name = rowName(row, index);
              const weightError = focused !== `${key}-w` ? columns.weightError(row) : null;
              const scoreError = focused !== `${key}-s` ? columns.scoreError(row) : null;
              const failed = ects && modules.failed.has(row.id);
              // Each box is named by its column (as shown) and its row: "Weight Midterm".
              return (
                <li
                  key={row.id}
                  className={cn(
                    "relative grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-end gap-x-2 gap-y-2 py-3 first:pt-0 sm:py-1",
                    ROW_GRID[state.mode],
                  )}
                >
                  <span id={`${key}-row`} className="sr-only">
                    {name}
                  </span>
                  <span id={`${key}-num`} className="sr-only">
                    {t(T.itemN, { n: index + 1 })}
                  </span>
                  <label className="col-span-3 flex min-w-0 flex-col gap-1 sm:col-span-1">
                    <span id={`${key}-ln`} className="text-sm text-ink-soft sm:sr-only">
                      {columns.name}
                    </span>
                    <input
                      ref={(el) => {
                        if (el) nameRefs.current.set(row.id, el);
                        else nameRefs.current.delete(row.id);
                      }}
                      type="text"
                      dir="auto"
                      autoComplete="off"
                      enterKeyHint="next"
                      maxLength={MAX_NAME_LENGTH}
                      value={row.name}
                      placeholder={columns.namePlaceholder}
                      aria-labelledby={`${key}-ln ${key}-num`}
                      onChange={(e) => setRow(row.id, { name: e.target.value })}
                      className={FIELD}
                    />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1">
                    <span id={`${key}-lw`} className="text-sm text-ink-soft sm:sr-only">
                      {columns.weight}
                    </span>
                    <span className="relative block">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        enterKeyHint="next"
                        maxLength={MAX_NUMBER_LENGTH}
                        value={row.weight}
                        aria-labelledby={`${key}-lw ${key}-row`}
                        aria-invalid={weightError ? true : undefined}
                        aria-describedby={weightError ? `${key}-werr` : undefined}
                        onChange={(e) => setRow(row.id, { weight: e.target.value })}
                        onFocus={() => setFocused(`${key}-w`)}
                        onBlur={() => setFocused(null)}
                        className={cn(FIELD, "text-end tabular-nums", columns.weightSuffix && "pe-8")}
                      />
                      {columns.weightSuffix && (
                        <span aria-hidden className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-ink-faint">
                          {columns.weightSuffix}
                        </span>
                      )}
                    </span>
                  </label>
                  <label className="flex min-w-0 flex-col gap-1">
                    <span id={`${key}-ls`} className="text-sm text-ink-soft sm:sr-only">
                      {columns.score}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      enterKeyHint="next"
                      maxLength={columns.scoreMax}
                      value={row.score}
                      placeholder={columns.scorePlaceholder}
                      aria-labelledby={`${key}-ls ${key}-row`}
                      aria-invalid={scoreError ? true : undefined}
                      aria-describedby={scoreError ? `${key}-serr` : failed ? `${key}-failed` : undefined}
                      onChange={(e) => setRow(row.id, { score: e.target.value })}
                      onFocus={() => setFocused(`${key}-s`)}
                      onBlur={() => setFocused(null)}
                      className={cn(FIELD, "text-end tabular-nums")}
                    />
                  </label>
                  <button
                    ref={(el) => {
                      if (el) removeRefs.current.set(row.id, el);
                      else removeRefs.current.delete(row.id);
                    }}
                    type="button"
                    aria-label={t(g.categories.remove, { name })}
                    title={t(g.categories.remove, { name })}
                    onClick={() => removeRow(row.id)}
                    className="grid size-11 place-items-center rounded-full text-ink-soft transition hover:bg-hover hover:text-ink"
                  >
                    <X className="size-5" aria-hidden />
                  </button>
                  {failed && (
                    <p id={`${key}-failed`} className="col-span-full flex">
                      <span className="rounded-full border border-red-600/30 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:border-red-400/40 dark:text-red-300">
                        {E.failedTag}
                      </span>
                    </p>
                  )}
                  {weightError && (
                    <p id={`${key}-werr`} className={cn(ERROR, "col-span-full")}>
                      {weightError}
                    </p>
                  )}
                  {scoreError && (
                    <p id={`${key}-serr`} className={cn(ERROR, "col-span-full")}>
                      {scoreError}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              ref={addRef}
              type="button"
              onClick={addRow}
              disabled={rows.length >= MAX_ROWS}
              className={cn(PILL_SECONDARY, "disabled:cursor-not-allowed disabled:opacity-50")}
            >
              <Plus className="size-4" aria-hidden />
              {T.addRow}
            </button>
            {rows.length >= MAX_ROWS && <p className="text-sm text-ink-soft">{t(T.maxRows, { max: MAX_ROWS })}</p>}
          </div>
          <p className="mt-4 text-sm leading-6 text-ink-soft">{columns.hint}</p>

          <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
            {ects ? (
              <ModuleTargetField
                id={`${ids}-target`}
                value={state.modules.target}
                onChange={(target) => update((s) => ({ ...s, modules: { ...s.modules, target } }))}
              />
            ) : (
              <>
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-sm font-semibold text-ink">{g.scaleLabel}</span>
                  <select
                    value={state.scale}
                    onChange={(e) => update((s) => ({ ...s, scale: e.target.value as GradeScalePreset }))}
                    className={cn(FIELD, "pe-8")}
                  >
                    {GRADE_SCALE_PRESETS.map((preset) => (
                      <option key={preset} value={preset}>
                        {g.presets[preset]}
                      </option>
                    ))}
                  </select>
                </label>
                <TargetField
                  id={`${ids}-target`}
                  state={state}
                  invalid={course.invalidTarget && focused !== `${ids}-target`}
                  onFocus={() => setFocused(`${ids}-target`)}
                  onBlur={() => setFocused(null)}
                  onChange={(target) => update((s) => ({ ...s, target }))}
                />
              </>
            )}
          </div>
        </section>

        {/* ---- The answer ---- */}
        <section
          aria-labelledby={`${ids}-result`}
          className="min-w-0 rounded-3xl bg-matcha p-4 sm:p-6 lg:sticky lg:top-6"
          data-testid="calc-result"
        >
          <h2 id={`${ids}-result`} className="font-display text-2xl leading-tight text-ink">
            {T.resultTitle}
          </h2>

          {ects ? <ModulesResultView result={modules} /> : <CourseResultView scalePreset={state.scale} result={course} />}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {blank ? (
              <button type="button" onClick={loadExample} className={PILL_PRIMARY}>
                {T.loadExample}
              </button>
            ) : (
              <button type="button" onClick={copyLink} className={PILL_PRIMARY}>
                <Link2 className="size-4" aria-hidden />
                {copyStatus === "copied" ? dict.share.copied : dict.share.copy}
              </button>
            )}
            <p role="status" className="min-w-0 text-sm text-ink-soft empty:hidden">
              {copyStatus === "copied" ? dict.share.copied : copyStatus === "failed" ? T.copyFailed : ""}
            </p>
          </div>
          <p className="mt-4 text-sm leading-6 text-ink-soft">{T.privacyNote}</p>
        </section>
      </div>
    </div>
  );
}

/** One course: grade so far, what the rest needs, how much is decided, the tracker's own sentences. */
function CourseResultView({ result, scalePreset }: { result: CalcResult; scalePreset: GradeScalePreset }) {
  const { dict, t, locale } = useI18n();
  const g = dict.grades;
  const T = dict.tools.gradeCalculator;
  const scale = useMemo(() => resolveScale(scalePreset, undefined, g.uk), [scalePreset, g.uk]);
  const { grade } = result;
  const pct = (n: number, d = 1) => formatPercent(n, locale, d);

  const o = grade.outlook;
  const needed =
    !o || result.counted === 0
      ? "—"
      : o.kind === "needed"
        ? pct(o.average)
        : o.kind === "secured"
          ? T.securedValue
          : o.kind === "unreachable"
            ? T.unreachableValue
            : o.kind === "met"
              ? T.metValue
              : T.missedValue;
  const outlook = result.counted === 0 ? T.empty : outlookText(grade, result.target, scale, locale, g, t);
  const scored = grade.items.filter((i) => i.counted && i.percent !== null).length;
  const countedItems = grade.items.filter((i) => i.counted).length;
  const showRange = result.counted > 0 && grade.remainingWeight > 0 && grade.floor !== null && grade.ceiling !== null;

  return (
    <>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className={TILE}>
          <dt className={TILE_LABEL}>{T.current}</dt>
          <dd className={TILE_VALUE} data-testid="calc-current">
            {grade.current === null ? "—" : formatGrade(grade.current, scale, locale)}
          </dd>
          <dd className={TILE_SUB}>
            {grade.current === null
              ? result.counted > 0
                ? g.noScores
                : NBSP
              : scale.display !== "percent"
                ? pct(grade.current)
                : NBSP}
          </dd>
        </div>
        <div className={TILE}>
          <dt className={TILE_LABEL}>{T.needed}</dt>
          <dd className={TILE_VALUE} data-testid="calc-needed">
            {needed}
          </dd>
          <dd className={TILE_SUB}>{NBSP}</dd>
        </div>
      </dl>

      {result.counted > 0 && (
        <Progress
          share={grade.decidedShare}
          label={t(g.decided, { percent: pct(grade.decidedShare * 100, 0) })}
          caption={`${t(g.decided, { percent: pct(grade.decidedShare * 100, 0) })} · ${t(g.scoredCount, { scored, total: countedItems })}`}
        />
      )}

      <Outlook text={outlook} />

      {showRange && (
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          {t(T.range, {
            min: gradeWithPercent(grade.floor as number, scale, locale),
            max: gradeWithPercent(grade.ceiling as number, scale, locale),
          })}
        </p>
      )}

      {result.counted > 0 && <Notes notes={grade.notes.map((note) => ({ key: note.code, text: noteText(note, locale, g, t) }))} />}
    </>
  );
}

/** The German grade average: the Notenschnitt, credits earned and open, what the open modules need, and how it is worked out. */
function ModulesResultView({ result }: { result: ModulesResult }) {
  const { dict, t, locale } = useI18n();
  const T = dict.tools.gradeCalculator;
  const E = T.ects;
  const { average, needed, target } = result;
  const grade = (n: number, decimals = 1) => formatGermanGrade(n, locale, decimals);
  const credits = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);

  const neededValue = germanNeededValue(needed, result.counted, locale, T);

  const outlook = germanOutlookText(average, needed, target, result.counted, locale, E, t);

  const notes: { key: string; text: string }[] = [];
  if (average.failed > 0) notes.push({ key: "failed", text: t(E.notes.failed, { count: average.failed }) });
  if (average.weighting === "equal" && average.passed > 0) notes.push({ key: "equal", text: E.notes.equal });
  const totalEcts = average.earnedEcts + average.openEcts;

  return (
    <>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className={TILE}>
          <dt className={TILE_LABEL}>{E.average}</dt>
          <dd className={TILE_VALUE} data-testid="calc-current">
            {average.shown === null ? "—" : grade(average.shown)}
          </dd>
          <dd className={TILE_SUB}>
            {average.unrounded === null ? NBSP : t(E.unrounded, { value: grade(average.unrounded, 2) })}
          </dd>
        </div>
        <div className={TILE}>
          <dt className={TILE_LABEL}>{E.neededLabel}</dt>
          <dd className={TILE_VALUE} data-testid="calc-needed">
            {neededValue}
          </dd>
          <dd className={TILE_SUB}>{needed?.kind === "needed" ? E.orBetter : NBSP}</dd>
        </div>
      </dl>

      {totalEcts > 0 && (
        <Progress
          share={average.earnedEcts / totalEcts}
          label={t(E.ectsDone, { earned: credits(average.earnedEcts), open: credits(average.openEcts) })}
          caption={t(E.ectsDone, { earned: credits(average.earnedEcts), open: credits(average.openEcts) })}
        />
      )}

      <Outlook text={outlook} />
      {result.counted > 0 && <Notes notes={notes} />}
      <p className="mt-3 text-sm leading-6 text-ink-soft" data-testid="calc-rule">
        {E.rule}
      </p>
    </>
  );
}

function Progress({ share, label, caption }: { share: number; label: string; caption: string }) {
  return (
    <div className="mt-4">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="h-2.5 overflow-hidden rounded-full bg-card"
      >
        <div className="h-full rounded-full bg-lime-deep transition-[width]" style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
      <p className="mt-2 text-sm text-ink-soft">{caption}</p>
    </div>
  );
}

/** The answer in a sentence, read out politely when it changes. */
function Outlook({ text }: { text: string }) {
  return (
    <p aria-live="polite" aria-atomic="true" className="mt-4 text-[15px] font-medium leading-6 text-ink" data-testid="calc-outlook">
      {text}
    </p>
  );
}

function Notes({ notes }: { notes: { key: string; text: string }[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1.5 text-sm leading-6 text-ink-soft">
      {notes.map((note) => (
        <li key={note.key} className="flex gap-2">
          <Info className="mt-1 size-4 shrink-0" aria-hidden />
          <span className="min-w-0">{note.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** A target average for the German mode: a passing grade from 1,0 to 4,0. */
function ModuleTargetField({ id, value, onChange }: { id: string; value: string; onChange: (target: string) => void }) {
  const { dict, locale } = useI18n();
  const choices = Array.from({ length: 31 }, (_, i) => (10 + i) / 10);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {dict.tools.gradeCalculator.ects.targetLabel}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(FIELD, "pe-8")}>
        <option value="">{dict.grades.noTarget}</option>
        {choices.map((grade) => (
          <option key={grade} value={grade.toFixed(1)}>
            {formatGermanGrade(grade, locale)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The target: a grade of the scale when it has grades ("B+ (87%)"), a
 * percentage otherwise. A target between two grades (typed as a percentage,
 * then the scale changed) still shows, as the in-app picker does.
 */
function TargetField({
  id,
  state,
  invalid,
  onChange,
  onFocus,
  onBlur,
}: {
  id: string;
  state: CalcState;
  invalid: boolean;
  onChange: (target: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const { dict, t, locale } = useI18n();
  const g = dict.grades;
  const T = dict.tools.gradeCalculator;
  const scale = resolveScale(state.scale, undefined, g.uk);
  const label = (
    <label htmlFor={id} className="text-sm font-semibold text-ink">
      {g.target}
    </label>
  );

  if (scale.bands.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {label}
        <span className="relative block">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            maxLength={MAX_NUMBER_LENGTH}
            value={state.target}
            placeholder={T.targetPlaceholder}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-err` : undefined}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            className={cn(FIELD, "pe-8 text-end tabular-nums")}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-ink-faint">
            %
          </span>
        </span>
        {invalid && (
          <p id={`${id}-err`} className={ERROR}>
            {t(T.invalidTarget, { text: state.target.trim() })}
          </p>
        )}
      </div>
    );
  }

  const choices = targetChoices(scale);
  const typed = state.target.replace(/[%٪]/g, "").trim();
  const value = typed === "" ? null : parseLocaleNumber(typed);
  const match = value === null ? undefined : choices.find((b) => Math.abs(b.min - value) < 1e-9);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label}
      <select
        id={id}
        value={match ? String(match.min) : value !== null ? state.target : ""}
        onChange={(e) => onChange(e.target.value)}
        className={cn(FIELD, "pe-8")}
      >
        <option value="">{g.noTarget}</option>
        {value !== null && !match && <option value={state.target}>{formatPercent(value, locale)}</option>}
        {choices.map((b) => (
          <option key={b.min} value={String(b.min)}>
            {`${bandName(b, scale, locale)} (${formatPercent(b.min, locale)})`}
          </option>
        ))}
      </select>
    </div>
  );
}
