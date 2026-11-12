"use client";

import { useMemo, useState } from "react";
import { completionField, isRowComplete } from "@/lib/workspace/view-logic";
import { titleProperty } from "@/lib/workspace/helpers";
import { useI18n } from "@/lib/i18n/client";
import { CellDisplay, CompleteToggle } from "./cells";
import { isEmptyValue, ShowMore, type ViewBodyProps } from "./parts";
import { deadlineProp, PAGE_SIZE, rowTitle, visibleProps } from "./shared";

/** Cards: one column on a phone, two on a tablet, three on a desktop. */
export function GalleryView({ db, view, rows, actions, onOpen, onAdd, empty }: ViewBodyProps) {
  const { dict } = useI18n();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const completion = useMemo(() => completionField(db), [db]);
  const title = titleProperty(db);
  const dateProp = deadlineProp(db, view);
  const fields = visibleProps(db, view).filter((p) => p.id !== title?.id && p.id !== dateProp?.id);
  const shown = rows.slice(0, limit);

  return (
    <div>
      {rows.length === 0 && <div className="mb-3 rounded-md border border-line bg-card">{empty}</div>}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((row) => {
          const name = rowTitle(db, row);
          const done = isRowComplete(db, row, completion);
          const filled = fields.filter((p) => !isEmptyValue(row.cells[p.id]));
          return (
            <li key={row.id} className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-card p-3 shadow-sm">
              <div className="flex items-start gap-1">
                {completion && (
                  <CompleteToggle
                    done={done}
                    title={name}
                    onToggle={() =>
                      actions.setCell(row.id, completion.property.id, done ? completion.openValue : completion.doneValue)
                    }
                  />
                )}
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className={`min-h-9 min-w-0 flex-1 py-1.5 text-start text-sm font-semibold ${done ? "text-ink-faint line-through decoration-ink-faint/50" : "text-ink"}`}
                >
                  <span dir="auto" className="line-clamp-2">{name || dict.db.untitled}</span>
                </button>
              </div>
              {dateProp && !isEmptyValue(row.cells[dateProp.id]) && (
                <CellDisplay prop={dateProp} value={row.cells[dateProp.id]} complete={done} />
              )}
              {filled.length > 0 && (
                <dl className="space-y-1">
                  {filled.map((p) => (
                    <div key={p.id} className="flex min-w-0 items-baseline gap-2">
                      <dt className="w-20 shrink-0 truncate text-[11px] text-ink-faint"><bdi>{p.name}</bdi></dt>
                      <dd className="min-w-0 flex-1">
                        <CellDisplay prop={p} value={row.cells[p.id]} complete={done} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => onOpen(onAdd())}
            className="flex h-full min-h-20 w-full items-center justify-center rounded-md border border-dashed border-line px-3 py-4 text-sm text-ink-faint transition hover:border-line-strong hover:text-ink-soft"
          >
            {dict.db.newCard}
          </button>
        </li>
      </ul>
      {rows.length > shown.length && (
        <div className="mt-3 overflow-hidden rounded-md border border-line bg-card">
          <ShowMore remaining={rows.length - shown.length} onMore={() => setLimit((l) => l + PAGE_SIZE)} />
        </div>
      )}
    </div>
  );
}
