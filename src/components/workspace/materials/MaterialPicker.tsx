"use client";

import { useRef, useState } from "react";
import { ClipboardPaste, FileText, Trash2, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { MAX_MATERIAL_UPLOAD_BYTES, MAX_MATERIALS_PER_WORKSPACE } from "@/lib/materials/limits";
import type { MaterialSummary } from "@/lib/materials/types";
import { cn } from "@/lib/utils";
import { MaterialApiError, deleteMaterial, pasteMaterial, uploadMaterial } from "./api";
import { materialErrorMessage } from "./messages";

/**
 * The workspace's study material: pick one, add one (upload or paste), or
 * delete one (after a confirmation that says what deleting does).
 */
export function MaterialPicker({
  workspaceId,
  materials,
  selectedId,
  onSelect,
  onAdded,
  onDeleted,
  disabled,
}: {
  workspaceId: string;
  materials: MaterialSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdded: (material: MaterialSummary) => void;
  onDeleted: (id: string) => void;
  disabled?: boolean;
}) {
  const { dict, t, plural } = useI18n();
  const M = dict.materials;
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (file.size > MAX_MATERIAL_UPLOAD_BYTES) {
      setError(M.errors.tooLarge);
      return;
    }
    setBusy(t(M.uploading, { name: file.name }));
    try {
      onAdded(await uploadMaterial(workspaceId, file));
    } catch (cause) {
      setError(materialErrorMessage(cause, dict));
    } finally {
      setBusy(null);
    }
  };

  const addPasted = async () => {
    setError(null);
    const title = pasteTitle.trim() || M.untitledPaste;
    if (pasteText.trim().length < 20) {
      setError(M.errors.noText);
      return;
    }
    setBusy(M.saving);
    try {
      onAdded(await pasteMaterial({ workspaceId, title, text: pasteText }));
      setPasting(false);
      setPasteTitle("");
      setPasteText("");
    } catch (cause) {
      setError(materialErrorMessage(cause, dict));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (material: MaterialSummary) => {
    setError(null);
    setBusy(M.deleting);
    try {
      await deleteMaterial(material.id);
      onDeleted(material.id);
    } catch (cause) {
      // Already gone counts as deleted.
      if (cause instanceof MaterialApiError && cause.code === "not_found") onDeleted(material.id);
      else setError(materialErrorMessage(cause, dict));
    } finally {
      setConfirmId(null);
      setBusy(null);
    }
  };

  const locked = disabled || busy !== null;
  const full = materials.length >= MAX_MATERIALS_PER_WORKSPACE;

  return (
    <section aria-labelledby="materials-heading" className="flex flex-col gap-2">
      <h3 id="materials-heading" className="text-sm font-semibold text-ink">
        {M.yourMaterials}
      </h3>

      {materials.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-ink-soft">
          {M.noMaterials}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" role="radiogroup" aria-labelledby="materials-heading">
          {materials.map((material) => {
            const selected = material.id === selectedId;
            const confirming = confirmId === material.id;
            return (
              <li
                key={material.id}
                className={cn(
                  "rounded-lg border bg-card transition",
                  selected ? "border-lime ring-1 ring-lime" : "border-line",
                )}
              >
                <div className="flex items-center gap-1">
                  <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2">
                    <input
                      type="radio"
                      name="study-material"
                      checked={selected}
                      disabled={locked}
                      onChange={() => onSelect(material.id)}
                      className="size-4 shrink-0 accent-[var(--lime)]"
                    />
                    <FileText className="size-4 shrink-0 text-ink-soft" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink" dir="auto">
                        {material.title}
                      </span>
                      <span className="block text-xs text-ink-soft">
                        {M.kind[material.kind]} ·{" "}
                        {plural(dict.counts.pages, material.pageCount)}
                        {material.truncated ? ` · ${plural(M.truncatedNote, material.pageCount)}` : ""}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setConfirmId(confirming ? null : material.id)}
                    disabled={locked}
                    aria-label={t(M.deleteAria, { title: material.title })}
                    aria-expanded={confirming}
                    className="me-1 grid size-11 shrink-0 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-rose-600 disabled:opacity-40"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
                {confirming && (
                  <div role="alert" className="flex flex-col gap-2 border-t border-line px-3 py-2.5 sm:flex-row sm:items-center">
                    <p className="min-w-0 flex-1 text-xs text-ink">{t(M.confirmDelete, { title: material.title })}</p>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="min-h-11 rounded-lg border border-line-strong bg-card px-3 text-xs font-semibold text-ink transition hover:bg-hover sm:min-h-9"
                      >
                        {M.keep}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(material)}
                        className="min-h-11 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white transition hover:bg-rose-700 sm:min-h-9"
                      >
                        {M.delete}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pasting ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
            {M.pasteTitle}
            <input
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder={M.pasteTitlePlaceholder}
              maxLength={120}
              dir="auto"
              className="min-h-11 rounded-lg border border-line bg-card px-3 text-base font-normal text-ink outline-none placeholder:text-ink-soft/50 focus:border-ink/30 sm:text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
            {M.pasteText}
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={M.pastePlaceholder}
              rows={6}
              dir="auto"
              className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-base font-normal text-ink outline-none placeholder:text-ink-soft/50 focus:border-ink/30 sm:text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPasting(false)}
              disabled={locked}
              className="min-h-11 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover"
            >
              {M.cancelPaste}
            </button>
            <button
              type="button"
              onClick={() => void addPasted()}
              disabled={locked || pasteText.trim().length === 0}
              className="min-h-11 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep disabled:opacity-40"
            >
              {M.addPasted}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={locked || full}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-40"
          >
            <Upload className="size-4" aria-hidden />
            {M.upload}
          </button>
          <button
            type="button"
            onClick={() => setPasting(true)}
            disabled={locked || full}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover disabled:opacity-40"
          >
            <ClipboardPaste className="size-4" aria-hidden />
            {M.paste}
          </button>
        </div>
      )}
      <p className="text-xs text-ink-soft">{full ? t(M.errors.limit, { max: MAX_MATERIALS_PER_WORKSPACE }) : M.limitsHint}</p>
      <p role="status" aria-live="polite" className="text-sm text-ink-soft empty:hidden">
        {busy ?? ""}
      </p>
      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </section>
  );
}
