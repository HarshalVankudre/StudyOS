"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Maximize2, Trash2 } from "lucide-react";
import type { DatabaseProperty } from "@/lib/workspace/types";
import { titleProperty } from "@/lib/workspace/helpers";
import { completionField, isRowComplete, numberColumnSums, summarizeNumbers } from "@/lib/workspace/view-logic";
import { useI18n } from "@/lib/i18n/client";
import { EditableCell } from "./cells";
import { AddRowButton, ShowMore, type ViewBodyProps } from "./parts";
import { formatNumber, PAGE_SIZE, rowTitle, visibleProps } from "./shared";

const ROW_BUTTON =
  "grid h-8 w-8 place-items-center rounded text-ink-faint/80 transition hover:bg-hover hover:text-ink";

/**
 * Smallest width per column type, so a value is never squeezed to a few
 * letters: when the columns do not fit, the table scrolls sideways inside
 * its own box instead.
 */
const MIN_WIDTH: Record<DatabaseProperty["type"], string> = {
  text: "min-w-40",
  url: "min-w-40",
  number: "min-w-20",
  checkbox: "w-12",
  date: "min-w-36",
  select: "min-w-28",
  status: "min-w-32",
  multi_select: "min-w-40",
  relation: "min-w-40",
};

/**
 * Cells that stay in view while the table scrolls sideways (the open button
 * and the title column). They need an opaque background, with the row hover
 * tint layered on top of it.
 */
const STICKY =
  "sticky z-[1] bg-card group-hover:[background-image:linear-gradient(var(--hover-c),var(--hover-c))]";
const STICKY_HEAD = "sticky z-[1] bg-surface";

/** Editable table. When it is wider than its box it scrolls sideways, title kept in view. */
export function TableView({ db, view, rows, actions, onOpen, onAdd, empty }: ViewBodyProps) {
  const { dict, t, locale, plural } = useI18n();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const props = visibleProps(db, view);
  const titleId = titleProperty(db)?.id;
  // The title column is the first visible column when it is shown; it is
  // the one kept in view.
  const stickyId = props[0]?.id === titleId ? titleId : undefined;
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

  const widthOf = (p: DatabaseProperty) => (p.id === stickyId ? "min-w-52" : MIN_WIDTH[p.type]);
  // The title column's trailing edge, so it reads as pinned over the scroll.
  const stickyEdge = "shadow-[inset_-1px_0_0_var(--line)] rtl:shadow-[inset_1px_0_0_var(--line)]";

  return (
    <div className="overflow-hidden rounded-md border border-line bg-card shadow-card">
      <div className="overflow-x-auto overscroll-x-contain" data-testid="table-scroll">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-surface text-start font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
              <th className={`${STICKY_HEAD} start-0 w-9 min-w-9 border-b border-line p-0`}>
                <span className="sr-only">{dict.dbViews.rowDetails}</span>
              </th>
              {props.map((p) => {
                const sort = view.sorts?.find((s) => s.propertyId === p.id);
                const isPrimary = primarySort?.propertyId === p.id;
                const sticky = p.id === stickyId;
                return (
                  <th
                    key={p.id}
                    scope="col"
                    aria-sort={isPrimary ? (sort?.direction === "desc" ? "descending" : "ascending") : undefined}
                    className={`border-b border-line p-0 text-start font-medium ${widthOf(p)} ${
                      sticky ? `${STICKY_HEAD} start-9 ${stickyEdge}` : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => cycleSort(p.id)}
                      title={t(dict.dbViews.sortBy, { name: p.name })}
                      className="flex min-h-9 w-full items-center gap-1 px-3 py-2 text-start uppercase hover:text-ink-soft"
                    >
                      <span dir="auto" className="truncate">{p.name}</span>
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
              <th className="w-9 min-w-9 border-b border-line p-0">
                <span className="sr-only">{dict.db.delete}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => {
              const name = rowTitle(db, row) || dict.db.untitled;
              const done = isRowComplete(db, row, completion);
              const line = index < shown.length - 1 ? "border-b border-line" : "";
              return (
                <tr key={row.id} className="group hover:bg-hover">
                  <td className={`${STICKY} start-0 w-9 px-0.5 align-middle ${line}`}>
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
                    <td
                      key={p.id}
                      className={`px-2 py-1 align-top ${widthOf(p)} ${line} ${
                        p.id === stickyId ? `${STICKY} start-9 ${stickyEdge}` : ""
                      }`}
                    >
                      <EditableCell
                        databaseId={db.id}
                        rowId={row.id}
                        prop={p}
                        value={row.cells[p.id] ?? null}
                        complete={done}
                      />
                    </td>
                  ))}
                  <td className={`w-9 px-0.5 align-middle ${line}`}>
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
              <tr className="bg-surface text-xs text-ink-faint">
                <td className={`${STICKY_HEAD} start-0 border-t border-line`} />
                {props.map((p, index) => {
                  const sticky = p.id === stickyId ? `${STICKY_HEAD} start-9 ${stickyEdge}` : "";
                  if (p.type === "number") {
                    const summary = summarizeNumbers(rows, p.id);
                    const sums = numberColumnSums(p);
                    return (
                      <td key={p.id} className={`border-t border-line px-3 py-1.5 tabular-nums ${sticky}`} data-testid={`summary-${p.id}`}>
                        {summary.count > 0 ? (
                          <span className="whitespace-nowrap">
                            {sums && (
                              <>
                                {dict.dbViews.sum} {formatNumber(summary.sum, locale)}
                                <span aria-hidden> · </span>
                              </>
                            )}
                            {dict.dbViews.average} {formatNumber(summary.average ?? 0, locale)}
                          </span>
                        ) : null}
                      </td>
                    );
                  }
                  return (
                    <td key={p.id} className={`border-t border-line px-3 py-1.5 ${sticky}`}>
                      {index === 0 ? plural(dict.counts.rows, rows.length) : null}
                    </td>
                  );
                })}
                <td className="border-t border-line" />
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
