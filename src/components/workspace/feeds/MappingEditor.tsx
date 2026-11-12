"use client";

import { useId } from "react";
import { useI18n } from "@/lib/i18n/client";
import { FIELD_TYPES, type ColumnChoice, type FeedMapping, type MappedField } from "@/lib/feeds/mapping";
import type { Database } from "@/lib/workspace/types";

const FIELDS: MappedField[] = ["title", "due", "course", "link", "status"];
const CAN_CREATE: MappedField[] = ["due", "course", "link"];
const NONE = "__none__";
const NEW = "__new__";

/** One select per imported field: which column of this table receives it. */
export function MappingEditor({
  db,
  mapping,
  onChange,
  allowNew = true,
}: {
  db: Database;
  mapping: FeedMapping;
  onChange: (mapping: FeedMapping) => void;
  allowNew?: boolean;
}) {
  const { dict } = useI18n();
  const F = dict.feeds;
  const baseId = useId();

  const toValue = (choice: ColumnChoice) => (choice === null ? NONE : choice === "new" ? NEW : choice);
  const fromValue = (value: string): ColumnChoice => (value === NONE ? null : value === NEW ? "new" : value);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {FIELDS.map((field) => {
        const options = db.properties.filter((p) => FIELD_TYPES[field].includes(p.type));
        const current = mapping[field];
        const id = `${baseId}-${field}`;
        return (
          <div key={field} className="flex min-w-0 items-center gap-2">
            <label htmlFor={id} className="w-24 shrink-0 text-sm text-ink-soft">
              {F.field[field]}
            </label>
            <select
              id={id}
              value={toValue(current)}
              onChange={(e) => onChange({ ...mapping, [field]: fromValue(e.target.value) })}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-card px-2 text-sm text-ink sm:min-h-9"
            >
              {field !== "title" && <option value={NONE}>{F.dontImport}</option>}
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || dict.db.untitled}
                </option>
              ))}
              {allowNew && CAN_CREATE.includes(field) && <option value={NEW}>{F.newColumn}</option>}
            </select>
          </div>
        );
      })}
    </div>
  );
}
