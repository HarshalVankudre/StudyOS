"use client";

import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { RichText } from "@/components/RichText";
import { cn } from "@/lib/utils";
import {
  filterInsertItems,
  matchMarkdownShortcut,
  type InsertItem,
  type ShortcutMatch,
} from "./editor/blockOps";
import { caretOnFirstLine, caretOnLastLine } from "./editor/caret";
import { InsertList, optionId } from "./editor/InsertList";
import { useCommittedDraft } from "./editor/useCommittedDraft";

/** Where to put the caret when a block is focused programmatically. */
export type Caret = "start" | "end" | number;

export interface BlockTextHandle {
  focus: (caret?: Caret) => void;
}

export type BlockTextProps = {
  value: string;
  /** Write the text to the workspace (after a typing pause, on blur, on unmount). */
  onCommit: (text: string) => void;
  /** Accessible name of the field (e.g. the block type). */
  label?: string;
  placeholder?: string;
  /** Show the placeholder only while focused (plain text blocks). */
  placeholderOnFocus?: boolean;
  /** Typography shared by the rendered and editing views, so nothing shifts. */
  className?: string;
  ref?: Ref<BlockTextHandle>;
  /**
   * Enter without Shift, with the text split at the selection. Return this
   * block's new text when handled (the parent has stored it), or null to
   * insert a line break instead.
   */
  onEnter?: (before: string, after: string) => string | null;
  /** Backspace with the caret at the very start. Return true when handled. */
  onBackspaceAtStart?: (text: string) => boolean;
  /** Delete with the caret at the very end. Return true when handled. */
  onDeleteAtEnd?: (text: string) => boolean;
  /** Arrow key at an edge. Return true when focus moved to another block. */
  onNavigate?: (dir: -1 | 1) => boolean;
  /** Ctrl/Cmd+Shift+ArrowUp/Down: move the block, keeping the caret. */
  onMove?: (delta: -1 | 1, text: string, caret: number) => void;
  /** Escape: leave the text (the parent usually focuses the block handle). */
  onEscape?: () => void;
  /** A Markdown shortcut was typed. Return true if the block was converted. */
  onShortcut?: (match: ShortcutMatch) => boolean;
  /** Items for the "/" menu (read when it opens). Omit to disable it. */
  getSlashItems?: () => InsertItem[];
  /**
   * A "/" menu item was chosen; `text` is the block text without "/query"
   * and `caret` is where the "/" was.
   */
  onSlashPick?: (item: InsertItem, text: string, caret: number) => void;
  slashLabels?: { menu: string; empty: string };
};

// Any character that could make Markdown or math render differently from the
// raw text. Text without them skips the Markdown pipeline entirely, which
// keeps pages with hundreds of plain notes fast.
const MARKDOWN_HINT =
  /[*_`$\\[\]<>#~|!&=]|https?:|www\.|^\s*(?:[-+]|\d+[.)])\s|^(?: {4}|\t)/m;
const MATH_HINT = /\$|\\\(|\\\[/;

/** Read-only render of block text: Markdown + KaTeX, same as the rest of the app. */
function RenderedText({ text }: { text: string }) {
  if (!MARKDOWN_HINT.test(text)) {
    return <div className="whitespace-pre-line break-words">{text}</div>;
  }
  return <RichText text={text} className="break-words [&_li]:whitespace-pre-line [&_p]:whitespace-pre-line" />;
}

interface SlashState {
  /** Index of the "/" in the text. */
  at: number;
  query: string;
  active: number;
  above: boolean;
  items: InsertItem[];
}

/**
 * One block's text. At rest it shows the typeset text (Markdown + math);
 * tapping, clicking or tabbing into it edits the raw source in an
 * auto-growing textarea, which supports multi-line text (Shift+Enter).
 *
 * The textarea is always mounted: at rest it lies transparently over the
 * typeset text, so a tap focuses it natively (the phone keyboard opens) and
 * puts the caret near the tapped spot. Links and buttons in the typeset text
 * stay clickable above it.
 */
export function BlockText({
  value,
  onCommit,
  label,
  placeholder,
  placeholderOnFocus,
  className,
  ref,
  onEnter,
  onBackspaceAtStart,
  onDeleteAtEnd,
  onNavigate,
  onMove,
  onEscape,
  onShortcut,
  getSlashItems,
  onSlashPick,
  slashLabels,
}: BlockTextProps) {
  const { draft, change, commitNow, markCommitted } = useCommittedDraft(value, onCommit);
  const [focused, setFocused] = useState(false);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();

  useImperativeHandle(
    ref,
    () => ({
      focus(caret: Caret = "end") {
        const el = taRef.current;
        if (!el) return;
        el.focus();
        const len = el.value.length;
        const pos = caret === "start" ? 0 : caret === "end" ? len : Math.min(Math.max(caret, 0), len);
        el.setSelectionRange(pos, pos);
      },
    }),
    [],
  );

  const hasText = draft.trim() !== "";
  const overlay = !focused && hasText;

  // Grow the textarea with its content while editing; at rest it is sized by
  // the typeset text (or is a single empty line), so no layout reads there.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (!focused) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [draft, focused]);

  // Put the caret back after a programmatic text change (shortcut, "/" pick).
  useLayoutEffect(() => {
    const pos = pendingCaret.current;
    const el = taRef.current;
    if (pos === null || !el) return;
    pendingCaret.current = null;
    if (document.activeElement === el) el.setSelectionRange(pos, pos);
  });

  // Switching apps on a phone: save what was typed.
  useEffect(() => {
    if (!focused) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") commitNow();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [focused, commitNow]);

  const slashItems = slash ? filterInsertItems(slash.items, slash.query) : [];

  const closeSlash = () => setSlash(null);

  const pickSlash = (item: InsertItem) => {
    const el = taRef.current;
    if (!slash || !el) return;
    const end = slash.at + 1 + slash.query.length;
    const text = draft.slice(0, slash.at) + draft.slice(end);
    setSlash(null);
    markCommitted(text);
    pendingCaret.current = slash.at;
    onSlashPick?.(item, text, slash.at);
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const next = el.value;
    const caret = el.selectionStart ?? next.length;

    // Markdown shortcut ("# ", "- ", "1. ", "[] ", "> " ...) at the start.
    if (onShortcut && next.length === draft.length + 1) {
      const match = matchMarkdownShortcut(next, caret);
      if (match && onShortcut(match)) {
        markCommitted(match.rest);
        pendingCaret.current = 0;
        setSlash(null);
        return;
      }
    }

    // "/" menu: opens on a "/" typed at the start or after a space.
    let nextSlash = slash;
    if (nextSlash) {
      const query = next.slice(nextSlash.at + 1, caret);
      const valid =
        next[nextSlash.at] === "/" && caret > nextSlash.at && !/\s/.test(query) && query.length <= 30;
      nextSlash = valid ? { ...nextSlash, query, active: 0 } : null;
    } else if (
      getSlashItems &&
      next.length === draft.length + 1 &&
      next[caret - 1] === "/" &&
      (caret === 1 || /\s/.test(next[caret - 2]))
    ) {
      const rect = el.getBoundingClientRect();
      nextSlash = {
        at: caret - 1,
        query: "",
        active: 0,
        above: rect.bottom + 320 > window.innerHeight && rect.top > 320,
        items: getSlashItems(),
      };
    }
    setSlash(nextSlash);
    // While the menu is open the "/query" is transient: don't commit it.
    change(next, nextSlash !== null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const el = e.currentTarget;

    if (slash) {
      const count = slashItems.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (count === 0) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setSlash({ ...slash, active: (slash.active + delta + count) % count });
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        const item = slashItems[slash.active];
        if (item) {
          e.preventDefault();
          pickSlash(item);
          return;
        }
        closeSlash();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSlash();
        commitNow();
        return;
      }
    }

    const { selectionStart: start, selectionEnd: end } = el;
    const text = el.value;
    const collapsed = start === end;
    const mod = e.ctrlKey || e.metaKey;

    switch (e.key) {
      case "Enter": {
        if (e.shiftKey || mod || e.altKey || !onEnter) return;
        e.preventDefault();
        const own = onEnter(text.slice(0, start), text.slice(end));
        if (own === null) {
          // Not handled: behave like a plain line break.
          const next = text.slice(0, start) + "\n" + text.slice(end);
          change(next);
          pendingCaret.current = start + 1;
        } else {
          markCommitted(own);
        }
        return;
      }
      case "Backspace": {
        if (!collapsed || start !== 0 || !onBackspaceAtStart) return;
        if (onBackspaceAtStart(text)) {
          e.preventDefault();
          markCommitted(text);
        }
        return;
      }
      case "Delete": {
        if (!collapsed || start !== text.length || !onDeleteAtEnd) return;
        if (onDeleteAtEnd(text)) {
          e.preventDefault();
          markCommitted(text);
        }
        return;
      }
      case "ArrowUp":
      case "ArrowDown": {
        const delta = e.key === "ArrowUp" ? -1 : 1;
        if (mod && e.shiftKey && onMove) {
          e.preventDefault();
          markCommitted(text);
          onMove(delta, text, start);
          return;
        }
        if (e.shiftKey || e.altKey || mod || !onNavigate) return;
        const atEdge = delta < 0 ? caretOnFirstLine(el) : caretOnLastLine(el);
        if (atEdge && onNavigate(delta)) e.preventDefault();
        return;
      }
      case "ArrowLeft":
      case "ArrowRight": {
        if (e.shiftKey || e.altKey || mod || !collapsed || !onNavigate) return;
        const rtl = getComputedStyle(el).direction === "rtl";
        const backwards = (e.key === "ArrowLeft") !== rtl;
        if (backwards && start === 0 && onNavigate(-1)) e.preventDefault();
        else if (!backwards && start === text.length && onNavigate(1)) e.preventDefault();
        return;
      }
      case "Escape": {
        if (!onEscape) return;
        e.preventDefault();
        commitNow();
        onEscape();
        return;
      }
    }
  };

  const activeOption = slash && slashItems.length > 0 ? optionId(listId, slash.active) : undefined;

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      {overlay && (
        <div
          aria-hidden
          className="pointer-events-none relative z-[1] [&_a]:pointer-events-auto [&_button]:pointer-events-auto"
        >
          <RenderedText text={draft} />
        </div>
      )}
      <textarea
        ref={taRef}
        value={draft}
        rows={1}
        aria-label={label}
        placeholder={placeholder}
        aria-controls={slash ? listId : undefined}
        aria-activedescendant={activeOption}
        aria-autocomplete={getSlashItems ? "list" : undefined}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          commitNow();
          setFocused(false);
          setSlash(null);
        }}
        className={cn(
          "block w-full resize-none overflow-hidden bg-transparent p-0 text-inherit outline-none placeholder:text-ink-soft/45",
          overlay && "absolute inset-0 h-full cursor-text opacity-0",
          placeholderOnFocus && "placeholder:text-transparent focus:placeholder:text-ink-soft/45",
        )}
      />
      {focused && MATH_HINT.test(draft) && (
        <div
          aria-hidden
          className="pointer-events-none mt-1 rounded border border-line bg-surface px-2 py-1 text-[0.92em] not-italic"
        >
          <RenderedText text={draft} />
        </div>
      )}
      {slash && (
        <div
          className={cn(
            "absolute start-0 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-line-strong bg-popover p-1 font-sans text-sm font-normal not-italic text-popover-foreground shadow-pop",
            slash.above ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          <InsertList
            id={listId}
            label={slashLabels?.menu ?? ""}
            items={slashItems}
            activeIndex={slash.active}
            emptyLabel={slashLabels?.empty ?? ""}
            onPick={pickSlash}
            onActiveChange={(i) => setSlash({ ...slash, active: i })}
          />
        </div>
      )}
    </div>
  );
}
