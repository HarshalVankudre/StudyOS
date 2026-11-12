"use client";

import type { ReactNode } from "react";
import type { CellValue, Database, DatabaseRow, DatabaseView as DBView } from "@/lib/workspace/types";
import { useI18n } from "@/lib/i18n/client";
import type { DbActions } from "./actions";

/** What every view body (table, list, gallery, board, calendar) receives. */
export interface ViewBodyProps {
  db: Database;
  view: DBView;
  /** The view's rows after filters, search and sorts. */
  rows: DatabaseRow[];
  actions: DbActions;
  /** Open the row detail sheet. */
  onOpen: (rowId: string) => void;
  /** Add a row (pre-filled to match the view) and return its id. */
  onAdd: (cells?: Record<string, CellValue>) => string;
  /** Shown instead of rows when the view is empty. */
  empty: ReactNode;
}

export function isEmptyValue(value: CellValue | undefined): boolean {
  return value === null || value === undefined || value === "" || value === false || (Array.isArray(value) && value.length === 0);
}

export function ShowMore({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  const { dict, plural } = useI18n();
  if (remaining <= 0) return null;
  return (
    <button
      type="button"
      onClick={onMore}
      className="min-h-10 w-full border-t border-line px-3 py-2 text-sm text-ink-soft transition hover:bg-hover hover:text-ink"
    >
      {plural(dict.counts.showMore, remaining)}
    </button>
  );
}

export function AddRowButton({ onClick, label, className = "" }: { onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 w-full px-3 py-2 text-start text-sm text-ink-faint transition hover:bg-hover hover:text-ink-soft ${className}`}
    >
      {label}
    </button>
  );
}
