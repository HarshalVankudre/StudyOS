"use client";

import { useId, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Database, GradesColumns, Workspace } from "@/lib/workspace/types";
import {
  GRADE_COLUMN_KEYS,
  columnFits,
  findGradeDatabase,
  resolveGradeColumns,
  type GradeColumnKey,
} from "@/lib/grades";

const FIELD =
  "h-11 w-full min-w-0 rounded-lg border border-line-strong bg-paper px-2 text-sm text-ink outline-none focus:border-lime focus:ring-2 focus:ring-lime/30";

/**
 * Pick the list of graded work and say which column is which. Everything is
 * pre-filled from detection, so the usual setup is one tap; a missing score
 * column can be added right here.
 */
export function GradesSetup({
  workspace,
  databaseId,
  columns,
  onAddScoreColumn,
  onSave,
  onCancel,
}: {
  workspace: Workspace;
  databaseId?: string;
  columns?: GradesColumns;
  /** Add a number column for scores to `db`; returns its id. */
  onAddScoreColumn: (db: Database) => string;
  onSave: (databaseId: string, columns: GradesColumns) => void;
  onCancel?: () => void;
}) {
  const { dict } = useI18n();
  const g = dict.grades;
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

  return (
    <form
      className="flex flex-col gap-4 px-3 py-4 sm:px-4"
      onSubmit={(e) => {
        e.preventDefault();
        const ids: GradesColumns = {};
        for (const key of GRADE_COLUMN_KEYS) ids[key] = resolved[key]?.id ?? null;
        onSave(db.id, ids);
      }}
    >
      <div>
        <h3 className="font-display text-base font-bold text-ink">{g.setupTitle}</h3>
        <p className="mt-1 text-sm text-ink-soft">{g.setupIntro}</p>
      </div>

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
        {GRADE_COLUMN_KEYS.map((key) => {
          const options = db.properties.filter((p) => columnFits(db, key, p));
          return (
            <div key={key} className="flex min-w-0 flex-col gap-1 text-sm">
              <label htmlFor={`${uid}-${key}`} className="font-semibold text-ink">
                {g.columns[key]}
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
                {g.columnHints[key]}
              </p>
            </div>
          );
        })}
      </div>

      {!resolved.score && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-hover/60 p-3 text-sm sm:flex-row sm:items-center">
          <p className="flex-1 text-ink-soft">{g.missingScore}</p>
          <button
            type="button"
            onClick={() => {
              const id = onAddScoreColumn(db);
              setPicks((p) => ({ ...p, score: id }));
            }}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 font-semibold text-ink transition hover:bg-hover"
          >
            <Plus className="size-4" aria-hidden />
            {g.addScoreColumn}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!resolved.score}
          className="flex min-h-11 items-center gap-1.5 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep disabled:opacity-40"
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
