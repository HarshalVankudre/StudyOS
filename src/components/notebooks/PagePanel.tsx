"use client";

/**
 * The page sidebar: a thumbnail per page (drawn by the engine only while it
 * is scrolled into view), tap to jump, and per-page actions (paper, move,
 * delete) plus adding pages and inserting PDF pages.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, EllipsisVertical, FileUp, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { PAPER_COLORS, TEMPLATE_KINDS, type PageMeta, type PageTemplate } from "@/lib/notebooks/model";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { InkEngine } from "./ink/engine";

const THUMB_W = 112;

function Thumb({ engine, page, tick }: { engine: InkEngine | null; page: PageMeta; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !engine || !ref.current) return;
    engine.renderThumbnail(page.id, ref.current, THUMB_W);
  }, [visible, engine, page.id, page.template.kind, page.template.paper, tick]);
  return (
    <canvas
      ref={ref}
      className="block rounded-[3px] bg-white shadow-sm ring-1 ring-black/10"
      style={{ width: THUMB_W, height: Math.round((THUMB_W * page.height) / page.width) }}
      aria-hidden
    />
  );
}

export function PagePanel({
  engine,
  pages,
  current,
  tick,
  onJump,
  onAdd,
  onDelete,
  onMove,
  onTemplate,
  onInsertPdf,
}: {
  engine: InkEngine | null;
  pages: PageMeta[];
  current: number;
  tick: number;
  onJump: (index: number) => void;
  onAdd: (afterIndex: number) => void;
  onDelete: (pageId: string) => void;
  onMove: (pageId: string, toIndex: number) => void;
  onTemplate: (pageId: string, template: PageTemplate) => void;
  onInsertPdf: (afterPageId: string | null) => void;
}) {
  const { dict, t } = useI18n();
  const E = dict.notebooks.editor;
  const N = dict.notebooks;
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the current page's thumbnail in view as the student scrolls.
  useEffect(() => {
    const item = listRef.current?.children[current] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <aside className="flex w-[152px] shrink-0 flex-col border-e border-line bg-surface">
      <ol ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
        {pages.map((p, i) => (
          <li key={p.id} className="group relative">
            <button
              type="button"
              onClick={() => onJump(i)}
              aria-current={i === current ? "page" : undefined}
              aria-label={t(E.pageNumber, { page: i + 1 })}
              className={cn(
                "block rounded-md p-1 transition",
                i === current ? "bg-lime-faint ring-2 ring-lime" : "hover:bg-hover",
              )}
            >
              <Thumb engine={engine} page={p} tick={tick} />
            </button>
            <div className="mt-1 flex items-center justify-between ps-1">
              <span className="font-mono text-[11px] text-ink-faint">{i + 1}</span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="grid h-7 w-7 place-items-center rounded-md text-ink-faint hover:bg-hover hover:text-ink"
                  aria-label={E.more}
                >
                  <EllipsisVertical className="h-4 w-4" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem onSelect={() => onAdd(i)}>
                    <Plus className="h-4 w-4" aria-hidden /> {E.addPage}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onInsertPdf(p.id)}>
                    <FileUp className="h-4 w-4" aria-hidden /> {E.insertPdf}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>{E.pageTemplate}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      <DropdownMenuRadioGroup
                        value={p.template.kind}
                        onValueChange={(kind) => onTemplate(p.id, { ...p.template, kind: kind as PageTemplate["kind"] })}
                      >
                        {TEMPLATE_KINDS.map((k) => (
                          <DropdownMenuRadioItem key={k} value={k}>
                            {N.templates[k]}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>{N.create.paperColor}</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={p.template.paper}
                        onValueChange={(paper) => onTemplate(p.id, { ...p.template, paper: paper as PageTemplate["paper"] })}
                      >
                        {PAPER_COLORS.map((c) => (
                          <DropdownMenuRadioItem key={c} value={c}>
                            {N.papers[c]}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={i === 0} onSelect={() => onMove(p.id, i - 1)}>
                    <ArrowUp className="h-4 w-4" aria-hidden /> {E.moveUp}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={i === pages.length - 1} onSelect={() => onMove(p.id, i + 1)}>
                    <ArrowDown className="h-4 w-4" aria-hidden /> {E.moveDown}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" disabled={pages.length <= 1} onSelect={() => onDelete(p.id)}>
                    <Trash2 className="h-4 w-4" aria-hidden /> {E.deletePage}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        ))}
      </ol>
      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={() => onAdd(pages.length - 1)}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md text-sm font-semibold text-ink-soft transition hover:bg-hover hover:text-ink"
        >
          <Plus className="h-4 w-4" aria-hidden /> {E.addPage}
        </button>
      </div>
    </aside>
  );
}
