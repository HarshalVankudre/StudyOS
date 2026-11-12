"use client";

import { useSyncExternalStore } from "react";
import type {
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView as DBView,
  PropertyType,
  Workspace,
} from "@/lib/workspace/types";
import { getOption, titleProperty } from "@/lib/workspace/helpers";
import { completionField, dayKeyOf, type RelationLabeler } from "@/lib/workspace/view-logic";

export const VIEW_TYPES: DBView["type"][] = ["table", "board", "calendar", "list", "gallery"];

export const PROPERTY_TYPES: PropertyType[] = [
  "text",
  "number",
  "checkbox",
  "date",
  "select",
  "multi_select",
  "status",
  "url",
  "relation",
];

/** Rows rendered at once before a "Show more" button (keeps 500-row databases fast). */
export const PAGE_SIZE = 100;
/** Cards rendered per board column before "Show more". */
export const BOARD_PAGE_SIZE = 50;

/** The view's columns, in its saved order (all properties, title / date / status first, when it has no list). */
export function visibleProps(db: Database, view: DBView): DatabaseProperty[] {
  if (view.visiblePropertyIds) {
    const shown = view.visiblePropertyIds
      .map((id) => db.properties.find((p) => p.id === id))
      .filter((p): p is DatabaseProperty => Boolean(p));
    if (shown.length > 0) return shown;
  }
  return defaultPropertyOrder(db);
}

/**
 * Column order for a view that has not chosen its own: the title, then when
 * it is due and where it stands (the first date and the status field), then
 * the rest as the database lists them. What a student scans for comes first,
 * so it is in view without scrolling sideways.
 */
export function defaultPropertyOrder(db: Database): DatabaseProperty[] {
  const title = titleProperty(db);
  const date = db.properties.find((p) => p.type === "date");
  const status =
    completionField(db)?.property ?? db.properties.find((p) => p.type === "status");
  const front: DatabaseProperty[] = [];
  for (const p of [title, date, status]) {
    if (p && !front.includes(p)) front.push(p);
  }
  return [...front, ...db.properties.filter((p) => !front.includes(p))];
}

/** Every property: the visible ones in view order, then the hidden ones. */
export function orderedProps(db: Database, view: DBView): { prop: DatabaseProperty; visible: boolean }[] {
  const visible = visibleProps(db, view);
  const ids = new Set(visible.map((p) => p.id));
  return [
    ...visible.map((prop) => ({ prop, visible: true })),
    ...db.properties.filter((p) => !ids.has(p.id)).map((prop) => ({ prop, visible: false })),
  ];
}

export function rowTitle(db: Database, row: DatabaseRow): string {
  const title = titleProperty(db);
  const value = title ? row.cells[title.id] : null;
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

/** Color of the row's first select option, used to tint calendar events. */
export function rowAccent(db: Database, row: DatabaseRow): string | undefined {
  const sel = db.properties.find((p) => p.type === "select");
  if (!sel) return undefined;
  const v = row.cells[sel.id];
  return getOption(sel, typeof v === "string" ? v : "")?.color;
}

/** The date property a view treats as each row's deadline. */
export function deadlineProp(db: Database, view: DBView): DatabaseProperty | undefined {
  return (
    db.properties.find((p) => p.id === view.datePropertyId && p.type === "date") ??
    db.properties.find((p) => p.type === "date")
  );
}

/** Labels for related rows, cached per related database. */
export function relationLabeler(workspace: Workspace, untitled: string): RelationLabeler {
  const cache = new Map<string, Map<string, string>>();
  return (prop, rowId) => {
    const dbId = prop.relationDatabaseId;
    if (!dbId) return undefined;
    let labels = cache.get(dbId);
    if (!labels) {
      labels = new Map();
      const related = workspace.databases.find((d) => d.id === dbId);
      if (related) {
        for (const row of related.rows) labels.set(row.id, rowTitle(related, row) || untitled);
      }
      cache.set(dbId, labels);
    }
    return labels.get(rowId);
  };
}

// ---------------------------------------------------------------------------
// Today (the viewer's local calendar day)

function subscribeToClock(onChange: () => void) {
  const id = window.setInterval(onChange, 60_000);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/**
 * The viewer's local day as YYYY-MM-DD, re-checked every minute so "today"
 * rolls over at midnight. Null during server rendering and hydration (the
 * server cannot know the viewer's time zone), then the real day.
 */
export function useToday(): string | null {
  return useSyncExternalStore(
    subscribeToClock,
    () => dayKeyOf(new Date()),
    () => null,
  );
}

/**
 * First day of the week for the interface language in the student's region
 * (0 Sunday, 1 Monday, 6 Saturday): English in the UK starts on Monday.
 */
export { weekStartFor } from "@/lib/i18n/regional";

export function formatDay(day: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}
