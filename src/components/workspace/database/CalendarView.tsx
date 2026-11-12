"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { DatabaseRow } from "@/lib/workspace/types";
import { pillClasses } from "@/lib/workspace/colors";
import { titleProperty } from "@/lib/workspace/helpers";
import { completionField, isRowComplete, monthGrid } from "@/lib/workspace/view-logic";
import { useI18n } from "@/lib/i18n/client";
import type { ViewBodyProps } from "./parts";
import { formatDay, rowAccent, rowTitle, useToday, weekStartFor } from "./shared";
import { TableView } from "./TableView";

type Cursor = { year: number; month0: number };

/**
 * Month calendar on a date field. Opens on the current month, has a Today
 * button and marks today. On a phone the cramped grid is replaced by an
 * agenda of the month's days that have something on them.
 */
export function CalendarView(props: ViewBodyProps) {
  const { db, view, rows, actions, onOpen, onAdd } = props;
  const { dict, t, locale } = useI18n();
  const today = useToday();
  // null = follow today's month (so it also rolls over at midnight).
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const completion = useMemo(() => completionField(db), [db]);

  const dateProp = db.properties.find((p) => p.id === view.datePropertyId && p.type === "date");
  const byDay = useMemo(() => {
    const map = new Map<string, DatabaseRow[]>();
    if (!dateProp) return map;
    for (const row of rows) {
      const day = row.cells[dateProp.id];
      if (typeof day !== "string") continue;
      const list = map.get(day);
      if (list) list.push(row);
      else map.set(day, [row]);
    }
    return map;
  }, [rows, dateProp]);

  if (!dateProp) return <TableView {...props} />;
  if (!today) return <div className="min-h-64 rounded-md border border-line bg-card" aria-busy />;

  const title = titleProperty(db);
  const [ty, tm] = today.split("-").map(Number);
  const { year, month0 } = cursor ?? { year: ty, month0: tm - 1 };
  const isCurrentMonth = year === ty && month0 === tm - 1;
  const weekStart = weekStartFor(locale);
  const cells = monthGrid(year, month0, weekStart);
  const monthDays = cells.filter((c): c is string => c !== null);

  const move = (delta: number) => {
    const total = month0 + delta;
    setCursor({ year: year + Math.floor(total / 12), month0: ((total % 12) + 12) % 12 });
  };
  const addOn = (day: string) => onOpen(onAdd({ [dateProp.id]: day, [title.id]: "" }));
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    // 2024-01-07 was a Sunday.
    formatDay(`2024-01-${String(7 + ((i + weekStart) % 7)).padStart(2, "0")}`, locale, { weekday: "short" }),
  );
  const monthLabel = formatDay(`${year}-${String(month0 + 1).padStart(2, "0")}-01`, locale, {
    month: "long",
    year: "numeric",
  });
  const agendaDays = monthDays.filter((d) => byDay.has(d) || d === today);

  const eventButton = (r: DatabaseRow, compact: boolean) => {
    const name = rowTitle(db, r);
    const done = isRowComplete(db, r, completion);
    return (
      <button
        key={r.id}
        type="button"
        draggable={compact}
        onDragStart={(e) => {
          dragId.current = r.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", r.id);
        }}
        onDragEnd={() => {
          dragId.current = null;
          setOverKey(null);
        }}
        onClick={() => onOpen(r.id)}
        aria-label={t(dict.dbViews.openRow, { name: name || dict.db.untitled })}
        dir="auto"
        className={`block w-full truncate rounded text-start font-medium ring-1 ring-inset ${pillClasses(rowAccent(db, r))} ${
          compact ? "px-1.5 py-0.5 text-[11px]" : "min-h-10 px-3 py-2 text-sm"
        } ${done ? "line-through opacity-60" : ""}`}
      >
        {name || dict.db.untitled}
      </button>
    );
  };

  return (
    <div className="rounded-md border border-line bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h3 className="font-display text-[15px] font-bold text-ink" aria-live="polite">
          {monthLabel}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor(null)}
            disabled={isCurrentMonth}
            className="min-h-9 rounded-md border border-line px-2.5 text-sm text-ink-soft transition hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            {dict.dbViews.today}
          </button>
          <button
            type="button"
            onClick={() => move(-1)}
            className="grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-hover"
            aria-label={dict.db.prevMonth}
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            className="grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-hover"
            aria-label={dict.db.nextMonth}
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </button>
        </div>
      </div>

      {/* Month grid: tablets and up. */}
      <div className="hidden sm:block" data-testid="calendar-grid">
        <div className="grid grid-cols-7 border-b border-line bg-surface text-center font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
          {weekdays.map((w, i) => (
            <div key={i} className="py-1.5">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const isOver = day !== null && overKey === day;
            const isToday = day === today;
            const events = day ? byDay.get(day) ?? [] : [];
            return (
              <div
                key={i}
                aria-current={isToday ? "date" : undefined}
                onDragOver={
                  day
                    ? (e) => {
                        e.preventDefault();
                        if (overKey !== day) setOverKey(day);
                      }
                    : undefined
                }
                onDragLeave={day ? () => setOverKey((k) => (k === day ? null : k)) : undefined}
                onDrop={
                  day
                    ? (e) => {
                        e.preventDefault();
                        if (dragId.current) actions.setCell(dragId.current, dateProp.id, day);
                        dragId.current = null;
                        setOverKey(null);
                      }
                    : undefined
                }
                className={`min-h-[92px] min-w-0 border-b border-e border-line p-1 [&:nth-child(7n)]:border-e-0 ${
                  isOver ? "bg-lime/10" : isToday ? "bg-lime-faint/40" : ""
                }`}
              >
                {day && (
                  <>
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs ${
                          isToday ? "bg-lime font-semibold text-lime-on" : "text-ink-faint"
                        }`}
                      >
                        {Number(day.slice(8))}
                      </span>
                      <button
                        type="button"
                        onClick={() => addOn(day)}
                        aria-label={t(dict.dbViews.addOnDate, { date: formatDay(day, locale, { dateStyle: "medium" }) })}
                        className="grid h-6 w-6 place-items-center rounded text-ink-faint/70 transition hover:bg-hover hover:text-ink"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                    <div className="space-y-1">{events.map((r) => eventButton(r, true))}</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Agenda: phones. */}
      <div className="sm:hidden" data-testid="calendar-agenda">
        {agendaDays.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-faint">{dict.dbViews.nothingThisMonth}</p>
        ) : (
          <ol className="divide-y divide-line">
            {agendaDays.map((day) => {
              const isToday = day === today;
              const events = byDay.get(day) ?? [];
              return (
                <li key={day} aria-current={isToday ? "date" : undefined} className="px-3 py-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className={`text-xs font-medium ${isToday ? "text-lime" : "text-ink-soft"}`}>
                      {formatDay(day, locale, { weekday: "short", day: "numeric", month: "short" })}
                      {isToday && <span className="ms-1.5">· {dict.dbViews.today}</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => addOn(day)}
                      aria-label={t(dict.dbViews.addOnDate, { date: formatDay(day, locale, { dateStyle: "medium" }) })}
                      className="grid h-9 w-9 place-items-center rounded-md text-ink-faint hover:bg-hover hover:text-ink"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {events.length > 0 && <div className="space-y-1.5">{events.map((r) => eventButton(r, false))}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
