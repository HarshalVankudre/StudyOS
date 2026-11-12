"use client";

import { useMemo, useState } from "react";
import { completionField, isRowComplete } from "@/lib/workspace/view-logic";
import { titleProperty } from "@/lib/workspace/helpers";
import { useI18n } from "@/lib/i18n/client";
import { CellDisplay, CompleteToggle, DueBadge } from "./cells";
import { AddRowButton, isEmptyValue, ShowMore, type ViewBodyProps } from "./parts";
import { deadlineProp, PAGE_SIZE, rowTitle, visibleProps } from "./shared";

/**
 * The compact phone view: one row per item with a done toggle, the title,
 * a few small details and the deadline. Tapping an item opens its details.
 */
export function ListView({ db, view, rows, actions, onOpen, onAdd, empty }: ViewBodyProps) {
  const { dict } = useI18n();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const completion = useMemo(() => completionField(db), [db]);
  const title = titleProperty(db);
  const dateProp = deadlineProp(db, view);
  const meta = visibleProps(db, view)
    .filter(
      (p) =>
        p.id !== title?.id &&
        p.id !== dateProp?.id &&
        !(completion?.property.type === "checkbox" && p.id === completion.property.id),
    )
    .slice(0, 3);
  const shown = rows.slice(0, limit);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-card shadow-card">
      {rows.length === 0 ? (
        empty
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((row) => {
            const name = rowTitle(db, row);
            const done = isRowComplete(db, row, completion);
            const details = meta.filter((p) => !isEmptyValue(row.cells[p.id]));
            return (
              <li key={row.id} className="flex items-center gap-1 pe-3 ps-1 hover:bg-hover">
                {completion ? (
                  <CompleteToggle
                    done={done}
                    title={name}
                    onToggle={() =>
                      actions.setCell(
                        row.id,
                        completion.property.id,
                        done ? completion.openValue : completion.doneValue,
                      )
                    }
                  />
                ) : (
                  <span className="w-2" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="flex min-h-12 min-w-0 flex-1 flex-col justify-center py-1.5 text-start"
                >
                  <span
                    dir="auto"
                    className={`truncate text-sm font-medium ${done ? "text-ink-faint line-through decoration-ink-faint/50" : "text-ink"}`}
                  >
                    {name || dict.db.untitled}
                  </span>
                  {details.length > 0 && (
                    <span className="mt-0.5 flex max-h-5 min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
                      {details.map((p) => (
                        <CellDisplay key={p.id} prop={p} value={row.cells[p.id]} complete={done} interactive={false} />
                      ))}
                    </span>
                  )}
                </button>
                {dateProp && <DueBadge value={row.cells[dateProp.id]} complete={done} />}
              </li>
            );
          })}
        </ul>
      )}
      <ShowMore remaining={rows.length - shown.length} onMore={() => setLimit((l) => l + PAGE_SIZE)} />
      <AddRowButton onClick={() => onOpen(onAdd())} label={dict.db.newRow} className="border-t border-line" />
    </div>
  );
}
