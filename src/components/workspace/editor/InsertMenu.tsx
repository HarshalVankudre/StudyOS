"use client";

import { useContext, useId, useMemo, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { FileStack, Layers, ListChecks } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { openStudyKit } from "../materials/events";
import {
  buildStudyKitItems,
  filterInsertItems,
  type InsertItem,
  type StudyKitMenuItem,
} from "./blockOps";
import { EditorContext } from "./EditorContext";
import { InsertList, optionId } from "./InsertList";

const STUDY_KIT_ICONS = {
  material: FileStack,
  page_flashcards: Layers,
  page_quiz: ListChecks,
} as const;

/**
 * The "+" insert menu: a searchable list of block types anchored to whatever
 * opened it (a row's "+" button, its block menu, or the page's "Add block"
 * button). Mounted only while open; one instance serves the whole page.
 */
export function InsertMenu({
  anchor,
  items,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  items: InsertItem[];
  onPick: (item: InsertItem) => void;
  onClose: () => void;
}) {
  const { dict, dir } = useI18n();
  const L = dict.page.blockMenu;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = useMemo(() => filterInsertItems(items, query), [items, query]);
  // The page this menu edits (for "from this page" actions).
  const pageId = useContext(EditorContext)?.pageId;
  const studyItems = useMemo(
    () => filterInsertItems(buildStudyKitItems(dict), query).filter((item) => pageId || item.action === "material"),
    [dict, query, pageId],
  );
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const picked = useRef(false);
  const interactedOutside = useRef(false);
  // Only ever mounted after a click, so `document` exists.
  const [virtualRef] = useState(() => ({ current: anchor ?? document.body }));

  const pick = (item: InsertItem) => {
    picked.current = true;
    onPick(item);
  };

  const pickStudyKit = (item: StudyKitMenuItem) => {
    picked.current = true;
    onClose();
    // The dialog hands focus back to whatever had it when it opened: make
    // that the button this menu came from, not the page body.
    if (anchor?.isConnected) anchor.focus();
    if (item.action === "material" || !pageId) openStudyKit({ mode: "material" });
    else openStudyKit({ mode: "page", pageId, make: item.action === "page_quiz" ? "quiz" : "flashcards" });
  };

  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Popover.Anchor virtualRef={virtualRef} />
      <Popover.Portal>
        <Popover.Content
          dir={dir}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          aria-label={L.insertMenu}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          onInteractOutside={() => {
            // The student clicked or tapped somewhere else: focus goes there.
            interactedOutside.current = true;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (!picked.current && !interactedOutside.current && anchor?.isConnected) {
              anchor.focus();
            }
          }}
          className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-line-strong bg-popover p-1 text-popover-foreground shadow-pop"
        >
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={filtered.length > 0 ? optionId(listId, active) : undefined}
            aria-label={L.search}
            placeholder={L.search}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              const count = filtered.length;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (count) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + count) % count);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = filtered[active];
                if (item) pick(item);
              }
            }}
            className="mb-1 w-full rounded-sm border border-line bg-paper px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-soft/60 focus:border-ink/30"
          />
          <InsertList
            id={listId}
            label={L.insertMenu}
            items={filtered}
            activeIndex={active}
            emptyLabel={L.noMatches}
            onPick={pick}
            onActiveChange={setActive}
          />
          {studyItems.length > 0 && (
            <div role="group" aria-label={dict.materials.menuSection} className="mt-1 border-t border-line pt-1">
              <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold text-ink-faint">{dict.materials.menuSection}</p>
              {studyItems.map((item) => {
                const Icon = STUDY_KIT_ICONS[item.action];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => pickStudyKit(item)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-sm px-2 text-start text-sm text-ink transition hover:bg-hover focus-visible:bg-hover focus-visible:outline-none sm:min-h-9"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded border border-line bg-card text-ink-soft">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
