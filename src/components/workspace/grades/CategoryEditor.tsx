"use client";

import { Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { parseLocaleNumber } from "@/lib/grades";
import type { GradeCategory } from "@/lib/workspace/types";
import { ScoreInput } from "./ScoreInput";

const FIELD =
  "h-11 min-w-0 rounded-lg border border-line-strong bg-paper px-2 text-sm text-ink outline-none focus:border-lime focus:ring-2 focus:ring-lime/30";
const SECONDARY =
  "flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover";

/**
 * Edit one course's grading categories: name, weight, how many lowest scores
 * are dropped; add and remove. Every change is one workspace edit (undoable).
 */
export function CategoryEditor({
  categories,
  onChange,
  onAdd,
  onRemove,
  onDone,
}: {
  categories: readonly GradeCategory[];
  onChange: (id: string, patch: Partial<Pick<GradeCategory, "name" | "weight" | "dropLowest">>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onDone: () => void;
}) {
  const { dict, t, locale } = useI18n();
  const c = dict.grades.categories;
  const fmt = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(n);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-hover/40 p-3" data-testid="category-editor">
      <p className="text-xs text-ink-soft">{c.editHint}</p>
      <ul className="flex flex-col gap-3">
        {categories.map((category) => {
          const name = category.name || c.newName;
          return (
            <li key={category.id} className="flex flex-wrap items-center gap-2">
              <input
                defaultValue={category.name}
                aria-label={c.nameAria}
                placeholder={c.newName}
                onBlur={(e) => {
                  const next = e.target.value.trim().slice(0, 200);
                  if (next && next !== category.name) onChange(category.id, { name: next });
                }}
                className={`${FIELD} w-full flex-1 sm:w-auto`}
              />
              <span className="flex items-center gap-1.5">
                <ScoreInput
                  value={category.weight > 0 ? fmt(category.weight) : ""}
                  label={t(c.weightAria, { name })}
                  placeholder="—"
                  className="w-16"
                  onCommit={(text) => {
                    const n = parseLocaleNumber(text.replace(/[%٪]/g, "").trim());
                    if (n === null || n < 0 || n > 1000) return false;
                    onChange(category.id, { weight: n });
                    return true;
                  }}
                />
                <span className="text-sm text-ink-soft">%</span>
              </span>
              <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                <span>{c.dropLabel}</span>
                <select
                  value={String(category.dropLowest ?? 0)}
                  aria-label={t(c.dropAria, { name })}
                  onChange={(e) => onChange(category.id, { dropLowest: Number(e.target.value) })}
                  className={`${FIELD} w-16`}
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-label={t(c.remove, { name })}
                title={t(c.remove, { name })}
                onClick={() => onRemove(category.id)}
                className="flex size-11 items-center justify-center rounded-lg border border-line-strong bg-card text-ink-soft transition hover:bg-hover hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAdd} className={SECONDARY}>
          <Plus className="size-4" aria-hidden />
          {c.add}
        </button>
        <button type="button" onClick={onDone} className={SECONDARY}>
          {c.done}
        </button>
      </div>
    </div>
  );
}
