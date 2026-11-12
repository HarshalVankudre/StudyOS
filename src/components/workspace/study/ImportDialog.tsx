"use client";

import { useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import type { Flashcard } from "@/lib/workspace/types";
import { cardsFromPlan, parseDeckText, planImport, type Delimiter, type ImportStatus } from "@/lib/study/transfer";

const MAX_FILE_BYTES = 1_000_000;
const PREVIEW_ROWS = 50;

type DelimiterChoice = Delimiter | "auto";
const CHOICES: DelimiterChoice[] = ["auto", "\t", ",", ";"];

const STATUS_STYLE: Record<ImportStatus, string> = {
  new: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
  duplicate: "bg-hover text-ink-soft ring-line-strong",
  missingSide: "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-300",
  tooLong: "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-300",
  deckFull: "bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:text-rose-300",
};

/**
 * Bring cards in from Quizlet, Anki or a spreadsheet: paste text or pick a
 * file, see a preview of exactly what will happen to every row (new,
 * duplicate, incomplete…), then import the new ones in one step.
 */
export function ImportDialog({
  existing,
  onImport,
  onClose,
}: {
  existing: Flashcard[];
  onImport: (cards: Flashcard[]) => void;
  onClose: () => void;
}) {
  const { dict, t } = useI18n();
  const T = dict.studyTools;
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<DelimiterChoice>("auto");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? parseDeckText(text, { delimiter: choice }) : null), [text, choice]);
  const plan = useMemo(() => (parsed ? planImport(parsed.rows, existing) : []), [parsed, existing]);
  const newCount = plan.filter((r) => r.status === "new").length;
  const skipped = plan.length - newCount;

  const delimiterLabel: Record<DelimiterChoice, string> = {
    auto: T.separatorAuto,
    "\t": T.separatorTab,
    ",": T.separatorComma,
    ";": T.separatorSemicolon,
  };

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError(T.fileTooLarge);
      return;
    }
    if (/\.(apkg|colpkg)$/i.test(file.name)) {
      setFileError(T.apkgNote);
      return;
    }
    setText(await file.text());
  };

  const doImport = () => {
    const cards = cardsFromPlan(plan, () => crypto.randomUUID());
    if (cards.length > 0) onImport(cards);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-3 overflow-hidden p-4 sm:max-w-2xl sm:p-6">
        <DialogTitle className="font-display text-lg font-bold text-ink">{T.importTitle}</DialogTitle>
        <DialogDescription className="text-sm text-ink-soft">{T.importDesc}</DialogDescription>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
            {T.pasteLabel}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={T.pastePlaceholder}
              rows={5}
              dir="auto"
              className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 font-mono text-base font-normal text-ink outline-none placeholder:text-ink-soft/50 focus:border-ink/30 sm:text-sm"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.tsv,.csv,text/plain,text/csv,text/tab-separated-values"
              className="sr-only"
              aria-label={T.uploadFile}
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover"
            >
              <Upload className="size-4" aria-hidden />
              {T.uploadFile}
            </button>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink-soft">
              {T.separator}
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value as DelimiterChoice)}
                className="min-h-11 rounded-lg border border-line-strong bg-card px-2 text-sm text-ink"
              >
                {CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {delimiterLabel[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {fileError && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
              {fileError}
            </p>
          )}
          <p className="text-xs text-ink-soft">{T.apkgNote}</p>

          {parsed && (
            <section aria-label={T.previewTitle} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink">
                {T.previewTitle}{" "}
                <span className="font-normal text-ink-soft">
                  · {t(T.previewSummary, { new: newCount, skipped })}
                </span>
              </h3>
              {parsed.header && <p className="text-xs text-ink-soft">{T.headerSkipped}</p>}
              <ul className="divide-y divide-line rounded-lg border border-line">
                {plan.slice(0, PREVIEW_ROWS).map((row) => (
                  <li key={row.line} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <div className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-2 sm:gap-3">
                      <span className="break-words font-medium text-ink" dir="auto">
                        {row.front || "—"}
                      </span>
                      <span className="break-words text-ink-soft" dir="auto">
                        {row.back || "—"}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_STYLE[row.status]}`}
                    >
                      {T.status[row.status]}
                    </span>
                  </li>
                ))}
              </ul>
              {plan.length > PREVIEW_ROWS && (
                <p className="text-xs text-ink-soft">{t(T.previewMore, { count: plan.length - PREVIEW_ROWS })}</p>
              )}
            </section>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          <button
            onClick={onClose}
            className="min-h-11 rounded-lg border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            {dict.common.cancel}
          </button>
          <button
            onClick={doImport}
            disabled={newCount === 0}
            className="min-h-11 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            {newCount > 0 ? t(T.importButton, { count: newCount }) : T.nothingToImport}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
