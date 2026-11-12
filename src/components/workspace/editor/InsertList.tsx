"use client";

import { useEffect } from "react";
import {
  FileStack,
  GraduationCap,
  Heading1,
  Heading2,
  Heading3,
  Layers,
  Lightbulb,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  SquareCheck,
  Table2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InsertItem, TextKind } from "./blockOps";

export const TEXT_KIND_ICONS: Record<TextKind, LucideIcon> = {
  paragraph: Type,
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  todo: SquareCheck,
  bulleted_list_item: List,
  numbered_list_item: ListOrdered,
  quote: Quote,
  callout: Lightbulb,
};

export function insertItemIcon(item: InsertItem): LucideIcon {
  switch (item.action.kind) {
    case "text":
      return TEXT_KIND_ICONS[item.action.textKind];
    case "divider":
      return Minus;
    case "database":
      return Table2;
    case "flashcards":
      return Layers;
    case "quiz":
      return ListChecks;
    case "grades":
      return GraduationCap;
    case "linked":
      return Link2;
    case "studyKit":
      return item.action.make === "material" ? FileStack : item.action.make === "page_quiz" ? ListChecks : Layers;
  }
}

export const optionId = (listId: string, index: number) => `${listId}-opt-${index}`;

/**
 * The listbox shared by the "/" menu and the "+" menu. Focus stays in the
 * field that drives it (textarea or search box), which points at the active
 * option with aria-activedescendant; options are also tappable.
 */
export function InsertList({
  id,
  label,
  items,
  activeIndex,
  emptyLabel,
  onPick,
  onActiveChange,
}: {
  id: string;
  label: string;
  items: InsertItem[];
  activeIndex: number;
  emptyLabel: string;
  onPick: (item: InsertItem) => void;
  onActiveChange: (index: number) => void;
}) {
  useEffect(() => {
    const el = document.getElementById(optionId(id, activeIndex));
    el?.scrollIntoView?.({ block: "nearest" });
  }, [id, activeIndex]);

  if (items.length === 0) {
    return <p className="px-3 py-2.5 text-sm text-ink-soft">{emptyLabel}</p>;
  }

  return (
    <ul id={id} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto overscroll-contain py-1">
      {items.map((item, i) => {
        const Icon = insertItemIcon(item);
        const active = i === activeIndex;
        return (
          <li
            key={item.id}
            id={optionId(id, i)}
            role="option"
            aria-selected={active}
            // Keep focus (and the phone keyboard) in the driving field.
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => {
              if (!active) onActiveChange(i);
            }}
            onClick={() => onPick(item)}
            className={cn(
              "flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-sm px-2 text-sm text-ink sm:min-h-9",
              active && "bg-hover",
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded border border-line bg-card text-ink-soft">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.hint && (
              <span className="shrink-0 font-mono text-[11px] text-ink-faint" aria-hidden>
                {item.hint}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
