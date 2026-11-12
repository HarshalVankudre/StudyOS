"use client";

import { useState } from "react";
import { Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Database, DatabaseView as DBView } from "@/lib/workspace/types";
import { titleProperty } from "@/lib/workspace/helpers";
import { completionField, isRowComplete } from "@/lib/workspace/view-logic";
import { useI18n } from "@/lib/i18n/client";
import { DraftInput } from "../editor/DraftInput";
import type { DbActions } from "./actions";
import { EditableCell } from "./cells";
import { orderedProps, rowTitle } from "./shared";

/**
 * Every field of one row as a form. A bottom sheet on a phone, a centred
 * dialog on larger screens. Edits save as you go, like the table.
 */
export function RowDetail({
  db,
  view,
  rowId,
  actions,
  onClose,
}: {
  db: Database;
  view: DBView;
  rowId: string;
  actions: DbActions;
  onClose: () => void;
}) {
  const { dict, t } = useI18n();
  // The database the sheet was opened from: when its row is deleted here, the
  // row's open button is gone, so focus returns to the view's tab instead.
  const [section] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement?.closest("section") ?? null),
  );
  const returnFocus = () =>
    section?.isConnected ? section.querySelector<HTMLElement>('[aria-pressed="true"], input[type="search"]') : null;
  const row = db.rows.find((r) => r.id === rowId);
  // A just-added row appears on the next render; a removed one closes the sheet.
  if (!row) return null;

  const title = titleProperty(db);
  const done = isRowComplete(db, row, completionField(db));
  const fields = orderedProps(db, view)
    .map((x) => x.prop)
    .filter((p) => p.id !== title.id);
  const name = rowTitle(db, row);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        returnFocus={returnFocus}
        className="top-auto bottom-0 left-0 max-h-[90dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none rounded-t-xl border-line bg-card p-0 sm:top-[50%] sm:bottom-auto sm:left-[50%] sm:max-h-[85vh] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg"
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-card px-4 py-2">
          <DialogTitle className="min-w-0 flex-1 truncate font-mono text-[10px] font-normal uppercase tracking-wider text-ink-faint">
            {db.icon} {db.name} · {dict.dbViews.rowDetails}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            aria-label={dict.dbViews.close}
            className="grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-hover hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <DialogDescription className="sr-only">{name || dict.db.untitled}</DialogDescription>

        <div className="px-4 pt-3 pb-4">
          <DraftInput
            value={name}
            dir="auto"
            onCommit={(text) => {
              if (text !== name) actions.setCell(row.id, title.id, text);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder={dict.db.untitled}
            aria-label={title.name}
            autoFocus={!name}
            className="w-full rounded bg-transparent px-1 py-1 font-display text-xl font-bold text-ink outline-none placeholder:text-ink-faint focus:bg-hover"
          />

          <dl className="mt-3 space-y-2.5">
            {fields.map((p) => (
              <div key={p.id} className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start sm:gap-3">
                <dt className="truncate pt-1 text-xs font-medium text-ink-faint"><bdi>{p.name}</bdi></dt>
                <dd className="min-w-0 text-sm">
                  <EditableCell databaseId={db.id} rowId={row.id} prop={p} value={row.cells[p.id] ?? null} complete={done} />
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 flex justify-end border-t border-line pt-3">
            <button
              type="button"
              onClick={() => {
                actions.deleteRow(row.id);
                onClose();
              }}
              aria-label={t(dict.dbViews.deleteNamed, { name: name || dict.db.untitled })}
              className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-rose-500 transition hover:bg-rose-500/10"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {dict.db.delete}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
