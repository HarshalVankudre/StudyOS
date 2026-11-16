"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, FileArchive, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { NOTION_IMPORT_LIMITS, type SkipReason } from "@/lib/import/notion/limits";
import { MAX_WORKSPACE_BYTES } from "@/lib/workspace/repair";
import { cn } from "@/lib/utils";
import { uploadNotionExport, type NotionImportDone } from "./notion-upload";

type Phase =
  | { kind: "pick" }
  | { kind: "sending"; progress: number }
  | { kind: "building" }
  | { kind: "done"; result: NotionImportDone };

interface ImportError {
  code: string;
  max?: number;
}

const ERROR_CODES = new Set([
  "invalid",
  "not_zip",
  "not_notion",
  "too_large",
  "too_many_files",
  "unsafe",
  "encrypted",
  "corrupt",
  "timeout",
  "busy",
  "rate_limited",
  "network",
  "failed",
]);

/**
 * "Import from Notion": short export instructions, a drop zone for the
 * .zip, upload progress, then what was imported (and what was not) with a
 * way into the new workspace. Opened from the home page and the command
 * palette (NotionImportHost).
 */
export function NotionImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { dict, t, locale } = useI18n();
  const N = dict.notionImport;
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<ImportError | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const ids = useId();
  const errorId = `${ids}-error`;

  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  const megabytes = (n: number) =>
    new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", unitDisplay: "short", maximumFractionDigits: 1 }).format(n);
  const uploadLimit = megabytes(NOTION_IMPORT_LIMITS.maxUploadBytes / (1024 * 1024));
  const busy = phase.kind === "sending" || phase.kind === "building";

  const errorText = (e: ImportError): string => {
    if (e.code === "workspace_limit") return t(dict.limits.workspaceCap, { max: e.max === undefined ? "" : number(e.max) });
    if (e.code === "too_large") return t(N.errors.too_large, { size: uploadLimit });
    if (e.code === "too_many_files") return t(N.errors.too_many_files, { max: number(NOTION_IMPORT_LIMITS.maxEntries) });
    const code = ERROR_CODES.has(e.code) ? (e.code as keyof typeof N.errors) : "failed";
    return N.errors[code];
  };

  const reasonText = (reason: SkipReason): string => {
    const L = NOTION_IMPORT_LIMITS;
    const max: Partial<Record<SkipReason, number>> = {
      page_limit: L.maxPages,
      database_limit: L.maxDatabases,
      row_limit: L.maxRowsPerDatabase,
      column_limit: L.maxColumns,
    };
    return t(N.reasons[reason], {
      max: max[reason] === undefined ? "" : number(max[reason]),
      size: megabytes(MAX_WORKSPACE_BYTES / 1_000_000),
    });
  };

  const choose = (picked: File | undefined) => {
    setError(null);
    if (!picked) return;
    if (!/\.zip$/i.test(picked.name) && !/zip/i.test(picked.type)) {
      setFile(null);
      setError({ code: "not_zip" });
      return;
    }
    if (picked.size > NOTION_IMPORT_LIMITS.maxUploadBytes) {
      setFile(null);
      setError({ code: "too_large" });
      return;
    }
    setFile(picked);
  };

  const start = async () => {
    if (!file || busy) return;
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: "sending", progress: 0 });
    const result = await uploadNotionExport(file, {
      signal: controller.signal,
      onProgress: (progress) => setPhase((p) => (p.kind === "sending" ? { kind: "sending", progress } : p)),
      onSent: () => setPhase((p) => (p.kind === "sending" ? { kind: "building" } : p)),
    });
    abort.current = null;
    if (result.ok) {
      setPhase({ kind: "done", result: result.data });
      // The home page lists the new workspace.
      router.refresh();
      return;
    }
    setPhase({ kind: "pick" });
    if (result.code !== "aborted") setError({ code: result.code, max: result.max });
  };

  const close = () => {
    // While the server builds the workspace there is nothing to cancel: it
    // will exist either way, so the dialog stays to say where it is.
    if (phase.kind === "building") return;
    abort.current?.abort();
    onOpenChange(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    choose(event.dataTransfer.files?.[0]);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-5 overflow-y-auto rounded-3xl border-line bg-card p-5 text-ink sm:max-w-lg sm:p-7">
        {phase.kind === "done" ? (
          <Done
            result={phase.result}
            onOpen={() => {
              onOpenChange(false);
              router.push(`/app/${encodeURIComponent(phase.result.workspaceId)}`);
            }}
            onClose={() => onOpenChange(false)}
            reasonText={reasonText}
            number={number}
          />
        ) : (
          <>
            <div className="pe-8">
              <DialogTitle className="font-display text-2xl font-bold text-ink">{N.title}</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-ink-soft">{N.description}</DialogDescription>
            </div>

            <section aria-labelledby={`${ids}-steps`} className="rounded-2xl bg-paper p-4">
              <h3 id={`${ids}-steps`} className="font-display text-base font-semibold text-ink">
                {N.stepsTitle}
              </h3>
              <ol className="mt-3 flex flex-col gap-2.5">
                {[N.step1, N.step2, N.step3].map((step, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-ink-soft">
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-matcha text-xs font-semibold tabular-nums text-ink"
                    >
                      {number(i + 1)}
                    </span>
                    <span className="min-w-0 pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </section>

            <div
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              data-testid="notion-drop-zone"
              className={cn(
                "flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-4 py-6 text-center transition",
                dragging ? "border-ink bg-hover" : "border-line-strong bg-paper",
              )}
            >
              <span className="grid h-11 w-11 place-items-center rounded-full bg-cloud text-ink" aria-hidden>
                <FileArchive className="h-5 w-5" />
              </span>
              {file ? (
                <p className="max-w-full break-words text-sm font-semibold text-ink" dir="auto">
                  {t(N.selected, { name: file.name })}
                </p>
              ) : (
                <p className="text-sm font-semibold text-ink">{N.dropTitle}</p>
              )}
              <input
                ref={input}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                className="sr-only"
                tabIndex={-1}
                aria-label={N.choose}
                onChange={(event) => {
                  choose(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => input.current?.click()}
                className="min-h-11 rounded-full border border-line-strong bg-card px-5 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-50"
              >
                {file ? N.change : N.choose}
              </button>
              <p className="text-xs text-ink-faint">{t(N.fileHint, { size: uploadLimit })}</p>
            </div>

            {busy && (
              <div className="flex flex-col gap-2" role="status" aria-live="polite">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {phase.kind === "sending"
                    ? t(N.uploading, {
                        percent: new Intl.NumberFormat(locale, { style: "percent" }).format(phase.progress),
                      })
                    : N.building}
                </p>
                <div
                  role="progressbar"
                  aria-label={N.title}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={phase.kind === "sending" ? Math.round(phase.progress * 100) : undefined}
                  className="h-2 overflow-hidden rounded-full bg-cloud"
                >
                  <div
                    className={cn("h-full rounded-full bg-ink transition-[width]", phase.kind === "building" && "animate-pulse")}
                    style={{ width: `${phase.kind === "sending" ? Math.max(4, phase.progress * 100) : 100}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <p id={errorId} role="alert" className="rounded-2xl bg-heather px-4 py-3 text-sm text-ink">
                {errorText(error)}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
              <button
                type="button"
                onClick={close}
                disabled={phase.kind === "building"}
                className="min-h-11 rounded-full border border-line-strong bg-card px-5 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-50"
              >
                {N.cancel}
              </button>
              <button
                type="button"
                onClick={() => void start()}
                disabled={!file || busy}
                aria-describedby={error ? errorId : undefined}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-lime px-6 text-sm font-semibold text-lime-on transition hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {N.start}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What was imported, what was not, and the way into the new workspace. */
function Done({
  result,
  onOpen,
  onClose,
  reasonText: reason,
  number: num,
}: {
  result: NotionImportDone;
  onOpen: () => void;
  onClose: () => void;
  reasonText: (r: SkipReason) => string;
  number: (n: number) => string;
}) {
  const { dict, t, plural, locale } = useI18n();
  const N = dict.notionImport;
  const ids = useId();
  const s = result.summary;
  const list = (items: string[]) => {
    try {
      return new Intl.ListFormat(locale, { style: "short", type: "unit" }).format(items);
    } catch {
      return items.join(", ");
    }
  };
  const stats: { label: string; tint: string }[] = [
    { label: plural(dict.counts.pages, s.pages), tint: "bg-matcha" },
    { label: plural(N.tables, s.databases), tint: "bg-cloud" },
    { label: plural(dict.counts.rows, s.rows), tint: "bg-heather" },
    ...(s.images > 0 ? [{ label: plural(N.images, s.images), tint: "bg-oat" }] : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 pe-8">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-matcha text-ink" aria-hidden>
          <Check className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <DialogTitle className="font-display text-2xl font-bold text-ink">{N.doneTitle}</DialogTitle>
          <DialogDescription className="mt-1 break-words text-sm text-ink-soft">
            {t(N.doneBody, { name: result.name })}
          </DialogDescription>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <li key={stat.label} className={cn("rounded-2xl px-4 py-3 text-sm font-semibold text-ink", stat.tint)}>
            {stat.label}
          </li>
        ))}
      </ul>

      {s.skipped.length > 0 && (
        <section aria-labelledby={`${ids}-skipped`} className="flex flex-col gap-2">
          <h3 id={`${ids}-skipped`} className="font-display text-lg font-semibold text-ink">
            {N.skippedTitle}
          </h3>
          <p className="text-sm text-ink-soft">{N.skippedHint}</p>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {s.skipped.map((item) => (
              <li key={item.reason} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{reason(item.reason)}</p>
                  {item.examples.length > 0 && (
                    <p className="mt-0.5 break-words text-xs text-ink-faint" dir="auto">
                      {list(item.examples)}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-oat px-2.5 py-0.5 text-xs font-semibold tabular-nums text-ink">
                  {num(item.count)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-full border border-line-strong bg-card px-5 text-sm font-semibold text-ink transition hover:bg-hover"
        >
          {N.close}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="min-h-11 rounded-full bg-lime px-6 text-sm font-semibold text-lime-on transition hover:bg-lime-hover"
        >
          {N.open}
        </button>
      </div>
    </div>
  );
}
