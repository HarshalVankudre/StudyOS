"use client";

import { useId, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Database, GradesBlock, GradesColumns, Workspace } from "@/lib/workspace/types";
import {
  ALL_GRADE_COLUMN_KEYS,
  GRADE_COLUMN_KEYS,
  columnFits,
  findGradeDatabase,
  resolveGradeColumns,
  type GradeColumnKey,
} from "@/lib/grades";
import { EntryChoice } from "./GradesSettings";

const FIELD =
  "h-11 w-full min-w-0 rounded-lg border border-line-strong bg-paper px-2 text-sm text-ink outline-none focus:border-lime-deep focus:ring-2 focus:ring-lime-deep/30";

type Entry = NonNullable<GradesBlock["entry"]>;

/**
 * Pick the list of graded work and say which column is which. Everything is
 * pre-filled from detection, so the usual setup is one tap; a missing score
 * column can be added right here. With German grades the student first says
 * how grades are entered; module grades need only the grade and credits
 * columns (one module per row), never weights or "out of".
 */
export function GradesSetup({
  workspace,
  databaseId,
  columns,
  german = false,
  entry = "percent",
  onEntry,
  onAddColumn,
  onSave,
  onCancel,
}: {
  workspace: Workspace;
  databaseId?: string;
  columns?: GradesColumns;
  /** The block's scale is German grades: offer the choice of entry. */
  german?: boolean;
  entry?: Entry;
  onEntry?: (entry: Entry) => void;
  /** Add a number column named `name` to `db`; returns its id. */
  onAddColumn: (db: Database, name: string) => string;
  onSave: (databaseId: string, columns: GradesColumns) => void;
  onCancel?: () => void;
}) {
  const { dict } = useI18n();
  const g = dict.grades;
  const M = g.modules;
  const E = dict.tools.gradeCalculator.ects;
  const modules = german && entry === "grade";
  const uid = useId();
  const initialDb =
    workspace.databases.find((d) => d.id === databaseId)?.id ?? findGradeDatabase(workspace)?.id ?? workspace.databases[0]?.id ?? "";
  const [dbId, setDbId] = useState(initialDb);
  // Explicit picks per database; anything not picked follows detection.
  const [picks, setPicks] = useState<GradesColumns>(dbId === databaseId ? (columns ?? {}) : {});

  const db = workspace.databases.find((d) => d.id === dbId);
  if (!db) {
    return <p className="px-3 py-4 text-sm text-ink-soft sm:px-4">{g.noDatabase}</p>;
  }
  const resolved = resolveGradeColumns(db, picks);

  const choose = (key: GradeColumnKey, value: string) =>
    setPicks((p) => ({ ...p, [key]: value === "" ? null : value }));
  const shown: readonly GradeColumnKey[] = modules ? ["score", "credits"] : GRADE_COLUMN_KEYS;
  const label = (key: GradeColumnKey) =>
    key === "credits" ? M.creditsColumn : modules && key === "score" ? E.gradeColumn : g.columns[key];
  const hint = (key: GradeColumnKey) =>
    key === "credits" ? M.creditsHint : modules && key === "score" ? M.gradeHint : g.columnHints[key];
  // A missing column, added right here: the score (or grade), and the credits of modules.
  const missing = [
    !resolved.score && {
      key: "score" as const,
      text: modules ? M.missingGrade : g.missingScore,
      action: modules ? M.addGradeColumn : g.addScoreColumn,
      name: modules ? E.gradeColumn : g.scoreColumnName,
    },
    modules &&
      !resolved.credits && {
        key: "credits" as const,
        text: M.missingCredits,
        action: M.addCreditsColumn,
        name: E.ectsColumn,
      },
  ].filter((m) => !!m);

  return (
    <form
      className="flex flex-col gap-4 px-3 py-4 sm:px-4"
      onSubmit={(e) => {
        e.preventDefault();
        const ids: GradesColumns = {};
        for (const key of modules ? ALL_GRADE_COLUMN_KEYS : GRADE_COLUMN_KEYS) ids[key] = resolved[key]?.id ?? null;
        onSave(db.id, ids);
      }}
    >
      <div>
        <h3 className="font-display text-base font-bold text-ink">{g.setupTitle}</h3>
        <p className="mt-1 text-sm text-ink-soft">{modules ? M.setupIntro : g.setupIntro}</p>
      </div>

      {german && onEntry && <EntryChoice value={entry} onChange={onEntry} />}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold text-ink">{g.databaseLabel}</span>
        <select
          value={dbId}
          onChange={(e) => {
            setDbId(e.target.value);
            setPicks(e.target.value === databaseId ? (columns ?? {}) : {});
          }}
          className={FIELD}
        >
          {workspace.databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.icon ? `${d.icon} ` : ""}
              {d.name || dict.db.untitled}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((key) => {
          const options = db.properties.filter((p) => columnFits(db, key, p));
          return (
            <div key={key} className="flex min-w-0 flex-col gap-1 text-sm">
              <label htmlFor={`${uid}-${key}`} className="font-semibold text-ink">
                {label(key)}
              </label>
              <select
                id={`${uid}-${key}`}
                aria-describedby={`${uid}-${key}-hint`}
                value={resolved[key]?.id ?? ""}
                onChange={(e) => choose(key, e.target.value)}
                className={FIELD}
              >
                <option value="">{g.noneOption}</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || dict.db.untitled}
                  </option>
                ))}
              </select>
              <p id={`${uid}-${key}-hint`} className="text-xs text-ink-soft">
                {hint(key)}
              </p>
            </div>
          );
        })}
      </div>

      {missing.map((m) => (
        <div
          key={m.key}
          className="flex flex-col gap-2 rounded-lg border border-line bg-hover/60 p-3 text-sm sm:flex-row sm:items-center"
        >
          <p className="flex-1 text-ink-soft">{m.text}</p>
          <button
            type="button"
            onClick={() => {
              const id = onAddColumn(db, m.name);
              setPicks((p) => ({ ...p, [m.key]: id }));
            }}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 font-semibold text-ink transition hover:bg-hover"
          >
            <Plus className="size-4" aria-hidden />
            {m.action}
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!resolved.score}
          className="flex min-h-11 items-center gap-1.5 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-hover disabled:opacity-40"
        >
          <Check className="size-4" aria-hidden />
          {g.saveSetup}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            {g.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
