/**
 * Bring calendar events into a database, and keep them in sync, without ever
 * duplicating a row, overwriting what the student typed, or deleting a row.
 *
 * Pure and deterministic given its inputs: the editor runs it inside the
 * workspace `update()` mutator (so an import or re-sync is one undoable step
 * that autosave stores through the version-checked path), and may run it
 * again when it replays edits on top of a newer saved version.
 *
 * Rules, in plain terms:
 *  - A row and its event are linked by `row.source.key` (the event UID). A
 *    row that lost its link (copied by hand, rewritten by the AI agent) is
 *    linked again when its title matches; a row StudyOS published to the
 *    student's calendar and that calendar now sends back (the echo) is
 *    recognised by title and day and never added twice.
 *  - Each mapped field remembers the value the import last wrote
 *    (`source.synced`). A cell still holding that value follows the feed; a
 *    cell the student changed is theirs and is left alone.
 *  - New events: an explicit import adds exactly the events the student
 *    ticked; a re-sync adds only events it has never decided on before
 *    (`seen`), so an event the student skipped, or a row they deleted, does
 *    not come back.
 *  - An event that disappears from its feed flags its row (`missingSince`);
 *    the row is never removed. If the event returns, the flag is cleared.
 */
import { rowEventSummaries } from "@/lib/calendar/events";
import { titleProperty } from "@/lib/workspace/helpers";
import { completionField } from "@/lib/workspace/view-logic";
import type {
  CellValue,
  Database,
  DatabaseProperty,
  DatabaseRow,
  RowSource,
  Workspace,
} from "@/lib/workspace/types";
import { courseLabel, matchCourse, normalizeLabel, relationLabels, type FeedMapping, type MappedField } from "./mapping";
import { eventDay, type FeedEvent } from "./normalize";

export const FILE_FEED = "file";
/** New rows a single run may add (keeps one import inside the workspace size cap). */
export const MAX_NEW_ROWS_PER_RUN = 400;

const OPTION_COLORS = ["blue", "violet", "emerald", "amber", "rose", "sky", "indigo", "teal", "orange", "pink"];

export interface ApplyOptions {
  databaseId: string;
  /** CalendarFeed id, or FILE_FEED for an uploaded file. */
  feedId: string;
  mapping: FeedMapping;
  /** The student's local day (YYYY-MM-DD). */
  today: string;
  /** IANA zone used to turn instants into days (the browser's when omitted). */
  timeZone?: string;
  mode: "import" | "sync";
  /** import: keys of the events the student chose to add. */
  selected?: ReadonlySet<string>;
  /** sync: keys already decided on in an earlier run. */
  seen?: ReadonlySet<string>;
  /** sync: repeating events (series keys) the student chose to follow. */
  series?: ReadonlySet<string>;
  /** Oldest day the feed still covers; older rows are never flagged. */
  horizonDay?: string;
  /** Ids and names for columns the mapping asks to create ("new"). */
  newColumns: { due: { id: string; name: string }; course: { id: string; name: string }; link: { id: string; name: string } };
  newId?: () => string;
}

export type ChangeKind = "added" | "updated" | "flagged" | "restored" | "linked";

export interface FeedChange {
  kind: ChangeKind;
  key: string;
  title: string;
  /** For "updated": which fields followed the feed. */
  fields?: MappedField[];
}

export interface ApplyResult {
  changes: FeedChange[];
  /** Keys decided on in this run (to remember as seen). */
  considered: string[];
  /** Fields left alone because the student had edited them. */
  keptEdits: number;
  /** New events not added because the per-run cap was reached. */
  deferred: number;
  /** The mapping with created columns filled in. */
  mapping: FeedMapping;
}

export function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

/** The same title, ignoring case, spacing and punctuation. */
function titleKey(text: string): string {
  return normalizeLabel(text);
}

/** Default choice for an event the student has not decided on. */
export function isDefaultSelected(event: FeedEvent, today: string, timeZone?: string): boolean {
  if (event.series) return false;
  if (event.role === "opening") return false;
  return eventDay(event.when, timeZone) >= today;
}

function propById(db: Database, id: string | null | undefined): DatabaseProperty | undefined {
  return id ? db.properties.find((p) => p.id === id) : undefined;
}

/** Create the columns a mapping asks for and return the resolved mapping. */
function ensureColumns(db: Database, opts: ApplyOptions): FeedMapping {
  const mapping = { ...opts.mapping };
  const create = (field: "due" | "course" | "link", type: DatabaseProperty["type"]) => {
    if (mapping[field] !== "new") return;
    const spec = opts.newColumns[field];
    if (!db.properties.some((p) => p.id === spec.id)) {
      db.properties.push(type === "select" ? { id: spec.id, name: spec.name, type, options: [] } : { id: spec.id, name: spec.name, type });
    }
    mapping[field] = spec.id;
  };
  create("due", "date");
  create("course", "select");
  create("link", "url");
  return mapping;
}

class CourseResolver {
  constructor(
    private ws: Workspace,
    private prop: DatabaseProperty,
    private newId: () => string,
  ) {}

  /** The cell value for this course, without creating anything (null = not found). */
  find(course: string): CellValue | null {
    const { prop } = this;
    if (prop.type === "text") return course;
    if (prop.type === "relation") {
      const rel = relationLabels(this.ws, prop);
      if (!rel) return null;
      const i = matchCourse(course, rel.labels);
      return i === -1 ? null : [rel.db.rows[i].id];
    }
    const options = prop.options ?? [];
    const i = matchCourse(course, options.map((o) => o.label));
    if (i === -1) return null;
    return prop.type === "multi_select" ? [options[i].id] : options[i].id;
  }

  /** The cell value, creating the course option (or related row) when missing. */
  ensure(course: string): CellValue | null {
    const found = this.find(course);
    if (found !== null) return found;
    const { prop } = this;
    const label = courseLabel(course);
    if (!label) return null;
    if (prop.type === "relation") {
      const target = this.ws.databases.find((d) => d.id === prop.relationDatabaseId);
      const title = target ? titleProperty(target) : undefined;
      if (!target || !title) return null;
      const id = this.newId();
      target.rows.push({ id, cells: { [title.id]: label } });
      return [id];
    }
    if (prop.type !== "select" && prop.type !== "multi_select") return null;
    const options = (prop.options = prop.options ?? []);
    const id = this.newId();
    options.push({ id, label, color: OPTION_COLORS[options.length % OPTION_COLORS.length] });
    return prop.type === "multi_select" ? [id] : id;
  }
}

function statusValue(db: Database, prop: DatabaseProperty | undefined, completed: boolean): CellValue | undefined {
  if (!prop) return undefined;
  if (prop.type === "checkbox") return completed;
  const field = completionField(db);
  if (field && field.property.id === prop.id) {
    const value = completed ? field.doneValue : field.openValue;
    return typeof value === "boolean" ? undefined : value;
  }
  const first = prop.options?.[0]?.id;
  return completed ? undefined : first;
}

export function applyFeedEvents(ws: Workspace, events: FeedEvent[], opts: ApplyOptions): ApplyResult {
  const result: ApplyResult = { changes: [], considered: [], keptEdits: 0, deferred: 0, mapping: opts.mapping };
  const db = ws.databases.find((d) => d.id === opts.databaseId);
  if (!db) return result;
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const mapping = (result.mapping = ensureColumns(db, opts));

  const titleProp = propById(db, mapping.title) ?? titleProperty(db);
  const dueProp = propById(db, mapping.due);
  const linkProp = propById(db, mapping.link);
  const courseProp = propById(db, mapping.course);
  const statusProp = propById(db, mapping.status);
  const courses = courseProp ? new CourseResolver(ws, courseProp, newId) : null;

  // Echo signatures of a row in StudyOS's own feed: the titles the feed
  // gives its events ("<title> · <course>", with the workspace's name, ✓ when
  // done), built by the feed's own formatter so the two never drift apart.
  const rowTitleText = (row: DatabaseRow) => (titleProp ? cellText(row.cells[titleProp.id]).trim() : "");
  const echoCache = new Map<DatabaseRow, string[]>();
  const echoTitles = (row: DatabaseRow) => {
    let titles = echoCache.get(row);
    if (!titles) {
      const own = titleKey(rowTitleText(row));
      titles = rowEventSummaries(ws, db, row).filter((t) => titleKey(t) !== own);
      echoCache.set(row, titles);
    }
    return titles;
  };

  const byKey = new Map<string, DatabaseRow>();
  for (const row of db.rows) {
    if (row.source && !byKey.has(row.source.key)) byKey.set(row.source.key, row);
  }
  const claimed = new Set<DatabaseRow>(byKey.values());

  /** Rows that already hold this event under another identity. */
  const sameTitleRows = (event: FeedEvent, day: string) => {
    const wanted = titleKey(event.title);
    if (!wanted) return { plain: undefined, echo: undefined };
    const dayMatches = (row: DatabaseRow) => {
      if (!dueProp) return true;
      const due = cellText(row.cells[dueProp.id]);
      return due === "" || due === day;
    };
    let plain: DatabaseRow | undefined;
    let echo: DatabaseRow | undefined;
    for (const row of db.rows) {
      if (!dayMatches(row)) continue;
      if (titleKey(rowTitleText(row)) === wanted) {
        if (!plain || (!row.source && plain.source)) plain = row;
      } else if (echoTitles(row).some((sig) => titleKey(sig) === wanted)) {
        echo = echo ?? row;
      }
    }
    return { plain, echo };
  };

  const seriesKeys = new Set(events.filter((e) => e.series).map((e) => e.series!));
  const eventKeys = new Set<string>();
  let added = 0;

  for (const event of events) {
    if (eventKeys.has(event.key)) continue;
    eventKeys.add(event.key);
    const day = eventDay(event.when, opts.timeZone);
    const isNewDecision = opts.mode === "import" || !opts.seen?.has(event.key);

    let row = byKey.get(event.key);
    let linkedNow = false;
    if (!row) {
      const { plain, echo } = sameTitleRows(event, day);
      if (plain && !plain.source && !claimed.has(plain)) {
        // A row with this title and day but no link: the same deadline.
        plain.source = { kind: "ical", feed: opts.feedId, key: event.key };
        claimed.add(plain);
        byKey.set(event.key, plain);
        row = plain;
        linkedNow = true;
      } else if (plain || echo) {
        // Already in the table under another link, or StudyOS's own echo.
        if (isNewDecision) result.considered.push(event.key);
        continue;
      }
    }

    if (row) {
      const changed = syncRow(row, event, day);
      if (linkedNow) result.changes.push({ kind: "linked", key: event.key, title: event.title });
      else if (changed.length) result.changes.push({ kind: "updated", key: event.key, title: event.title, fields: changed });
      if (isNewDecision) result.considered.push(event.key);
      continue;
    }

    // A new event.
    let add: boolean;
    if (opts.mode === "import") add = opts.selected?.has(event.key) ?? false;
    else if (!isNewDecision) add = false;
    else if (event.series) add = Boolean(opts.series?.has(event.series)) && day >= opts.today;
    else add = isDefaultSelected(event, opts.today, opts.timeZone);

    if (add && added >= MAX_NEW_ROWS_PER_RUN) {
      result.deferred += 1;
      continue; // not considered: a later run picks it up
    }
    if (isNewDecision) result.considered.push(event.key);
    if (!add) continue;

    const created = createRow(event, day);
    db.rows.push(created);
    byKey.set(event.key, created);
    claimed.add(created);
    added += 1;
    result.changes.push({ kind: "added", key: event.key, title: event.title });
  }

  // Events gone from a connected feed: flag the row, never remove it.
  if (opts.feedId !== FILE_FEED) {
    for (const row of db.rows) {
      const src = row.source;
      if (!src || src.feed !== opts.feedId || eventKeys.has(src.key)) continue;
      const hash = src.key.indexOf("#");
      if (hash !== -1 && seriesKeys.has(src.key.slice(0, hash))) continue; // occurrence outside the window
      const due = dueProp ? cellText(row.cells[dueProp.id]) : (src.synced?.due ?? "");
      if (opts.horizonDay && due && due < opts.horizonDay) continue; // older than the feed reaches
      if (src.missingSince) continue;
      src.missingSince = opts.today;
      result.changes.push({ kind: "flagged", key: src.key, title: rowTitleText(row) });
    }
  }
  return result;

  // -------------------------------------------------------------------------

  function createRow(event: FeedEvent, day: string): DatabaseRow {
    const cells: Record<string, CellValue> = {};
    const synced: NonNullable<RowSource["synced"]> = {};
    if (titleProp) {
      cells[titleProp.id] = event.title;
      synced.title = event.title;
    }
    if (dueProp) {
      cells[dueProp.id] = day;
      synced.due = day;
    }
    if (linkProp && event.link) {
      cells[linkProp.id] = event.link;
      synced.link = event.link;
    }
    if (courseProp && courses && event.course) {
      const value = courses.ensure(event.course);
      if (value !== null) {
        cells[courseProp.id] = value;
        synced.course = cellText(value);
      }
    }
    const status = statusValue(db!, statusProp, Boolean(event.completed));
    if (statusProp && status !== undefined) cells[statusProp.id] = status;
    return { id: newId(), cells, source: { kind: "ical", feed: opts.feedId, key: event.key, synced } };
  }

  /** Follow the feed in the fields the student has not edited. */
  function syncRow(row: DatabaseRow, event: FeedEvent, day: string): MappedField[] {
    const src = (row.source = row.source ?? { kind: "ical", feed: opts.feedId, key: event.key });
    if (src.feed === FILE_FEED && opts.feedId !== FILE_FEED) src.feed = opts.feedId;
    if (src.missingSince) {
      delete src.missingSince;
      result.changes.push({ kind: "restored", key: event.key, title: event.title });
    }
    const synced = (src.synced = { ...(src.synced ?? {}) });
    const changed: MappedField[] = [];

    const follow = (
      field: "title" | "due" | "link" | "course",
      prop: DatabaseProperty | undefined,
      wantedText: string | null,
      write: () => CellValue | null,
    ) => {
      if (!prop || wantedText === null) return;
      const current = cellText(row.cells[prop.id]);
      const last = synced[field];
      if (last === undefined) {
        if (current === "") {
          const value = write();
          if (value === null) return;
          row.cells[prop.id] = value;
          synced[field] = cellText(value);
          changed.push(field);
        } else if (current === wantedText) {
          synced[field] = current;
        } else {
          result.keptEdits += 1;
        }
        return;
      }
      if (current !== last) {
        if (current !== wantedText) result.keptEdits += 1;
        return;
      }
      if (wantedText === last) return;
      const value = write();
      if (value === null) return;
      row.cells[prop.id] = value;
      synced[field] = cellText(value);
      changed.push(field);
    };

    follow("title", titleProp, event.title || null, () => event.title);
    follow("due", dueProp, day, () => day);
    follow("link", linkProp, event.link ?? null, () => event.link ?? null);
    if (courseProp && courses && event.course) {
      const found = courses.find(event.course);
      // An unknown course has no value yet: compare against a marker so a
      // changed course is detected, and create it only when it is written.
      const wanted = found !== null ? cellText(found) : `\u0000${event.course}`;
      follow("course", courseProp, wanted, () => courses.ensure(event.course!));
    }
    if (Object.keys(synced).length === 0) delete src.synced;
    return changed;
  }
}

/** What an import would do with each event, for the preview. */
export type EventStatus = "new" | "inTable" | "echo";

export function classifyEvents(
  ws: Workspace,
  databaseId: string,
  events: FeedEvent[],
  mapping: FeedMapping,
  timeZone?: string,
): Map<string, EventStatus> {
  const out = new Map<string, EventStatus>();
  const db = ws.databases.find((d) => d.id === databaseId);
  if (!db) return out;
  const keys = new Set(db.rows.map((r) => r.source?.key).filter(Boolean) as string[]);
  const titleProp = propById(db, mapping.title) ?? titleProperty(db);
  const dueProp = propById(db, typeof mapping.due === "string" && mapping.due !== "new" ? mapping.due : null);
  const index = new Map<string, "plain" | "echo">();
  for (const row of db.rows) {
    const title = titleProp ? cellText(row.cells[titleProp.id]).trim() : "";
    const due = dueProp ? cellText(row.cells[dueProp.id]) : "";
    index.set(`${titleKey(title)}|${due}`, "plain");
    // The titles StudyOS's own feed gives this row's events (see lib/calendar/events).
    for (const summary of rowEventSummaries(ws, db, row)) {
      const sig = `${titleKey(summary)}|${due}`;
      if (!index.has(sig)) index.set(sig, "echo");
    }
  }
  for (const event of events) {
    if (keys.has(event.key)) {
      out.set(event.key, "inTable");
      continue;
    }
    const day = eventDay(event.when, timeZone);
    const hit = index.get(`${titleKey(event.title)}|${dueProp ? day : ""}`) ?? index.get(`${titleKey(event.title)}|`);
    out.set(event.key, hit === "echo" ? "echo" : hit ? "inTable" : "new");
  }
  return out;
}
