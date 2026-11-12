/**
 * Turn a workspace's dated database rows into calendar events — the data
 * behind the ICS subscription feed. Pure and dependency-free.
 *
 * Any database property of type "date" becomes a source of all-day events:
 * every row with a value in that column yields one event, titled by the row's
 * title cell and its course, and described by the workspace, database and
 * column it comes from, so a student's assignment, exam and planner deadlines
 * all flow to their calendar with no extra setup and stay recognisable there.
 *
 * Completed rows (lib/workspace/view-logic `isRowComplete`) are left out
 * unless `includeCompleted` is set; when included, their title starts with ✓.
 *
 * The incoming deadline import (lib/feeds) recognises these events as
 * StudyOS's own by their UID (`…@studyos`), the calendar's PRODID, and, for a
 * calendar app that rewrote the UID, by the title (`rowEventSummaries`).
 */
import type { Database, DatabaseRow, Workspace } from "@/lib/workspace/types";
import { getOption, getProperty, titleProperty } from "@/lib/workspace/helpers";
import { isRowComplete } from "@/lib/workspace/view-logic";

export interface CalendarEvent {
  /** Stable across regenerations so calendar clients update rather than dupe. */
  uid: string;
  /** All-day date, YYYY-MM-DD. */
  date: string;
  summary: string;
  description?: string;
  /** Shown as tags by calendar apps: the course and the workspace. */
  categories?: string[];
  /** The row's title, its course and its workspace (to rebuild `summary`). */
  title: string;
  course?: string;
  workspaceName: string;
  /** True when the row is marked complete. */
  completed: boolean;
  /**
   * The row's identity WITHOUT the workspace (database, row, date column)
   * plus what the event says. Equal for an untouched copy of the row in a
   * duplicated workspace, which keeps its database and row ids; different as
   * soon as either copy's title, course or date is edited.
   */
  copyKey: string;
}

export interface WorkspaceEventOptions {
  /** Also emit rows marked complete (default: left out). */
  includeCompleted?: boolean;
  /** Put the workspace's name in every title (when a student has several). */
  workspaceInSummary?: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const COURSE_WORDS = /course|class|subject|module|kurs|cours|curso|corso|vak|科目|课程|講義|مقرر/i;
const DONE_MARK = "✓ ";

/** True only for a real calendar date — rejects e.g. 2026-99-99 or 2026-13-40. */
function isRealDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return (
    dt.getFullYear() === Number(y) &&
    dt.getMonth() === Number(mo) - 1 &&
    dt.getDate() === Number(d)
  );
}

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

/** The title text of a row (what the event is called). */
function rowTitle(db: Database, row: DatabaseRow): string {
  const raw = row.cells[titleProperty(db).id];
  return (typeof raw === "string" && raw.trim()) || "Untitled";
}

/**
 * Which course a row belongs to: the database's first select column (the
 * long-standing rule, which the import's echo check also follows), else a
 * relation column pointing at a courses-like database, by the related row's
 * title.
 */
function rowCourse(workspace: Workspace, db: Database, row: DatabaseRow): string | undefined {
  const title = titleProperty(db);
  const select = db.properties.find((p) => p.type === "select" && p.id !== title.id);
  if (select) return cellLabel(db, select.id, row);
  const relation = db.properties.find((p) => {
    if (p.type !== "relation" || !p.relationDatabaseId) return false;
    const target = workspace.databases.find((d) => d.id === p.relationDatabaseId);
    return COURSE_WORDS.test(p.name) || COURSE_WORDS.test(target?.name ?? "");
  });
  if (!relation) return undefined;
  const target = workspace.databases.find((d) => d.id === relation.relationDatabaseId);
  const ids = row.cells[relation.id];
  if (!target || !Array.isArray(ids)) return undefined;
  const labels = ids
    .map((id) => target.rows.find((r) => r.id === id))
    .filter((r): r is DatabaseRow => Boolean(r))
    .map((r) => rowTitle(target, r));
  return labels.join(", ") || undefined;
}

/** An event's title: "<title> · <course> · <workspace>", parts left out when unknown. */
export function eventSummary(parts: {
  title: string;
  course?: string;
  workspaceName?: string;
  completed?: boolean;
}): string {
  const text = [parts.title, parts.course, parts.workspaceName].filter(Boolean).join(" · ");
  return parts.completed ? `${DONE_MARK}${text}` : text;
}

/**
 * Every title the feed may have given this row's events (with or without the
 * workspace's name, open or completed), so the import can recognise them
 * when a calendar app republished them under its own UID.
 */
export function rowEventSummaries(workspace: Workspace, db: Database, row: DatabaseRow): string[] {
  const title = rowTitle(db, row);
  const course = rowCourse(workspace, db, row);
  const out = new Set<string>();
  for (const workspaceName of [undefined, workspace.name]) {
    for (const completed of [false, true]) {
      out.add(eventSummary({ title, course, workspaceName, completed }));
    }
  }
  return [...out];
}

/** All dated events across a workspace's databases. */
export function workspaceEvents(
  workspace: Workspace,
  opts: WorkspaceEventOptions = {},
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const workspaceName = workspace.name?.trim() || "StudyOS";
  for (const db of workspace.databases) {
    const dateProps = db.properties.filter((p) => p.type === "date");
    if (dateProps.length === 0) continue;

    for (const row of db.rows) {
      const completed = isRowComplete(db, row);
      if (completed && !opts.includeCompleted) continue;
      const title = rowTitle(db, row);
      const course = rowCourse(workspace, db, row);

      for (const dateProp of dateProps) {
        const raw = row.cells[dateProp.id];
        if (typeof raw !== "string" || !DATE_RE.test(raw)) continue;
        const date = raw.slice(0, 10);
        if (!isRealDay(date)) continue; // skip malformed dates, not the feed
        events.push({
          uid: `${workspace.id}-${db.id}-${row.id}-${dateProp.id}@studyos`,
          date,
          summary: eventSummary({
            title,
            course,
            workspaceName: opts.workspaceInSummary ? workspaceName : undefined,
            completed,
          }),
          description: [workspaceName, db.name, dateProp.name].filter(Boolean).join(" · "),
          categories: [course, workspaceName].filter((c): c is string => Boolean(c)),
          title,
          course,
          workspaceName,
          completed,
          copyKey: JSON.stringify([db.id, row.id, dateProp.id, date, title, course ?? "", completed]),
        });
      }
    }
  }
  return events;
}

export interface FeedOptions {
  /** Also include rows marked complete (the feed URL's `?completed=1`). */
  includeCompleted?: boolean;
}

/**
 * The events of several workspaces (oldest first) as one feed:
 *  - an untouched copy of a row in a duplicated workspace ("Duplicate" keeps
 *    database and row ids) is the same deadline, so it appears once, under
 *    the original; as soon as the copy's title, course or date is edited it
 *    is its own event;
 *  - when events come from more than one workspace, every title also names
 *    its workspace, so copies and parallel semesters stay distinguishable
 *    (the description and categories always do).
 */
export function mergeWorkspaceEvents(
  workspaces: readonly Workspace[],
  opts: FeedOptions = {},
): CalendarEvent[] {
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  const contributing = new Set<string>();
  for (const workspace of workspaces) {
    for (const event of workspaceEvents(workspace, { includeCompleted: opts.includeCompleted })) {
      if (seen.has(event.copyKey)) continue;
      seen.add(event.copyKey);
      contributing.add(workspace.id);
      events.push(event);
    }
  }
  if (contributing.size > 1) {
    for (const event of events) event.summary = eventSummary(event);
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
