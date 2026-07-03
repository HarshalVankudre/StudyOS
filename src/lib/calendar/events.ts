/**
 * Turn a workspace's dated database rows into calendar events — the data
 * behind the ICS subscription feed. Pure and dependency-free.
 *
 * Any database property of type "date" becomes a source of all-day events:
 * every row with a value in that column yields one event, titled by the row's
 * title cell and enriched with its course/select context. This means a
 * student's assignment, exam, and planner deadlines all flow to their calendar
 * with no extra setup.
 */
import type { Database, DatabaseRow, Workspace } from "@/lib/workspace/types";
import { getOption, getProperty, titleProperty } from "@/lib/workspace/helpers";

export interface CalendarEvent {
  /** Stable across regenerations so calendar clients update rather than dupe. */
  uid: string;
  /** All-day date, YYYY-MM-DD. */
  date: string;
  summary: string;
  description?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** Render a select/status/text cell to a human label (option id → label). */
function cellLabel(db: Database, propId: string, row: DatabaseRow): string | undefined {
  const prop = getProperty(db, propId);
  const value = row.cells[propId];
  if (prop == null || value == null) return undefined;
  if (prop.type === "select" || prop.type === "status") {
    return getOption(prop, String(value))?.label;
  }
  if (prop.type === "multi_select" && Array.isArray(value)) {
    return value.map((v) => getOption(prop, v)?.label).filter(Boolean).join(", ") || undefined;
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value) || undefined;
  }
  return undefined;
}

/** All dated events across a workspace's databases. */
export function workspaceEvents(workspace: Workspace): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const db of workspace.databases) {
    const dateProps = db.properties.filter((p) => p.type === "date");
    if (dateProps.length === 0) continue;
    const title = titleProperty(db);
    // First select property (if any) is treated as the row's "course"/category.
    const categoryProp = db.properties.find(
      (p) => p.type === "select" && p.id !== title.id,
    );

    for (const row of db.rows) {
      const rawTitle = row.cells[title.id];
      const titleText =
        (typeof rawTitle === "string" && rawTitle.trim()) || "Untitled";
      const category = categoryProp
        ? cellLabel(db, categoryProp.id, row)
        : undefined;

      for (const dateProp of dateProps) {
        const raw = row.cells[dateProp.id];
        if (typeof raw !== "string" || !DATE_RE.test(raw)) continue;
        const date = raw.slice(0, 10);
        const summary = category ? `${titleText} · ${category}` : titleText;
        const parts = [db.name, dateProp.name].filter(Boolean);
        events.push({
          uid: `${workspace.id}-${db.id}-${row.id}-${dateProp.id}@studyos`,
          date,
          summary,
          description: parts.join(" · "),
        });
      }
    }
  }
  return events;
}
