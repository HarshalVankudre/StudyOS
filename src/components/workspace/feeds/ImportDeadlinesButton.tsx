"use client";

import { useState } from "react";
import { CalendarArrowDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Database } from "@/lib/workspace/types";
import { ImportDeadlinesDialog } from "./ImportDeadlinesDialog";

/**
 * "Import deadlines" in a database toolbar. A dot (and the label) tells the
 * student when imported rows vanished from their calendar and need a look.
 */
export function ImportDeadlinesButton({ db }: { db: Database }) {
  const { dict, t } = useI18n();
  const [open, setOpen] = useState(false);
  const flagged = db.rows.reduce((n, r) => (r.source?.missingSince ? n + 1 : n), 0);
  const label = flagged ? t(dict.feeds.buttonFlagged, { count: flagged }) : dict.feeds.button;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
        className="relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-ink-soft transition hover:bg-hover hover:text-ink"
      >
        <CalendarArrowDown className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">{dict.feeds.button}</span>
        {flagged > 0 && (
          <span className="absolute end-1 top-1 h-2 w-2 rounded-full bg-amber-500 sm:static sm:h-1.5 sm:w-1.5" aria-hidden />
        )}
      </button>
      {open && <ImportDeadlinesDialog db={db} onClose={() => setOpen(false)} />}
    </>
  );
}
