"use client";

import { createContext, useContext, type PointerEvent as ReactPointerEvent } from "react";
import type { Caret } from "../BlockText";
import type { InsertItem, ShortcutMatch, TextKind } from "./blockOps";

/** Where keyboard focus should land after an edit. */
export interface FocusTarget {
  id: string;
  target: "text" | "handle";
  caret?: Caret;
}

/** Registered by each block row so the page can move focus into it. */
export interface RowHandle {
  focusText: (caret?: Caret) => void;
  focusHandle: () => void;
  /** Focus the block handle and open its menu (Ctrl/⌘+/ from the text). */
  openMenu?: () => void;
}

/**
 * Everything a block row can ask the page editor to do. All edits go through
 * the workspace `update()` path, one call per user action, so workspace-level
 * history records them as single steps. The object is stable for the life of
 * a page, so memoised rows never re-render because of it.
 */
export interface EditorApi {
  commitText: (id: string, text: string) => void;
  setChecked: (id: string, checked: boolean) => void;
  setEmoji: (id: string, emoji: string) => void;

  // Keyboard editing (they move focus themselves)
  enter: (id: string, before: string, after: string) => string | null;
  backspaceAtStart: (id: string, text: string) => boolean;
  deleteAtEnd: (id: string, text: string) => boolean;
  navigate: (id: string, dir: -1 | 1) => boolean;
  moveByKeyboard: (id: string, delta: -1 | 1, text: string, caret: number) => void;
  shortcut: (id: string, match: ShortcutMatch) => boolean;
  slashPick: (id: string, item: InsertItem, text: string, caret: number) => void;
  escape: (id: string) => void;
  /** Open the block's options menu from its text (the handle is not a Tab stop). */
  openOptions: (id: string) => void;

  // Menu actions (return where focus should go once the menu has closed)
  convert: (id: string, kind: TextKind) => FocusTarget | null;
  duplicate: (id: string) => FocusTarget | null;
  move: (id: string, delta: -1 | 1) => FocusTarget | null;
  remove: (id: string) => FocusTarget | null;

  /** Insert from the "+" menu after `afterId` (null = top of the page). */
  insertFromMenu: (item: InsertItem, afterId: string | null) => FocusTarget;
  /** A text block to type into at the top/bottom of the page (created if needed). */
  startWriting: (where: "top" | "bottom") => FocusTarget;

  focus: (target: FocusTarget | null) => void;
  pageId: string;
  openInsert: (afterId: string | null, anchor: HTMLElement | null) => void;
  getSlashItems: () => InsertItem[];
  registerRow: (id: string, handle: RowHandle) => () => void;

  // Mouse drag to reorder
  startDrag: (id: string, e: ReactPointerEvent) => void;
  /** True (once) when a click is the tail end of a drag and must be ignored. */
  consumeDragClick: () => boolean;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside a PageView");
  return ctx;
}
