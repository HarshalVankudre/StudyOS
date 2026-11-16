"use client";

/**
 * The writing toolbar: tools (pen, highlighter, eraser, lasso) and the
 * options of the active one, all one tap away (no popovers between the
 * student and a colour change). Targets are at least 36 px for fingers.
 */
import { Eraser, Highlighter, LassoSelect, PenLine, Redo2, Undo2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { Tool, ToolSettings } from "./ink/engine";
import { ERASER_SIZES, HIGHLIGHTER_COLORS, HIGHLIGHTER_WIDTHS, PEN_COLORS, PEN_WIDTHS } from "./api";

const TOOL_ICONS: Record<Tool, typeof PenLine> = {
  pen: PenLine,
  highlighter: Highlighter,
  eraser: Eraser,
  lasso: LassoSelect,
};

export function ToolButton({
  active,
  label,
  onClick,
  children,
  disabled,
  className,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-ink-soft transition hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35",
        active && "bg-lime-faint text-ink ring-1 ring-lime/50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Swatch({ color, active, label, onClick }: { color: string; active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className="grid h-9 w-8 place-items-center rounded-md transition hover:bg-hover"
    >
      <span
        className={cn("block h-5 w-5 rounded-full border border-black/15", active && "ring-2 ring-lime ring-offset-2 ring-offset-surface")}
        style={{ background: color }}
      />
    </button>
  );
}

function WidthDot({ size, active, label, onClick }: { size: number; active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn("grid h-9 w-8 place-items-center rounded-md transition hover:bg-hover", active && "bg-hover")}
    >
      <span className="block rounded-full bg-ink" style={{ width: size, height: size }} />
    </button>
  );
}

export function Toolbar({
  tools,
  onTools,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  tools: ToolSettings;
  onTools: (next: ToolSettings) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { dict } = useI18n();
  const E = dict.notebooks.editor;
  const set = (patch: Partial<ToolSettings>) => onTools({ ...tools, ...patch });
  const t = tools.tool;

  return (
    <div role="toolbar" aria-label={E.toolbar} className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
        {(Object.keys(TOOL_ICONS) as Tool[]).map((tool) => {
          const Icon = TOOL_ICONS[tool];
          return (
            <ToolButton key={tool} active={t === tool} label={E.tools[tool]} onClick={() => set({ tool })}>
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </ToolButton>
          );
        })}
      </div>

      {t === "pen" && (
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
          <ToolButton active={tools.penKind === "fountain"} label={E.fountain} onClick={() => set({ penKind: "fountain" })} className="px-2 text-xs font-semibold">
            {E.fountain}
          </ToolButton>
          <ToolButton active={tools.penKind === "ballpoint"} label={E.ballpoint} onClick={() => set({ penKind: "ballpoint" })} className="px-2 text-xs font-semibold">
            {E.ballpoint}
          </ToolButton>
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          {PEN_COLORS.map((c) => (
            <Swatch key={c} color={c} active={tools.penColor === c} label={`${E.color} ${c}`} onClick={() => set({ penColor: c })} />
          ))}
          <label className="grid h-9 w-8 cursor-pointer place-items-center rounded-md hover:bg-hover" title={E.color}>
            <span className="sr-only">{E.color}</span>
            <input
              type="color"
              value={tools.penColor}
              onChange={(e) => set({ penColor: e.target.value })}
              className="h-5 w-5 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0"
            />
          </label>
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          {PEN_WIDTHS.map((w, i) => (
            <WidthDot key={w} size={3 + i * 3} active={tools.penWidth === w} label={`${E.width} ${i + 1}`} onClick={() => set({ penWidth: w })} />
          ))}
        </div>
      )}

      {t === "highlighter" && (
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
          {HIGHLIGHTER_COLORS.map((c) => (
            <Swatch key={c} color={c} active={tools.highlighterColor === c} label={`${E.color} ${c}`} onClick={() => set({ highlighterColor: c })} />
          ))}
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          {HIGHLIGHTER_WIDTHS.map((w, i) => (
            <WidthDot key={w} size={4 + i * 4} active={tools.highlighterWidth === w} label={`${E.width} ${i + 1}`} onClick={() => set({ highlighterWidth: w })} />
          ))}
        </div>
      )}

      {t === "eraser" && (
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
          <ToolButton active={tools.eraserMode === "stroke"} label={E.eraserStroke} onClick={() => set({ eraserMode: "stroke" })} className="px-2 text-xs font-semibold">
            {E.eraserStroke}
          </ToolButton>
          <ToolButton active={tools.eraserMode === "precise"} label={E.eraserPrecise} onClick={() => set({ eraserMode: "precise" })} className="px-2 text-xs font-semibold">
            {E.eraserPrecise}
          </ToolButton>
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          {ERASER_SIZES.map((s, i) => (
            <WidthDot key={s} size={4 + i * 4} active={tools.eraserSize === s} label={`${E.eraserSize} ${i + 1}`} onClick={() => set({ eraserSize: s })} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
        <ToolButton label={E.undo} onClick={onUndo} disabled={!canUndo}>
          <Undo2 className="h-[18px] w-[18px] rtl:-scale-x-100" aria-hidden />
        </ToolButton>
        <ToolButton label={E.redo} onClick={onRedo} disabled={!canRedo}>
          <Redo2 className="h-[18px] w-[18px] rtl:-scale-x-100" aria-hidden />
        </ToolButton>
      </div>
    </div>
  );
}
