"use client";

import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Plus } from "lucide-react";
import type { Block, Database, Page, Workspace } from "@/lib/workspace/types";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { BlockText, type BlockTextHandle } from "./BlockText";
import { DatabaseView } from "./DatabaseView";
import { useBlockDeepLink } from "./DeepLinkContext";
import { FlashcardsBlock } from "./FlashcardsBlock";
import { GradesBlock } from "./grades/GradesBlock";
import { QuizBlock } from "./quiz/QuizBlock";
import { ReactArtifact } from "./ReactArtifact";
import { useWorkspace } from "./WorkspaceContext";
import {
  buildInsertItems,
  continuationKind,
  convertTextBlock,
  duplicateBlock,
  findTextNeighbor,
  isListKind,
  isTextBlock,
  kindOf,
  listNumbers,
  makeTextBlock,
  moveBlock,
  moveBlockTo,
  newDatabase,
  newId,
  studyKitSlashItems,
  textKindLabel,
  type InsertAction,
  type InsertItem,
  type TextBlock,
  type TextKind,
} from "./editor/blockOps";
import { BlockMenu, GUTTER_BUTTON } from "./editor/BlockMenu";
import { DraftInput } from "./editor/DraftInput";
import { KeptCopyNote } from "./editor/KeptCopyNote";
import {
  EditorContext,
  useEditor,
  type EditorApi,
  type FocusTarget,
  type RowHandle,
} from "./editor/EditorContext";
import { InsertMenu } from "./editor/InsertMenu";
import { openStudyKit } from "./materials/events";

/** The authenticated, owner-checked source for a media asset. */
export function mediaImgSrc(assetId: string): string {
  return `/api/asset/${assetId}`;
}

/** Registry key for the page's "Add block" button (focus target of last resort). */
const ADD_BUTTON = "__add-block__";
/** Pointer travel before a press on the handle becomes a drag. */
const DRAG_THRESHOLD_PX = 5;

export function PageView({
  page,
  focusTitle = false,
  onTitleFocused,
}: {
  page: Page;
  /** A page that was just created: focus its title with the text selected. */
  focusTitle?: boolean;
  onTitleFocused?: () => void;
}) {
  // A fresh editor per page: menus, drafts and pending focus never leak
  // from one page into the next.
  return <PageEditor key={page.id} page={page} focusTitle={focusTitle} onTitleFocused={onTitleFocused} />;
}

interface InsertState {
  afterId: string | null;
  anchor: HTMLElement | null;
  seq: number;
}

function PageEditor({
  page,
  focusTitle,
  onTitleFocused,
}: {
  page: Page;
  focusTitle: boolean;
  onTitleFocused?: () => void;
}) {
  const { update, workspace } = useWorkspace();
  const { dict, t } = useI18n();
  const pageId = page.id;

  const titleRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!focusTitle) return;
    const input = titleRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    onTitleFocused?.();
  }, [focusTitle, onTitleFocused]);

  // Latest blocks for event handlers (which run after commit).
  const blocksRef = useRef(page.blocks);
  useLayoutEffect(() => {
    blocksRef.current = page.blocks;
  });

  const insertItems = useMemo(
    () => buildInsertItems(dict, t, workspace.databases),
    [dict, t, workspace.databases],
  );
  // The "/" menu also offers the study-kit actions (the "+" menu lists them
  // in a section of their own).
  const slashItems = useMemo(
    () => [...insertItems, ...studyKitSlashItems(dict, true)],
    [insertItems, dict],
  );
  const insertItemsRef = useRef(slashItems);
  useLayoutEffect(() => {
    insertItemsRef.current = slashItems;
  });

  // ---- Focus management -------------------------------------------------
  // Edits that move the caret (Enter, Backspace merge, conversions, ...) ask
  // for focus *after* the workspace re-renders, when the target row exists.
  const rowsRef = useRef(new Map<string, RowHandle>());
  const pendingFocus = useRef<FocusTarget | null>(null);
  const [, setFocusTick] = useState(0);

  useLayoutEffect(() => {
    const req = pendingFocus.current;
    if (!req) return;
    const row = rowsRef.current.get(req.id);
    if (!row) {
      if (req.id !== ADD_BUTTON && !page.blocks.some((b) => b.id === req.id)) {
        pendingFocus.current = null;
      }
      return;
    }
    pendingFocus.current = null;
    if (req.target === "text") row.focusText(req.caret ?? "end");
    else row.focusHandle();
  });

  // ---- Insert menu ("+") --------------------------------------------------
  const [insert, setInsert] = useState<InsertState | null>(null);
  const insertSeq = useRef(0);

  // ---- Drag to reorder (mouse) ---------------------------------------------
  const listRef = useRef<HTMLDivElement>(null);
  const [dropTop, setDropTop] = useState<number | null>(null);
  const suppressClick = useRef(false);

  // A deep link (?block=) to a block on this page: scroll to it, highlight it.
  useBlockDeepLink(listRef);

  const editor = useMemo<EditorApi>(() => {
    const mutate = (fn: (blocks: Block[], d: Workspace) => void) =>
      update((d) => {
        const p = d.pages.find((x) => x.id === pageId);
        if (p) fn(p.blocks, d);
      });
    const blocks = () => blocksRef.current;
    const indexOf = (id: string) => blocks().findIndex((b) => b.id === id);
    const focus = (target: FocusTarget | null) => {
      if (!target) return;
      pendingFocus.current = target;
      setFocusTick((n) => n + 1);
    };
    const setText = (bs: Block[], id: string, text: string) => {
      const b = bs.find((x) => x.id === id);
      if (isTextBlock(b)) b.text = text;
    };
    const replaceText = (bs: Block[], id: string, make: (b: TextBlock) => Block) => {
      const i = bs.findIndex((x) => x.id === id);
      const b = bs[i];
      if (isTextBlock(b)) bs[i] = make(b);
    };
    const removeById = (bs: Block[], id: string) => {
      const i = bs.findIndex((x) => x.id === id);
      if (i >= 0) bs.splice(i, 1);
    };
    /** Where focus goes when the block at index `i` disappears: up first. */
    const focusAfterRemoval = (i: number): FocusTarget => {
      const bs = blocks();
      const prev = findTextNeighbor(bs, i, -1);
      if (prev) return { id: prev.id, target: "text", caret: "end" };
      const next = findTextNeighbor(bs, i, 1);
      if (next) return { id: next.id, target: "text", caret: "start" };
      const near = bs[i + 1] ?? bs[i - 1];
      return near ? { id: near.id, target: "handle" } : { id: ADD_BUTTON, target: "handle" };
    };
    const create = (action: InsertAction): { block: Block; db?: Database } => {
      const id = newId();
      switch (action.kind) {
        case "text":
          return { block: makeTextBlock(action.textKind, "", id) };
        case "divider":
          return { block: { id, type: "divider" } };
        case "flashcards":
          // No blank card: the schema requires card text, and the deck's own
          // "Add card" flow handles authoring.
          return { block: { id, type: "flashcards", title: dict.study.newDeckTitle, cards: [] } };
        case "quiz":
          return { block: { id, type: "quiz", title: dict.quiz.newQuizTitle, questions: [] } };
        case "grades":
          // Unconfigured: the block's own setup step detects the columns.
          return { block: { id, type: "grades", title: dict.grades.defaultTitle } };
        case "linked":
          return {
            block: { id, type: "database_view", databaseId: action.databaseId, viewId: action.viewId },
          };
        case "studyKit":
          // Opens a dialog (see slashPick); never inserted as a block.
          return { block: makeTextBlock("paragraph", "", id) };
        case "database": {
          const dbId = newId();
          const viewId = newId();
          return {
            block: { id, type: "database_view", databaseId: dbId, viewId },
            db: newDatabase(dbId, viewId, dict.page.newTable),
          };
        }
      }
    };
    /**
     * Insert `item` after `afterId` (null = top of the page), or in place of
     * `replaceId`. When the student was typing ("/" menu) and the new block
     * isn't text, a paragraph follows it so they can keep writing.
     */
    const insertItem = (
      item: InsertItem,
      opts: {
        afterId: string | null;
        replaceId?: string;
        text?: { id: string; value: string };
        typing?: boolean;
      },
    ): FocusTarget => {
      const { block, db } = create(item.action);
      const created: Block[] = [block];
      let target: FocusTarget = isTextBlock(block)
        ? { id: block.id, target: "text", caret: "start" }
        : { id: block.id, target: "handle" };
      if (opts.typing && !isTextBlock(block)) {
        const at = indexOf(opts.replaceId ?? opts.afterId ?? "");
        const next = at >= 0 ? blocks()[at + 1] : undefined;
        if (next?.type === "paragraph" && next.text === "") {
          target = { id: next.id, target: "text", caret: "start" };
        } else {
          const para = makeTextBlock("paragraph");
          created.push(para);
          target = { id: para.id, target: "text", caret: "start" };
        }
      }
      mutate((bs, d) => {
        if (db) d.databases.push(db);
        if (opts.text) setText(bs, opts.text.id, opts.text.value);
        if (opts.replaceId) {
          const i = bs.findIndex((b) => b.id === opts.replaceId);
          if (i >= 0) {
            bs.splice(i, 1, ...created);
            return;
          }
        }
        const i = opts.afterId === null ? -1 : bs.findIndex((b) => b.id === opts.afterId);
        const at = opts.afterId === null ? 0 : i < 0 ? bs.length : i + 1;
        bs.splice(at, 0, ...created);
      });
      return target;
    };

    let dragging = false;

    return {
      commitText: (id, text) => mutate((bs) => setText(bs, id, text)),
      setChecked: (id, checked) =>
        mutate((bs) => {
          const b = bs.find((x) => x.id === id);
          if (b?.type === "todo") b.checked = checked;
        }),
      setEmoji: (id, emoji) =>
        mutate((bs) => {
          const b = bs.find((x) => x.id === id);
          if (b?.type === "callout") b.emoji = emoji;
        }),

      enter(id, before, after) {
        const b = blocks()[indexOf(id)];
        if (!isTextBlock(b)) return null;
        // Enter on an empty list item leaves the list.
        if (before === "" && after === "" && isListKind(kindOf(b))) {
          mutate((bs) => replaceText(bs, id, (x) => convertTextBlock(x, "paragraph", "")));
          focus({ id, target: "text", caret: 0 });
          return "";
        }
        const fresh = makeTextBlock(continuationKind(b), before === "" ? "" : after);
        if (before === "" && after !== "") {
          // Caret at the start: open an empty line above, stay put.
          mutate((bs) => {
            setText(bs, id, after);
            const i = bs.findIndex((x) => x.id === id);
            if (i >= 0) bs.splice(i, 0, fresh);
          });
          focus({ id, target: "text", caret: 0 });
          return after;
        }
        mutate((bs) => {
          setText(bs, id, before);
          const i = bs.findIndex((x) => x.id === id);
          if (i >= 0) bs.splice(i + 1, 0, fresh);
        });
        focus({ id: fresh.id, target: "text", caret: 0 });
        return before;
      },

      backspaceAtStart(id, text) {
        const bs0 = blocks();
        const i = indexOf(id);
        const b = bs0[i];
        if (!isTextBlock(b)) return false;
        if (text === "") {
          if (bs0.length === 1) {
            if (b.type === "paragraph") return false;
            mutate((bs) => replaceText(bs, id, (x) => convertTextBlock(x, "paragraph", "")));
            focus({ id, target: "text", caret: 0 });
            return true;
          }
          const target = focusAfterRemoval(i);
          mutate((bs) => removeById(bs, id));
          focus(target);
          return true;
        }
        // A heading, list item, quote... first becomes plain text.
        if (b.type !== "paragraph") {
          mutate((bs) => replaceText(bs, id, (x) => convertTextBlock(x, "paragraph", text)));
          focus({ id, target: "text", caret: 0 });
          return true;
        }
        // Plain text joins the block above.
        const prev = bs0[i - 1];
        if (!isTextBlock(prev)) return false;
        const join = prev.text.length;
        mutate((bs) => {
          const p = bs.find((x) => x.id === prev.id);
          if (!isTextBlock(p)) return;
          p.text += text;
          removeById(bs, id);
        });
        focus({ id: prev.id, target: "text", caret: join });
        return true;
      },

      deleteAtEnd(id, text) {
        const bs0 = blocks();
        const i = indexOf(id);
        const next = bs0[i + 1];
        if (!isTextBlock(bs0[i]) || !isTextBlock(next)) return false;
        mutate((bs) => {
          const n = bs.find((x) => x.id === next.id);
          if (!isTextBlock(n)) return;
          setText(bs, id, text + n.text);
          removeById(bs, next.id);
        });
        focus({ id, target: "text", caret: text.length });
        return true;
      },

      navigate(id, dir) {
        const n = findTextNeighbor(blocks(), indexOf(id), dir);
        const row = n && rowsRef.current.get(n.id);
        if (!row) return false;
        row.focusText(dir < 0 ? "end" : "start");
        return true;
      },

      moveByKeyboard(id, delta, text, caret) {
        if (!moveBlock([...blocks()], id, delta)) return;
        mutate((bs) => {
          setText(bs, id, text);
          moveBlock(bs, id, delta);
        });
        focus({ id, target: "text", caret });
      },

      shortcut(id, match) {
        const b = blocks()[indexOf(id)];
        if (!isTextBlock(b) || kindOf(b) === match.kind) return false;
        mutate((bs) =>
          replaceText(bs, id, (x) => {
            const nb = convertTextBlock(x, match.kind, match.rest);
            if (nb.type === "todo" && match.checked) nb.checked = true;
            return nb;
          }),
        );
        focus({ id, target: "text", caret: 0 });
        return true;
      },

      slashPick(id, item, text, caret) {
        if (!isTextBlock(blocks()[indexOf(id)])) return;
        const action = item.action;
        if (action.kind === "studyKit") {
          // Keep what was written (without "/query") and open the dialog.
          mutate((bs) => setText(bs, id, text));
          if (action.make === "material") openStudyKit({ mode: "material" });
          else openStudyKit({ mode: "page", pageId, make: action.make === "page_quiz" ? "quiz" : "flashcards" });
          return;
        }
        if (action.kind === "text") {
          // A text type turns this block into it, keeping what was written.
          mutate((bs) => replaceText(bs, id, (x) => convertTextBlock(x, action.textKind, text)));
          focus({ id, target: "text", caret });
          return;
        }
        const empty = text.trim() === "";
        focus(
          insertItem(
            item,
            empty
              ? { afterId: id, replaceId: id, typing: true }
              : { afterId: id, text: { id, value: text }, typing: true },
          ),
        );
      },

      escape(id) {
        rowsRef.current.get(id)?.focusHandle();
      },

      openOptions(id) {
        const row = rowsRef.current.get(id);
        if (row?.openMenu) row.openMenu();
        else row?.focusHandle();
      },

      convert(id, kind: TextKind) {
        if (!isTextBlock(blocks()[indexOf(id)])) return null;
        mutate((bs) => replaceText(bs, id, (x) => convertTextBlock(x, kind)));
        return { id, target: "text", caret: "end" };
      },

      duplicate(id) {
        const b = blocks()[indexOf(id)];
        if (!b) return null;
        const copyId = newId();
        mutate((bs) => {
          const i = bs.findIndex((x) => x.id === id);
          if (i >= 0) bs.splice(i + 1, 0, duplicateBlock(bs[i], copyId));
        });
        return isTextBlock(b)
          ? { id: copyId, target: "text", caret: "end" }
          : { id: copyId, target: "handle" };
      },

      move(id, delta) {
        if (moveBlock([...blocks()], id, delta)) mutate((bs) => void moveBlock(bs, id, delta));
        return { id, target: "handle" };
      },

      remove(id) {
        const i = indexOf(id);
        if (i < 0) return null;
        const target = focusAfterRemoval(i);
        mutate((bs) => removeById(bs, id));
        return target;
      },

      insertFromMenu: (item, afterId) => insertItem(item, { afterId }),

      startWriting(where) {
        const bs = blocks();
        if (where === "top") {
          const first = findTextNeighbor(bs, -1, 1);
          if (first) return { id: first.id, target: "text", caret: "start" };
        } else {
          const last = bs[bs.length - 1];
          if (last?.type === "paragraph" && last.text === "") {
            return { id: last.id, target: "text", caret: "start" };
          }
        }
        const para = makeTextBlock("paragraph");
        mutate((d) => (where === "top" ? d.unshift(para) : d.push(para)));
        return { id: para.id, target: "text", caret: "start" };
      },

      focus,

      pageId,

      openInsert(afterId, anchor) {
        insertSeq.current += 1;
        setInsert({ afterId, anchor, seq: insertSeq.current });
      },

      getSlashItems: () => insertItemsRef.current,

      registerRow(id, handle) {
        rowsRef.current.set(id, handle);
        return () => {
          if (rowsRef.current.get(id) === handle) rowsRef.current.delete(id);
        };
      },

      startDrag(id, e: ReactPointerEvent) {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        const list = listRef.current;
        if (!list) return;
        const startY = e.clientY;
        let active = false;
        let before = -1;
        const rows = () => Array.from(list.querySelectorAll<HTMLElement>(":scope > [data-block-id]"));
        const rowEl = rows().find((r) => r.dataset.blockId === id);
        const scroller = list.closest<HTMLElement>(".overflow-y-auto");

        const onMove = (ev: PointerEvent) => {
          if (!active) {
            if (Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
            active = true;
            dragging = true;
            rowEl?.setAttribute("data-dragging", "true");
            document.body.style.cursor = "grabbing";
          }
          const rs = rows();
          before = rs.length;
          for (let i = 0; i < rs.length; i++) {
            const r = rs[i].getBoundingClientRect();
            if (ev.clientY < r.top + r.height / 2) {
              before = i;
              break;
            }
          }
          const last = rs[rs.length - 1];
          const top =
            before < rs.length ? rs[before].offsetTop : last ? last.offsetTop + last.offsetHeight : 0;
          setDropTop(top);
          if (scroller) {
            const s = scroller.getBoundingClientRect();
            if (ev.clientY < s.top + 48) scroller.scrollBy(0, -16);
            else if (ev.clientY > s.bottom - 48) scroller.scrollBy(0, 16);
          }
        };
        const finish = (commit: boolean) => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          window.removeEventListener("keydown", onKey, true);
          if (!active) return;
          rowEl?.removeAttribute("data-dragging");
          document.body.style.cursor = "";
          setDropTop(null);
          // The click that follows this pointerup must not open the menu.
          suppressClick.current = true;
          setTimeout(() => {
            suppressClick.current = false;
            dragging = false;
          }, 0);
          if (commit && before >= 0 && moveBlockTo([...blocks()], id, before)) {
            mutate((bs) => void moveBlockTo(bs, id, before));
          }
        };
        const onUp = () => finish(true);
        const onCancel = () => finish(false);
        const onKey = (ev: KeyboardEvent) => {
          if (ev.key === "Escape" && dragging) {
            ev.preventDefault();
            finish(false);
          }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        window.addEventListener("keydown", onKey, true);
      },

      consumeDragClick() {
        const s = suppressClick.current;
        suppressClick.current = false;
        return s;
      },
    };
  }, [update, pageId, dict]);

  const numbers = useMemo(() => listNumbers(page.blocks), [page.blocks]);

  const pickInsert = useCallback(
    (item: InsertItem) => {
      if (!insert) return;
      setInsert(null);
      editor.focus(editor.insertFromMenu(item, insert.afterId));
    },
    [editor, insert],
  );

  return (
    <EditorContext.Provider value={editor}>
      {/* Wide enough for a database's columns; prose keeps a comfortable
          line length inside it (PROSE). */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-16 sm:py-10 lg:px-20 lg:py-12">
        <header className={cn(PROSE, "mb-6 flex min-w-0 items-center gap-2 sm:mb-8 sm:gap-3")}>
          {/* The page's one h1, for screen readers and the document outline:
              the visible title is an editable field, which is not a heading. */}
          <h1 dir="auto" className="sr-only">
            {page.title.trim() || dict.editor.untitled}
          </h1>
          <DraftInput
            value={page.icon ?? ""}
            onCommit={(icon) =>
              update((d) => {
                const p = d.pages.find((x) => x.id === pageId);
                if (p) p.icon = icon;
              })
            }
            aria-label={dict.page.pageIcon}
            maxLength={8}
            className="w-12 rounded bg-transparent px-1 text-center text-3xl outline-none hover:bg-hover focus:bg-hover sm:w-14 sm:text-4xl"
          />
          <DraftInput
            ref={titleRef}
            value={page.title}
            dir="auto"
            aria-label={dict.page.pageTitle}
            onCommit={(title) =>
              update((d) => {
                const p = d.pages.find((x) => x.id === pageId);
                if (p) p.title = title;
              })
            }
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") {
                // Title done: start writing the page.
                e.preventDefault();
                editor.focus(editor.startWriting("top"));
              } else if (e.key === "ArrowDown") {
                const first = page.blocks.find(isTextBlock);
                if (!first) return;
                e.preventDefault();
                editor.focus({ id: first.id, target: "text", caret: "start" });
              }
            }}
            className="min-w-0 w-full rounded bg-transparent px-1 font-display text-3xl font-bold tracking-tight text-ink outline-none hover:bg-hover focus:bg-hover sm:text-4xl"
          />
        </header>

        <div ref={listRef} className="relative">
          {page.blocks.map((block, i) => (
            <BlockRow
              key={block.id}
              block={block}
              number={numbers[i]}
              isFirst={i === 0}
              isLast={i === page.blocks.length - 1}
            />
          ))}
          {dropTop !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 z-10 h-0.5 -translate-y-1/2 rounded bg-lime"
              style={{ top: dropTop }}
            />
          )}
        </div>

        <AddBlockButton
          label={dict.page.addBlock}
          onOpen={(anchor) => editor.openInsert(page.blocks.at(-1)?.id ?? null, anchor)}
        />
        {/* Clicking the empty space under the last block starts a new line. */}
        <div
          aria-hidden
          className="min-h-32 cursor-text"
          onClick={() => editor.focus(editor.startWriting("bottom"))}
        />
      </div>

      {insert && (
        <InsertMenu
          key={insert.seq}
          anchor={insert.anchor}
          items={insertItems}
          onPick={pickInsert}
          onClose={() => setInsert(null)}
        />
      )}
    </EditorContext.Provider>
  );
}

function AddBlockButton({ label, onOpen }: { label: string; onOpen: (anchor: HTMLElement) => void }) {
  const editor = useEditor();
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(
    () =>
      editor.registerRow(ADD_BUTTON, {
        focusText: () => ref.current?.focus(),
        focusHandle: () => ref.current?.focus(),
      }),
    [editor],
  );
  return (
    <div data-print="hide" className={cn(PROSE, "mt-2 ps-11 sm:ps-0")}>
      <button
        ref={ref}
        type="button"
        onClick={(e) => onOpen(e.currentTarget)}
        className="min-h-11 rounded-md px-1 text-sm text-ink-soft transition hover:text-ink sm:min-h-0 sm:py-1"
      >
        {label}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface RowProps {
  block: Block;
  number: number | undefined;
  isFirst: boolean;
  isLast: boolean;
}

/**
 * Every update clones the workspace, so block objects are always new; compare
 * by content so typing in one block never re-renders the other few hundred.
 */
function rowPropsEqual(a: RowProps, b: RowProps): boolean {
  return (
    a.number === b.number &&
    a.isFirst === b.isFirst &&
    a.isLast === b.isLast &&
    (a.block === b.block || JSON.stringify(a.block) === JSON.stringify(b.block))
  );
}

const BlockRow = memo(function BlockRow({ block, number, isFirst, isLast }: RowProps) {
  const editor = useEditor();
  const { dict } = useI18n();
  const textRef = useRef<BlockTextHandle>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const openMenuRef = useRef<(() => void) | null>(null);

  useLayoutEffect(
    () =>
      editor.registerRow(block.id, {
        focusText: (caret) =>
          textRef.current ? textRef.current.focus(caret) : handleRef.current?.focus(),
        focusHandle: () => handleRef.current?.focus(),
        openMenu: () => openMenuRef.current?.(),
      }),
    [editor, block.id],
  );

  return (
    <div
      data-block-id={block.id}
      className={cn(
        "group/row relative ps-11 data-[dragging=true]:opacity-40 sm:ps-0",
        // Databases use the page's full width; everything else reads at prose width.
        block.type !== "database_view" && PROSE,
      )}
    >
      <div data-print="hide" className="absolute start-0 top-0 z-[2] flex sm:-start-16">
        {/* Pointer shortcut only: keyboard users reach the same action through
            the handle's menu ("Add block below") or by typing "/". */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={dict.page.blockMenu.insertBlock}
          title={dict.page.blockMenu.addBelow}
          onClick={(e) => editor.openInsert(block.id, e.currentTarget)}
          className={cn(GUTTER_BUTTON, "hidden sm:grid")}
        >
          <Plus className="size-4" aria-hidden />
        </button>
        <BlockMenu
          block={block}
          isFirst={isFirst}
          isLast={isLast}
          handleRef={handleRef}
          openMenuRef={openMenuRef}
        />
      </div>
      {isTextBlock(block) ? (
        <TextBlockView block={block} number={number} textRef={textRef} />
      ) : (
        <BlockBody block={block} pageId={editor.pageId} />
      )}
    </div>
  );
}, rowPropsEqual);

/** Prose column: about 75 characters of body text, centred in the page. */
const PROSE = "mx-auto w-full max-w-[46rem]";

const WRAPPER: Partial<Record<TextKind, string>> = {
  heading1: "mt-7 mb-1",
  heading2: "mt-5 mb-1",
  heading3: "mt-4 mb-0.5",
  todo: "py-0.5",
  bulleted_list_item: "py-0.5",
  numbered_list_item: "py-0.5",
  quote: "my-1 border-s-2 border-line-strong py-0.5 ps-4",
  callout: "my-3 rounded-md border border-line bg-paper p-3 sm:p-4",
};

const TEXT: Partial<Record<TextKind, string>> = {
  heading1: "font-display text-2xl font-bold leading-snug",
  heading2: "font-display text-xl font-bold leading-snug",
  heading3: "font-display text-lg font-bold leading-snug",
  quote: "italic text-ink-soft",
};

function TextBlockView({
  block,
  number,
  textRef,
}: {
  block: TextBlock;
  number: number | undefined;
  textRef: React.RefObject<BlockTextHandle | null>;
}) {
  const editor = useEditor();
  const { dict } = useI18n();
  const kind = kindOf(block);
  const id = block.id;
  const label = textKindLabel(kind, dict);
  const placeholder =
    kind === "paragraph"
      ? dict.page.placeholders.paragraphHint
      : kind === "todo"
        ? dict.page.placeholders.todo
        : kind === "bulleted_list_item" || kind === "numbered_list_item"
          ? dict.page.placeholders.listItem
          : kind === "callout"
            ? dict.page.placeholders.callout
            : label;

  // The element tree is the same for every text kind, so converting a block
  // (shortcut, "/" menu, Turn into) keeps the same textarea and its focus.
  // BlockText follows outside changes (undo/redo, AI edits, another tab) by
  // itself, so it is deliberately not keyed by the workspace `rev`: a
  // remount would throw away the caret of whoever is typing.
  return (
    <>
    {/* A second version the sync engine kept (see editor/KeptCopyNote). */}
    {block.keptFrom && <KeptCopyNote pageId={editor.pageId} blockId={id} keptFrom={block.keptFrom} />}
    <div className={cn("flex min-w-0 items-start gap-2 py-1", WRAPPER[kind])}>
      <BlockMarker block={block} number={number} />
      <BlockText
        ref={textRef}
        value={block.text}
        label={label}
        placeholder={placeholder}
        placeholderOnFocus={kind === "paragraph"}
        className={cn(
          "text-[15px] leading-7 text-ink",
          TEXT[kind],
          block.type === "todo" && block.checked && "text-ink-faint line-through",
        )}
        onCommit={(text) => editor.commitText(id, text)}
        onEnter={(before, after) => editor.enter(id, before, after)}
        onBackspaceAtStart={(text) => editor.backspaceAtStart(id, text)}
        onDeleteAtEnd={(text) => editor.deleteAtEnd(id, text)}
        onNavigate={(dir) => editor.navigate(id, dir)}
        onMove={(delta, text, caret) => editor.moveByKeyboard(id, delta, text, caret)}
        onEscape={() => editor.escape(id)}
        onOptions={() => editor.openOptions(id)}
        onShortcut={(match) => editor.shortcut(id, match)}
        getSlashItems={editor.getSlashItems}
        onSlashPick={(item, text, caret) => editor.slashPick(id, item, text, caret)}
        slashLabels={{ menu: dict.page.blockMenu.insertMenu, empty: dict.page.blockMenu.noMatches }}
      />
    </div>
    </>
  );
}

/** The bullet, number, checkbox or emoji before a text block (or nothing). */
function BlockMarker({ block, number }: { block: TextBlock; number: number | undefined }) {
  const editor = useEditor();
  const { dict } = useI18n();
  switch (block.type) {
    case "todo":
      return (
        <label className="flex h-7 w-6 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={block.checked}
            aria-label={block.text.trim() || dict.page.blockTypes.todo}
            onChange={(e) => editor.setChecked(block.id, e.target.checked)}
            className="size-4 accent-lime"
          />
        </label>
      );
    case "bulleted_list_item":
      return (
        <span aria-hidden className="flex h-7 w-5 shrink-0 select-none items-center justify-center text-ink-faint">
          •
        </span>
      );
    case "numbered_list_item":
      return (
        <span className="h-7 min-w-6 shrink-0 select-none text-end text-[15px] leading-7 tabular-nums text-ink-soft">
          {number ?? 1}.
        </span>
      );
    case "callout":
      return (
        <DraftInput
          value={block.emoji ?? ""}
          onCommit={(emoji) => editor.setEmoji(block.id, emoji)}
          aria-label={dict.page.calloutIcon}
          maxLength={8}
          className="h-7 w-8 shrink-0 bg-transparent text-center text-xl outline-none"
        />
      );
    default:
      return null;
  }
}

/** Blocks that aren't text: rendered as before. */
function BlockBody({ block, pageId }: { block: Exclude<Block, TextBlock>; pageId: string }) {
  switch (block.type) {
    case "divider":
      return (
        <div className="flex h-10 items-center sm:h-8">
          <hr className="w-full border-line" />
        </div>
      );
    case "database_view":
      return <DatabaseView databaseId={block.databaseId} viewId={block.viewId} pageId={pageId} />;
    case "media":
      return (
        <figure className="my-3">
          {/* SVG is inert when loaded via <img>; never inline it. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- media serves a 302-redirect signed URL; next/image can't follow it */}
          <img
            src={mediaImgSrc(block.assetId)}
            alt={block.alt ?? block.caption ?? ""}
            className="max-w-full rounded-md border border-line"
          />
          {block.caption ? (
            <figcaption className="mt-1 text-center text-xs text-ink-soft">{block.caption}</figcaption>
          ) : null}
        </figure>
      );
    case "react_artifact":
      return <ReactArtifact source={block.source} title={block.title} />;
    case "flashcards":
      return <FlashcardsBlock pageId={pageId} block={block} />;
    case "quiz":
      return <QuizBlock pageId={pageId} block={block} />;
    case "grades":
      return <GradesBlock pageId={pageId} block={block} />;
    default:
      return null;
  }
}
