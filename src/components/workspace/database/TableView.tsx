"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Maximize2, Trash2 } from "lucide-react";
import { completionField, isRowComplete, summarizeNumbers } from "@/lib/workspace/view-logic";
import { useI18n } from "@/lib/i18n/client";
import { EditableCell } from "./cells";
import { AddRowButton, ShowMore, type ViewBodyProps } from "./parts";
import { formatNumber, PAGE_SIZE, rowTitle, visibleProps } from "./shared";

const ROW_BUTTON =
  "grid h-8 w-8 place-items-center rounded text-ink-faint/80 transition hover:bg-hover hover:text-ink";

/** Editable table. On a phone it scrolls sideways inside its own box. */
export function TableView({ db, view, rows, actions, onOpen, onAdd, empty }: ViewBodyProps) {
  const { dict, t, locale } = useI18n();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const props = visibleProps(db, view);
  const completion = useMemo(() => completionField(db), [db]);
  const shown = rows.slice(0, limit);
  const primarySort = view.sorts?.find((s) => db.properties.some((p) => p.id === s.propertyId));

  // Header click: add as first sort key (ascending) -> descending -> removed.
  const cycleSort = (propertyId: string) =>
    actions.updateView(view.id, (v) => {
      const list = v.sorts ?? [];
      const index = list.findIndex((s) => s.propertyId === propertyId);
      const next =
        index === -1
          ? [{ propertyId, direction: "asc" as const }, ...list]
          : list[index].direction === "asc"
            ? list.map((s, i) => (i === index ? { ...s, direction: "desc" as const } : s))
            : list.filter((_, i) => i !== index);
      v.sorts = next.length ? next : undefined;
    });

  return (
    <div className="overflow-hidden rounded-md border border-line bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-start font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
              <th className="w-9 p-0">
                <span className="sr-only">{dict.dbViews.rowDetails}</span>
              </th>
              {props.map((p) => {
                const sort = view.sorts?.find((s) => s.propertyId === p.id);
                const isPrimary = primarySort?.propertyId === p.id;
                return (
                  <th
                    key={p.id}
                    scope="col"
                    aria-sort={isPrimary ? (sort?.direction === "desc" ? "descending" : "ascending") : undefined}
                    className="p-0 text-start font-medium"
                  >
                    <button
                      type="button"
                      onClick={() => cycleSort(p.id)}
                      title={t(dict.dbViews.sortBy, { name: p.name })}
                      className="flex min-h-9 w-full items-center gap-1 px-3 py-2 text-start uppercase hover:text-ink-soft"
                    >
                      <span className="truncate">{p.name}</span>
                      {sort &&
                        (sort.direction === "desc" ? (
                          <ArrowDown className="h-3 w-3 shrink-0 text-lime" aria-hidden />
                        ) : (
                          <ArrowUp className="h-3 w-3 shrink-0 text-lime" aria-hidden />
                        ))}
                    </button>
                  </th>
                );
              })}
              <th className="w-9 p-0">
                <span className="sr-only">{dict.db.delete}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const name = rowTitle(db, row) || dict.db.untitled;
              const done = isRowComplete(db, row, completion);
              return (
                <tr key={row.id} className="border-b border-line last:border-0 hover:bg-hover">
                  <td className="w-9 px-0.5 align-middle">
                    <button
                      type="button"
                      onClick={() => onOpen(row.id)}
                      aria-label={t(dict.dbViews.openRow, { name })}
                      className={ROW_BUTTON}
                    >
                      <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                  {props.map((p) => (
                    <td key={p.id} className={`px-2 py-1 align-top ${p.type === "checkbox" ? "w-12" : "min-w-36"}`}>
                      <EditableCell
                        databaseId={db.id}
                        rowId={row.id}
                        prop={p}
                        value={row.cells[p.id] ?? null}
                        complete={done}
                      />
                    </td>
                  ))}
                  <td className="w-9 px-0.5 align-middle">
                    <button
                      type="button"
                      onClick={() => actions.deleteRow(row.id)}
                      aria-label={t(dict.dbViews.deleteNamed, { name })}
                      className={`${ROW_BUTTON} hover:text-rose-500`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-line bg-surface text-xs text-ink-faint">
                <td />
                {props.map((p, index) => {
                  if (p.type === "number") {
                    const summary = summarizeNumbers(rows, p.id);
                    return (
                      <td key={p.id} className="px-3 py-1.5 tabular-nums" data-testid={`summary-${p.id}`}>
                        {summary.count > 0 ? (
                          <span className="whitespace-nowrap">
                            {dict.dbViews.sum} {formatNumber(summary.sum, locale)}
                            <span aria-hidden> · </span>
                            {dict.dbViews.average} {formatNumber(summary.average ?? 0, locale)}
                          </span>
                        ) : null}
                      </td>
                    );
                  }
                  return (
                    <td key={p.id} className="px-3 py-1.5">
                      {index === 0 ? t(dict.dbViews.count, { count: rows.length }) : null}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length === 0 && empty}
      <ShowMore remaining={rows.length - shown.length} onMore={() => setLimit((l) => l + PAGE_SIZE)} />
      <AddRowButton onClick={() => onAdd()} label={dict.db.newRow} className="border-t border-line" />
    </div>
  );
}
