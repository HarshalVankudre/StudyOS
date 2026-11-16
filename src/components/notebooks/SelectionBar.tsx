"use client";

/**
 * The lasso selection: a dashed frame with corner handles (drawn here, but
 * dragged through the engine, so this layer never takes pointer input) and
 * a floating action bar above it.
 */
import { Check, ClipboardPaste, Copy, CopyPlus, Scissors, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { SelectionState } from "./ink/engine";
import { PEN_COLORS } from "./api";
import { ToolButton } from "./Toolbar";

export function SelectionBar({
  selection,
  hasClipboard,
  onDelete,
  onDuplicate,
  onCopy,
  onCut,
  onPaste,
  onRecolor,
  onDone,
}: {
  selection: SelectionState;
  hasClipboard: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onRecolor: (color: string) => void;
  onDone: () => void;
}) {
  const { dict, plural } = useI18n();
  const E = dict.notebooks.editor;
  const { left, top, width, height } = selection.box;
  const barTop = Math.max(8, top - 56);
  return (
    <>
      <div
        className="pointer-events-none absolute rounded-sm border-2 border-dashed border-sky-500/80 bg-sky-400/5"
        style={{ left: left - 6, top: top - 6, width: width + 12, height: height + 12 }}
        aria-hidden
      >
        {[
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([x, y]) => (
          <span
            key={`${x}${y}`}
            className="absolute h-3.5 w-3.5 rounded-full border-2 border-sky-500 bg-white"
            style={{ left: `calc(${x * 100}% - 7px)`, top: `calc(${y * 100}% - 7px)` }}
          />
        ))}
      </div>
      <div
        role="toolbar"
        aria-label={plural(E.selected, selection.count)}
        className="absolute z-10 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-0.5 rounded-lg border border-line-strong bg-popover p-1 shadow-pop"
        style={{ left: Math.max(8, left), top: barTop }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="px-2 text-xs font-semibold text-ink-soft">{plural(E.selected, selection.count)}</span>
        <ToolButton label={E.delete} onClick={onDelete}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label={E.duplicate} onClick={onDuplicate}>
          <CopyPlus className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label={E.copy} onClick={onCopy}>
          <Copy className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label={E.cut} onClick={onCut}>
          <Scissors className="h-4 w-4" aria-hidden />
        </ToolButton>
        {hasClipboard && (
          <ToolButton label={E.paste} onClick={onPaste}>
            <ClipboardPaste className="h-4 w-4" aria-hidden />
          </ToolButton>
        )}
        <span className="mx-0.5 h-6 w-px bg-line" aria-hidden />
        {PEN_COLORS.slice(0, 5).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${E.recolor} ${c}`}
            title={E.recolor}
            onClick={() => onRecolor(c)}
            className="grid h-9 w-7 place-items-center rounded-md hover:bg-hover"
          >
            <span className="block h-4 w-4 rounded-full border border-black/15" style={{ background: c }} />
          </button>
        ))}
        <span className="mx-0.5 h-6 w-px bg-line" aria-hidden />
        <ToolButton label={E.deselect} onClick={onDone}>
          <Check className="h-4 w-4" aria-hidden />
        </ToolButton>
      </div>
    </>
  );
}
