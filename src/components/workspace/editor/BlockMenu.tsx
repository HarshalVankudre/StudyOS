"use client";

import { useRef, useState, type RefObject } from "react";
import { ArrowDown, ArrowUp, Check, Copy, GripVertical, Plus, Repeat2, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { Block } from "@/lib/workspace/types";
import { blockHasContent, isTextBlock, kindOf, TEXT_KINDS, textKindLabel } from "./blockOps";
import { useEditor } from "./EditorContext";
import { TEXT_KIND_ICONS } from "./InsertList";

/**
 * Gutter buttons: always visible (dimmed) on touch screens, revealed on
 * hover or keyboard focus where there is a precise pointer.
 */
export const GUTTER_BUTTON = cn(
  "grid h-10 w-11 shrink-0 place-items-center rounded-md text-ink-faint opacity-70 transition",
  "hover:bg-hover hover:text-ink sm:h-8 sm:w-8",
  "pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100",
  "pointer-fine:focus-visible:opacity-100 pointer-fine:data-[state=open]:opacity-100 data-[state=open]:bg-hover",
);

const ITEM = "min-h-11 sm:min-h-8";

/**
 * The block handle (⋮⋮) and its menu: add below, turn into, duplicate, move
 * up/down, delete. Works by tap, click and keyboard (Enter/Space/ArrowDown on
 * the handle). With a mouse, dragging the handle reorders blocks instead.
 */
export function BlockMenu({
  block,
  isFirst,
  isLast,
  handleRef,
}: {
  block: Block;
  isFirst: boolean;
  isLast: boolean;
  handleRef: RefObject<HTMLButtonElement | null>;
}) {
  const editor = useEditor();
  const { dict, dir } = useI18n();
  const L = dict.page.blockMenu;
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // What to do once the menu has closed (Radix restores focus on close; we
  // redirect it to where the action left the student).
  const after = useRef<(() => void) | null>(null);

  const textBlock = isTextBlock(block) ? block : null;
  const currentKind = textBlock ? kindOf(textBlock) : null;
  // Text is one tap away from being retyped; a deck, table or artifact isn't.
  const needsConfirm = !textBlock && blockHasContent(block);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setConfirming(false);
      }}
      dir={dir}
    >
      <DropdownMenuTrigger asChild>
        <button
          ref={handleRef}
          type="button"
          aria-label={L.blockOptions}
          title={L.blockOptionsHint}
          // Radix opens on pointerdown; we open on click instead so a mouse
          // press can become a drag and a touch can become a scroll.
          onPointerDown={(e) => {
            e.preventDefault();
            editor.startDrag(block.id, e);
          }}
          onClick={(e) => {
            if (e.detail === 0 || editor.consumeDragClick()) return;
            setOpen((o) => !o);
          }}
          className={cn(GUTTER_BUTTON, "sm:cursor-grab")}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onCloseAutoFocus={(e) => {
          const fn = after.current;
          after.current = null;
          if (fn) {
            e.preventDefault();
            fn();
          }
        }}
      >
        <DropdownMenuItem
          className={ITEM}
          onSelect={() => {
            after.current = () => editor.openInsert(block.id, handleRef.current);
          }}
        >
          <Plus aria-hidden />
          {L.addBelow}
        </DropdownMenuItem>
        {textBlock && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={ITEM}>
              <Repeat2 aria-hidden />
              {L.turnInto}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              {TEXT_KINDS.map((kind) => {
                const Icon = TEXT_KIND_ICONS[kind];
                return (
                  <DropdownMenuItem
                    key={kind}
                    className={ITEM}
                    onSelect={() => {
                      const target = editor.convert(block.id, kind);
                      after.current = () => editor.focus(target);
                    }}
                  >
                    <Icon aria-hidden />
                    <span className="flex-1">{textKindLabel(kind, dict)}</span>
                    {kind === currentKind && <Check aria-hidden />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem
          className={ITEM}
          onSelect={() => {
            const target = editor.duplicate(block.id);
            after.current = () => editor.focus(target);
          }}
        >
          <Copy aria-hidden />
          {L.duplicate}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={ITEM}
          disabled={isFirst}
          onSelect={() => {
            const target = editor.move(block.id, -1);
            after.current = () => editor.focus(target);
          }}
        >
          <ArrowUp aria-hidden />
          {L.moveUp}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={ITEM}
          disabled={isLast}
          onSelect={() => {
            const target = editor.move(block.id, 1);
            after.current = () => editor.focus(target);
          }}
        >
          <ArrowDown aria-hidden />
          {L.moveDown}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={ITEM}
          variant="destructive"
          onSelect={(e) => {
            if (needsConfirm && !confirming) {
              e.preventDefault();
              setConfirming(true);
              return;
            }
            const target = editor.remove(block.id);
            // This row unmounts with the menu; move focus right away too.
            editor.focus(target);
            after.current = () => editor.focus(target);
          }}
        >
          <Trash2 aria-hidden />
          {confirming ? L.confirmDelete : dict.page.deleteBlock}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
