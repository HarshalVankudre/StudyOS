"use client";

import { useId } from "react";
import { Info } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { formatGermanGrade } from "@/lib/grades/german";
import type { ModuleReport, ModuleRow } from "@/lib/grades";
import { cn } from "@/lib/utils";
import { ScoreInput } from "./ScoreInput";
import { germanNeededValue, germanOutlookText } from "./text";

const FIELD =
  "h-11 w-full min-w-0 rounded-lg border border-line-strong bg-paper px-2 text-sm text-ink outline-none focus:border-lime-deep focus:ring-2 focus:ring-lime-deep/30";
const TILE = "flex min-w-0 flex-col rounded-xl p-3";
/** Target averages a student can pick: 1,0 to 4,0 in tenths. */
const TARGETS = Array.from({ length: 31 }, (_, i) => (10 + i) / 10);

/**
 * The grades block in module-grade entry (German grades): the Notenschnitt
 * with its exact value, credits earned and open, the target average and
 * what the open modules need for it, then every module with its credits and
 * a grade box. Results are worded as the free calculator words them
 * (tools.gradeCalculator.ects); the math is lib/grades/german.ts.
 */
export function ModuleGrades({
  report,
  targetGrade,
  whatIfOn,
  whatIfText,
  setWhatIf,
  onGrade,
  onTarget,
}: {
  report: ModuleReport;
  targetGrade: number | undefined;
  whatIfOn: boolean;
  whatIfText: Record<string, string>;
  setWhatIf: (rowId: string, text: string) => void;
  /** Save the typed grade; false when it is not a grade (the box shows the stored one again). */
  onGrade: (rowId: string, text: string) => boolean;
  onTarget: (target: number | null) => void;
}) {
  const { dict, t, locale } = useI18n();
  const g = dict.grades;
  const M = g.modules;
  const T = dict.tools.gradeCalculator;
  const E = T.ects;
  const ids = useId();
  const { average, needed, target, modules } = report;
  const grade = (n: number, decimals = 1) => formatGermanGrade(n, locale, decimals);
  const credits = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  const counted = modules.filter((m) => m.status !== "invalid").length;
  const outlook = germanOutlookText(average, needed, target, counted, locale, E, t);
  const neededValue = germanNeededValue(needed, counted, locale, T);
  const totalEcts = average.earnedEcts + average.openEcts;
  const notes: { key: string; text: string }[] = [];
  if (average.failed > 0) notes.push({ key: "failed", text: t(E.notes.failed, { count: average.failed }) });
  if (average.weighting === "equal" && average.passed > 0) notes.push({ key: "equal", text: E.notes.equal });

  return (
    <>
      <section aria-label={E.average} className="flex flex-col gap-3 px-3 pt-4 sm:px-4">
        <dl className="grid grid-cols-2 gap-3">
          <div className={cn(TILE, "bg-matcha")}>
            <dt className="text-xs font-semibold text-ink-soft">{E.average}</dt>
            <dd className="mt-auto pt-1 font-display text-3xl font-bold tabular-nums text-ink" data-testid="grades-overall">
              {average.shown === null ? "—" : grade(average.shown)}
            </dd>
            <dd className="text-xs tabular-nums text-ink-soft" data-testid="grades-unrounded">
              {average.unrounded === null ? g.overallNone : t(E.unrounded, { value: grade(average.unrounded, 2) })}
            </dd>
          </div>
          <div className={cn(TILE, "bg-oat")}>
            <dt className="text-xs font-semibold text-ink-soft">{E.neededLabel}</dt>
            <dd className="mt-auto break-words pt-1 font-display text-2xl font-bold tabular-nums text-ink" data-testid="grades-needed">
              {neededValue}
            </dd>
            <dd className="text-xs text-ink-soft">{needed?.kind === "needed" ? E.orBetter : " "}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-1 text-xs text-ink-soft">
          {totalEcts > 0 && (
            <div
              role="progressbar"
              aria-label={t(E.ectsDone, { earned: credits(average.earnedEcts), open: credits(average.openEcts) })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((average.earnedEcts / totalEcts) * 100)}
              className="mb-1 h-1.5 overflow-hidden rounded-full bg-hover"
            >
              <div className="h-full rounded-full bg-lime" style={{ width: `${Math.min(100, (average.earnedEcts / totalEcts) * 100)}%` }} />
            </div>
          )}
          <p data-testid="grades-ects">
            {t(E.ectsDone, { earned: credits(average.earnedEcts), open: credits(average.openEcts) })}
          </p>
          <p data-testid="grades-counts">
            {t(M.counts, { passed: average.passed, failed: average.failed, open: average.open })}
          </p>
        </div>

        <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">
          <label htmlFor={`${ids}-target`} className="font-semibold text-ink">
            {E.targetLabel}
          </label>
          <select
            id={`${ids}-target`}
            value={typeof targetGrade === "number" ? targetGrade.toFixed(1) : ""}
            onChange={(e) => onTarget(e.target.value === "" ? null : Number(e.target.value))}
            className={cn(FIELD, "sm:w-auto")}
          >
            <option value="">{g.noTarget}</option>
            {TARGETS.map((n) => (
              <option key={n} value={n.toFixed(1)}>
                {grade(n)}
              </option>
            ))}
          </select>
        </div>

        <p aria-live="polite" aria-atomic="true" className="text-sm font-medium text-ink" data-testid="grades-outlook">
          {outlook}
        </p>
        {notes.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-ink-soft">
            {notes.map((note) => (
              <li key={note.key} className="flex gap-1.5">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{note.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ul className="mx-3 mt-4 flex flex-col divide-y divide-line rounded-lg border border-line bg-paper/40 sm:mx-4">
        {modules.map((m) => (
          <ModuleLine
            key={m.id}
            module={m}
            whatIfOn={whatIfOn}
            whatIfText={whatIfText[m.id] ?? ""}
            setWhatIf={(text) => setWhatIf(m.id, text)}
            onGrade={(text) => onGrade(m.id, text)}
          />
        ))}
        {modules.length === 0 && <li className="px-3 py-3 text-sm text-ink-soft">{M.noModules}</li>}
      </ul>
      <p className="px-3 py-3 text-xs leading-5 text-ink-soft sm:px-4" data-testid="grades-rule">
        {E.rule}
      </p>
    </>
  );
}

function ModuleLine({
  module: m,
  whatIfOn,
  whatIfText,
  setWhatIf,
  onGrade,
}: {
  module: ModuleRow;
  whatIfOn: boolean;
  whatIfText: string;
  setWhatIf: (text: string) => void;
  onGrade: (text: string) => boolean;
}) {
  const { dict, t, locale } = useI18n();
  const g = dict.grades;
  const M = g.modules;
  const E = dict.tools.gradeCalculator.ects;
  const name = m.name || g.untitledItem;
  const number = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(n);
  // The saved grade (an assumed one is never saved), or the number that is not a grade.
  const stored = m.invalid !== null ? number(m.invalid) : m.grade !== null && !m.hypothetical ? formatGermanGrade(m.grade, locale) : "";
  const open = m.status === "open" || m.hypothetical;

  return (
    <li className="flex items-center gap-3 px-3 py-2" data-testid="grades-module">
      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate text-sm text-ink">
          {name}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
          <span>{m.credits === null ? M.noCredits : `${number(m.credits)} ${E.ectsColumn}`}</span>
          {m.status === "failed" && !m.hypothetical && (
            <span className="rounded-full border border-red-400/40 px-2 py-0.5 font-semibold text-red-300 [.light_&]:border-red-600/30 [.light_&]:text-red-700">
              {E.failedTag}
            </span>
          )}
          {m.hypothetical && (
            <span className="rounded-full bg-lime-faint px-2 py-0.5 font-semibold text-lime-deep">{g.whatIfBadge}</span>
          )}
          {m.invalid !== null && (
            <span className="font-semibold text-amber-300 [.light_&]:text-amber-700">
              {t(E.invalidGrade, { text: number(m.invalid) })}
            </span>
          )}
        </p>
      </div>
      {whatIfOn && open ? (
        <input
          type="text"
          inputMode="decimal"
          value={whatIfText}
          placeholder="—"
          aria-label={t(M.whatIfAria, { module: name })}
          onChange={(e) => setWhatIf(e.target.value)}
          className="h-11 w-20 rounded-lg border border-dashed border-lime-deep bg-paper px-2 text-end font-mono text-sm text-ink outline-none focus:ring-2 focus:ring-lime-deep/30"
        />
      ) : (
        <ScoreInput
          value={stored}
          placeholder="—"
          label={t(M.gradeAria, { module: name })}
          onCommit={onGrade}
        />
      )}
    </li>
  );
}
