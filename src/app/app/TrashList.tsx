"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { deleteWorkspaceForeverAction, restoreWorkspaceAction } from "./actions";

export interface TrashItem {
  id: string;
  name: string;
  icon: string | null;
  /** ISO date when the workspace will be deleted for good. */
  purgeAt: string;
}

/**
 * The workspace trash: restore within 30 days, or delete forever (confirmed).
 * Collapsed by default so it stays out of the way.
 */
export function TrashList({ items }: { items: TrashItem[] }) {
  const { dict, t, locale } = useI18n();
  const S = dict.safety;
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (items.length === 0) return null;

  const run = (id: string, work: () => Promise<boolean>, done: string) => {
    setBusyId(id);
    startTransition(async () => {
      const ok = await work().catch(() => false);
      setBusyId(null);
      if (!ok) {
        toast.error(S.actionFailed);
        return;
      }
      router.refresh();
      toast(done);
    });
  };

  return (
    <details className="group mt-10 rounded-md border border-line bg-card shadow-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink [&::-webkit-details-marker]:hidden">
        <Trash2 className="h-4 w-4" aria-hidden />
        {t(S.trashCount, { count: items.length })}
        <span className="ms-auto text-ink-faint transition group-open:rotate-90 rtl:-scale-x-100" aria-hidden>
          ›
        </span>
      </summary>
      <div className="border-t border-line px-5 py-3">
        <p className="text-xs text-ink-soft">{S.trashHint}</p>
        <ul className="mt-2 divide-y divide-line">
          {items.map((item) => {
            const busy = busyId === item.id;
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-lg">
                  {item.icon ?? dict.app.fallbackIcon}
                </span>
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate text-sm font-semibold text-ink">{item.name}</p>
                  <p className="font-mono text-[11px] text-ink-faint">
                    {t(S.purgeOn, {
                      date: new Date(item.purgeAt).toLocaleDateString(locale, { dateStyle: "medium" }),
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t(S.restoreAria, { name: item.name })}
                    onClick={() =>
                      run(
                        item.id,
                        () => restoreWorkspaceAction(item.id),
                        t(S.restored, { name: item.name }),
                      )
                    }
                    className="flex min-h-11 items-center gap-1.5 rounded-md border border-line-strong bg-card px-3 text-xs font-semibold text-ink transition hover:bg-hover disabled:opacity-40 sm:min-h-0 sm:py-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    {S.restore}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t(S.deleteForeverAria, { name: item.name })}
                    onClick={() => {
                      const ok = window.confirm(
                        t(S.deleteForeverConfirm, { name: item.name }),
                      );
                      if (!ok) return;
                      run(
                        item.id,
                        () => deleteWorkspaceForeverAction(item.id),
                        S.deletedForever,
                      );
                    }}
                    className="flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-40 sm:min-h-0 sm:py-1.5"
                  >
                    {S.deleteForever}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
