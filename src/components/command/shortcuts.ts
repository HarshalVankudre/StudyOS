/**
 * The keyboard shortcuts StudyOS actually has, as data for the help sheet.
 * Sources (keep in sync when a shortcut changes):
 *  - General: AppShell (⌘/Ctrl+K, ?), WorkspaceEditor (undo/redo).
 *  - Editing: BlockText.handleKeyDown + PageView's editor (Enter, Shift+Enter,
 *    Backspace/Delete at the edges, ⌘/Ctrl+Shift+↑/↓, ↑/↓ at the edges, Esc,
 *    ⌘/Ctrl+/ block options, "/" insert menu) and the page title (Enter).
 *  - Markdown: SHORTCUTS in editor/blockOps.ts.
 *  - Study: StudySession (Space/Enter to flip, 1-4 to grade).
 */
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

type ItemKey = keyof Dictionary["shortcuts"]["items"];
type GroupKey = keyof Dictionary["shortcuts"]["groups"];

/** A key combination: each inner array is one chord of keys pressed together. */
export interface ShortcutDef {
  item: ItemKey;
  /** Alternatives, e.g. [["Mod", "Shift", "Z"], ["Ctrl", "Y"]]. */
  keys: string[][];
  /** Keys are literal text typed into a block (Markdown prefixes). */
  typed?: boolean;
}

export const SHORTCUT_GROUPS: { group: GroupKey; items: ShortcutDef[] }[] = [
  {
    group: "general",
    items: [
      { item: "search", keys: [["Mod", "K"]] },
      { item: "help", keys: [["?"]] },
      { item: "undo", keys: [["Mod", "Z"]] },
      { item: "redo", keys: [["Mod", "Shift", "Z"], ["Ctrl", "Y"]] },
    ],
  },
  {
    group: "editing",
    items: [
      { item: "newBlock", keys: [["Enter"]] },
      { item: "lineBreak", keys: [["Shift", "Enter"]] },
      { item: "insertMenu", keys: [["/"]] },
      { item: "mergeBack", keys: [["Backspace"]] },
      { item: "mergeForward", keys: [["Delete"]] },
      { item: "moveBlock", keys: [["Mod", "Shift", "↑"], ["Mod", "Shift", "↓"]] },
      { item: "navigate", keys: [["↑"], ["↓"]] },
      { item: "leaveBlock", keys: [["Esc"]] },
      { item: "blockOptions", keys: [["Mod", "/"]] },
      { item: "titleEnter", keys: [["Enter"]] },
    ],
  },
  {
    group: "markdown",
    items: [
      { item: "heading", keys: [["# "], ["## "], ["### "]], typed: true },
      { item: "bullet", keys: [["- "], ["* "]], typed: true },
      { item: "numbered", keys: [["1. "]], typed: true },
      { item: "todo", keys: [["[] "], ["[x] "]], typed: true },
      { item: "quote", keys: [["> "]], typed: true },
    ],
  },
  {
    group: "study",
    items: [
      { item: "flip", keys: [["Space"], ["Enter"]] },
      { item: "grade", keys: [["1"], ["2"], ["3"], ["4"]] },
    ],
  },
];

/** Display a key for the current platform ("Mod" → ⌘ or Ctrl). */
export function keyLabel(key: string, apple: boolean): string {
  if (key === "Mod") return apple ? "⌘" : "Ctrl";
  if (apple && key === "Shift") return "⇧";
  return key;
}
