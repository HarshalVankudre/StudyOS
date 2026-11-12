"use client";

import { Copy } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Block, Workspace } from "@/lib/workspace/types";
import { useWorkspace } from "../WorkspaceContext";

const isText = (b: Block | undefined): b is Extract<Block, { text: string }> =>
  !!b && "text" in b && typeof (b as { text?: unknown }).text === "string";

/** In a draft: the page holding block `id`. */
function pageOf(d: Workspace, pageId: string) {
  return d.pages.find((p) => p.id === pageId);
}

/**
 * Shown on a block the sync engine kept as a second version: that paragraph
 * was changed in two places at once (two tabs or devices, or the AI agent),
 * the texts could not be merged, and both were kept rather than one being
 * lost. One tap resolves it: use this version (it replaces the other one),
 * keep both as ordinary blocks, or discard this one. All are undoable.
 */
export function KeptCopyNote({ pageId, blockId, keptFrom }: { pageId: string; blockId: string; keptFrom: string }) {
  const { update } = useWorkspace();
  const { dict } = useI18n();
  const S = dict.safety;

  const useThis = () =>
    update((d) => {
      const page = pageOf(d, pageId);
      if (!page) return;
      const copy = page.blocks.find((b) => b.id === blockId);
      const original = page.blocks.find((b) => b.id === keptFrom);
      if (!isText(copy)) return;
      if (isText(original)) {
        original.text = copy.text;
        page.blocks = page.blocks.filter((b) => b.id !== blockId);
      } else {
        delete copy.keptFrom; // the other one is gone: this simply stays
      }
    });
  const keepBoth = () =>
    update((d) => {
      const copy = pageOf(d, pageId)?.blocks.find((b) => b.id === blockId);
      if (copy) delete copy.keptFrom;
    });
  const discard = () =>
    update((d) => {
      const page = pageOf(d, pageId);
      if (page) page.blocks = page.blocks.filter((b) => b.id !== blockId);
    });

  const button =
    "min-h-11 rounded-md border border-line-strong bg-card px-2.5 text-xs font-semibold text-ink transition hover:bg-hover";
  return (
    <div
      role="note"
      className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-amber-500/40 bg-amber-400/10 px-2.5 py-1.5 text-xs text-ink"
    >
      <Copy className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <span className="min-w-0 flex-1 basis-48">{S.keptCopyNote}</span>
      <span className="flex flex-wrap gap-1.5">
        <button type="button" onClick={useThis} className={button}>
          {S.keptCopyUse}
        </button>
        <button type="button" onClick={keepBoth} className={button}>
          {S.keptCopyKeepBoth}
        </button>
        <button type="button" onClick={discard} className={`${button} text-rose-600 dark:text-rose-400`}>
          {S.keptCopyDiscard}
        </button>
      </span>
    </div>
  );
}
