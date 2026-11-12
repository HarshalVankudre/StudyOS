"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { useI18n } from "@/lib/i18n/client";
import { filterInsertItems, type InsertItem } from "./blockOps";
import { InsertList, optionId } from "./InsertList";

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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
