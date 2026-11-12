"use client";

import { X } from "lucide-react";
import { Fragment } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { SHORTCUT_GROUPS, keyLabel } from "./shortcuts";

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink shadow-[inset_0_-1px_0_var(--line-strong)]">
      {children}
    </kbd>
  );
}

/** The "?" help sheet: every keyboard shortcut StudyOS has, grouped. */
export function ShortcutSheet({
  open,
  onOpenChange,
  apple,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apple: boolean;
}) {
  const { dict } = useI18n();
  const S = dict.shortcuts;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden border-line-strong bg-card p-0 text-ink sm:max-w-2xl"
      >
        <div className="flex items-start gap-3 border-b border-line px-4 py-3.5 sm:px-6">
          <div className="min-w-0 flex-1">
            <DialogTitle className="font-display text-lg font-bold">{S.title}</DialogTitle>
            <DialogDescription className="mt-0.5 text-sm text-ink-soft">{S.description}</DialogDescription>
          </div>
          <DialogClose
            aria-label={S.close}
            className="-me-2 grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </DialogClose>
        </div>
        <div className="grid gap-x-8 gap-y-6 overflow-y-auto px-4 py-4 sm:grid-cols-2 sm:px-6 sm:py-5">
          {SHORTCUT_GROUPS.map(({ group, items }) => (
            <section key={group} aria-labelledby={`shortcut-group-${group}`}>
              <h3
                id={`shortcut-group-${group}`}
                className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-faint"
              >
                {S.groups[group]}
              </h3>
              <dl className="space-y-1.5">
                {items.map((def) => (
                  <div key={`${group}-${def.item}`} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="min-w-0 flex-1 text-ink-soft">{S.items[def.item]}</dt>
                    <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1" dir="ltr">
                      {def.keys.map((chord, ci) => (
                        <Fragment key={ci}>
                          {ci > 0 && <span className="px-0.5 text-[11px] text-ink-faint">{def.typed ? "" : S.or}</span>}
                          {chord.map((k, ki) => (
                            <Kbd key={ki}>{def.typed ? k.trimEnd() + "␣" : keyLabel(k, apple)}</Kbd>
                          ))}
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
              {group === "general" && <p className="mt-2 text-xs text-ink-faint">{S.undoNote}</p>}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
