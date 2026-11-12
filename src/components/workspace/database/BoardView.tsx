"use client";

import { useId, useMemo, useRef, useState } from "react";
import { GripVertical, Maximize2, Trash2 } from "lucide-react";
import type { DatabaseRow } from "@/lib/workspace/types";
import { pillClasses } from "@/lib/workspace/colors";
import { titleProperty } from "@/lib/workspace/helpers";
import { completionField, isRowComplete } from "@/lib/workspace/view-logic";
import { useI18n } from "@/lib/i18n/client";
import { DraftInput } from "../editor/DraftInput";
import { EditableCell } from "./cells";
import { ShowMore, type ViewBodyProps } from "./parts";
import { BOARD_PAGE_SIZE, rowTitle, visibleProps } from "./shared";
import { TableView } from "./TableView";

const NONE = "__none__";
const CARD_BUTTON =
  "grid h-8 w-8 shrink-0 place-items-center rounded text-ink-faint/80 transition hover:bg-hover hover:text-ink";

/**
 * Kanban board grouped by a select/status field. Cards move by drag on a
 * desktop, or with the "Move to" menu on each card (touch and keyboard).
 */
export function BoardView(props: ViewBodyProps) {
  const { db, view, rows, actions, onOpen, onAdd } = props;
  const { dict, t, plural } = useI18n();
  const [overOpt, setOverOpt] = useState<string | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const dragId = useRef<string | null>(null);
  const baseId = useId();
  const completion = useMemo(() => completionField(db), [db]);

  const groupProp = db.properties.find((p) => p.id === view.groupByPropertyId);
  if (!groupProp?.options || (groupProp.type !== "select" && groupProp.type !== "status")) {
    return <TableView {...props} />;
  }

  const title = titleProperty(db);
  const fieldProps = visibleProps(db, view).filter((p) => p.id !== groupProp.id && p.id !== title.id);
  const optionIds = new Set(groupProp.options.map((o) => o.id));

  const columns = new Map<string, DatabaseRow[]>([[NONE, []], ...groupProp.options.map((o) => [o.id, []] as [string, DatabaseRow[]])]);
  for (const row of rows) {
    const value = row.cells[groupProp.id];
    columns.get(typeof value === "string" && optionIds.has(value) ? value : NONE)!.push(row);
  }
  const groups = [
    ...(columns.get(NONE)!.length > 0
      ? [{ id: NONE, label: t(dict.dbViews.noValue, { name: groupProp.name }), color: undefined as string | undefined }]
      : []),
    ...groupProp.options,
  ];

  const moveTo = (rowId: string, optId: string) =>
    actions.setCell(rowId, groupProp.id, optId === NONE ? null : optId);

  const dropInto = (optId: string) => {
    if (dragId.current) moveTo(dragId.current, optId);
    dragId.current = null;
    setOverOpt(null);
  };

  return (
    <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
      {groups.map((opt) => {
        const columnRows = columns.get(opt.id) ?? [];
        const limit = limits[opt.id] ?? BOARD_PAGE_SIZE;
        const isOver = overOpt === opt.id;
        const headingId = `${baseId}-${opt.id}`;
        return (
          <section
            key={opt.id}
            aria-labelledby={headingId}
            onDragOver={(e) => {
              e.preventDefault();
              if (overOpt !== opt.id) setOverOpt(opt.id);
            }}
            onDragLeave={() => setOverOpt((o) => (o === opt.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              dropInto(opt.id);
            }}
            className={`w-[80vw] max-w-72 shrink-0 snap-start rounded-md p-1 transition sm:w-64 ${
              isOver ? "bg-lime/10 ring-2 ring-lime/40" : ""
            }`}
          >
            <h3 id={headingId} className="mb-2 flex items-center gap-2 px-1">
              <span dir="auto" className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${pillClasses(opt.color)}`}>
                {opt.label}
              </span>
              <span className="text-xs tabular-nums text-ink-faint" aria-label={plural(dict.counts.items, columnRows.length)}>
                {columnRows.length}
              </span>
            </h3>
            <ul className="space-y-2">
              {columnRows.slice(0, limit).map((r) => {
                const name = rowTitle(db, r) || dict.db.untitled;
                const done = isRowComplete(db, r, completion);
                const current = r.cells[groupProp.id];
                return (
                  <li key={r.id} className="rounded-md border border-line bg-card p-2 shadow-sm">
                    <div className="flex items-start gap-0.5">
                      <span
                        draggable
                        onDragStart={(e) => {
                          dragId.current = r.id;
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", r.id);
                        }}
                        onDragEnd={() => {
                          dragId.current = null;
                          setOverOpt(null);
                        }}
                        title={dict.db.dragHint}
                        aria-hidden
                        className="mt-1.5 hidden cursor-grab select-none text-ink-faint/60 hover:text-ink-soft active:cursor-grabbing sm:block"
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <DraftInput
                        value={rowTitle(db, r)}
                        dir="auto"
                        onCommit={(text) => {
                          if (text !== rowTitle(db, r)) actions.setCell(r.id, title.id, text);
                        }}
                        placeholder={dict.db.untitled}
                        aria-label={title.name}
                        className="min-h-8 min-w-0 flex-1 rounded bg-transparent px-1 text-sm font-medium text-ink outline-none focus:bg-hover"
                      />
                      <button
                        type="button"
                        onClick={() => onOpen(r.id)}
                        aria-label={t(dict.dbViews.openRow, { name })}
                        className={CARD_BUTTON}
                      >
                        <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => actions.deleteRow(r.id)}
                        aria-label={t(dict.dbViews.deleteNamed, { name })}
                        className={`${CARD_BUTTON} hover:text-rose-500`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                    <label className="mt-1.5 flex items-center gap-2 px-1 text-xs">
                      <span className="w-16 shrink-0 truncate text-ink-faint">{groupProp.name}</span>
                      <select
                        value={typeof current === "string" && optionIds.has(current) ? current : NONE}
                        onChange={(e) => moveTo(r.id, e.target.value)}
                        aria-label={t(dict.dbViews.moveCardTo, { name })}
                        className="min-h-8 min-w-0 flex-1 rounded border border-line bg-card px-1.5 text-xs text-ink-soft outline-none focus:border-ink/40"
                      >
                        <option value={NONE}>{t(dict.dbViews.noValue, { name: groupProp.name })}</option>
                        {groupProp.options!.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {fieldProps.length > 0 && (
                      <div className="mt-1.5 space-y-1 px-1">
                        {fieldProps.map((p) => (
                          <div key={p.id} className="flex items-center gap-2 text-xs">
                            <span className="w-16 shrink-0 truncate text-ink-faint"><bdi>{p.name}</bdi></span>
                            <div className="min-w-0 flex-1">
                              <EditableCell
                                databaseId={db.id}
                                rowId={r.id}
                                prop={p}
                                value={r.cells[p.id] ?? null}
                                complete={done}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {columnRows.length > limit && (
              <div className="mt-2 overflow-hidden rounded-md border border-line bg-card">
                <ShowMore
                  remaining={columnRows.length - limit}
                  onMore={() => setLimits((l) => ({ ...l, [opt.id]: limit + BOARD_PAGE_SIZE }))}
                />
              </div>
            )}
            <button
              type="button"
              data-print="hide"
              onClick={() => onAdd(opt.id === NONE ? {} : { [groupProp.id]: opt.id })}
              className="mt-2 min-h-10 w-full rounded-md border border-dashed border-line px-3 py-2 text-start text-xs text-ink-faint transition hover:border-line-strong hover:text-ink-soft"
            >
              {dict.db.newCard}
            </button>
          </section>
        );
      })}
    </div>
  );
}
