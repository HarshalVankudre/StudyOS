/**
 * Pure database-view logic: calendar-day math, sorting, filtering, search,
 * completion detection and number summaries.
 *
 * No React and no browser APIs, so the editor, the Daily Study Agent and any
 * server code can share exactly the same rules. Dates are stored as local
 * calendar days ("YYYY-MM-DD") and every function takes `today` as a day key
 * supplied by the caller (the viewer's local day), so the result never depends
 * on the machine's time zone. Day arithmetic runs on UTC midnights, which have
 * no daylight-saving gaps.
 */
import type {
  CellValue,
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  FilterOperator,
  PropertyType,
  SelectOption,
  ViewFilter,
  ViewSort,
} from "./types";

// ---------------------------------------------------------------------------
// Calendar days

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** True for a real calendar day written as YYYY-MM-DD (rejects 2026-02-30). */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dayToUtc(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

function utcToDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function dayDiff(from: string, to: string): number {
  return Math.round((dayToUtc(to) - dayToUtc(from)) / MS_PER_DAY);
}

/** The day `n` calendar days after `day` (n may be negative). */
export function addDays(day: string, n: number): string {
  return utcToDay(dayToUtc(day) + n * MS_PER_DAY);
}

/** Build a day key from a year, a 0-based month and a day of the month. */
export function makeDayKey(year: number, month0: number, date: number): string {
  return utcToDay(Date.UTC(year, month0, date));
}

/**
 * The calendar day of an instant: in `timeZone` (an IANA name such as
 * "Europe/Berlin") when given, otherwise in the runtime's local time zone.
 * Servers should pass the user's time zone; browsers can omit it.
 */
export function dayKeyOf(date: Date, timeZone?: string): string {
  if (!timeZone) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Resolve a filter's date value ("YYYY-MM-DD" or a relative word) to a day. */
export function resolveDayValue(value: unknown, today: string): string | null {
  if (isDayKey(value)) return value;
  if (typeof value !== "string") return null;
  const word = value.trim().toLowerCase();
  if (word === "today") return today;
  if (word === "tomorrow") return addDays(today, 1);
  if (word === "yesterday") return addDays(today, -1);
  // Tolerate a full ISO timestamp by taking its calendar day.
  const prefix = word.slice(0, 10);
  return isDayKey(prefix) ? prefix : null;
}

/**
 * The cells of a month grid: leading blanks (null) up to the first weekday,
 * then every day key of the month, padded with blanks to whole weeks.
 * `weekStart` is 0 for Sunday, 1 for Monday, 6 for Saturday.
 */
export function monthGrid(year: number, month0: number, weekStart = 0): (string | null)[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() - weekStart + 7) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(makeDayKey(year, month0, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** How to express a day offset in words: days up to two weeks, then weeks, then months. */
export function relativeUnit(days: number): { value: number; unit: "day" | "week" | "month" } {
  const abs = Math.abs(days);
  if (abs <= 13) return { value: days, unit: "day" };
  if (abs <= 60) return { value: Math.round(days / 7), unit: "week" };
  return { value: Math.round(days / 30), unit: "month" };
}

// ---------------------------------------------------------------------------
// Completion ("is this row done?")

const COMPLETE_WORDS = new Set([
  "done", "complete", "completed", "finished", "submitted", "read", "archived",
  "hecho", "completado", "terminado", "entregado", "leído", "leido",
  "erledigt", "fertig", "abgeschlossen", "eingereicht", "gelesen",
  "terminé", "fini", "soumis", "lu", "fait",
  "completato", "fatto", "finito", "consegnato", "letto",
  "concluído", "concluido", "feito", "entregue", "lido",
  "voltooid", "klaar", "gedaan", "ingeleverd", "gelezen",
  "完成", "已完成", "已读", "完了", "済", "済み", "読了", "提出済み",
  "مكتمل", "تم", "منجز", "مقروء",
]);

const COMPLETE_FIELD_WORDS = [
  ...COMPLETE_WORDS,
  "status", "state", "progress", "estado", "statut", "stato", "voortgang",
  "状态", "ステータス", "الحالة",
];

const GREEN = new Set(["green", "emerald"]);

function norm(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isCompleteOption(prop: DatabaseProperty, option: SelectOption): boolean {
  if (COMPLETE_WORDS.has(norm(option.label))) return true;
  // A status whose last option is green is the usual "Done" convention.
  const options = prop.options ?? [];
  return (
    prop.type === "status" &&
    options.length >= 2 &&
    options[options.length - 1].id === option.id &&
    GREEN.has(option.color ?? "")
  );
}

function isCompletionCheckbox(prop: DatabaseProperty): boolean {
  const name = norm(prop.name);
  return prop.type === "checkbox" && COMPLETE_FIELD_WORDS.some((w) => name === w || name.includes(w));
}

/**
 * How a row is marked complete in this database, if it can be told: a status
 * (or select) with a "done" option, else a checkbox named like "Done" / "Read".
 * `doneValue` completes a row; `openValue` reopens it.
 */
export interface CompletionField {
  property: DatabaseProperty;
  doneValue: string | boolean;
  /** Option ids (or `false`) that count as done, for status/select fields. */
  doneValues: (string | boolean)[];
  openValue: string | boolean | null;
}

export function completionField(db: Database): CompletionField | null {
  for (const type of ["status", "select"] as const) {
    for (const prop of db.properties) {
      if (prop.type !== type) continue;
      const done = (prop.options ?? []).filter((o) => isCompleteOption(prop, o));
      if (done.length === 0) continue;
      const open = (prop.options ?? []).find((o) => !done.includes(o));
      return {
        property: prop,
        doneValue: done[done.length - 1].id,
        doneValues: done.map((o) => o.id),
        openValue: open?.id ?? null,
      };
    }
  }
  const checkbox = db.properties.find(isCompletionCheckbox);
  if (checkbox) {
    return { property: checkbox, doneValue: true, doneValues: [true], openValue: false };
  }
  return null;
}

/** True when the row's completion field says it is done. */
export function isRowComplete(db: Database, row: DatabaseRow, field = completionField(db)): boolean {
  if (!field) return false;
  const value = row.cells[field.property.id];
  return value !== null && value !== undefined && field.doneValues.includes(value as string | boolean);
}

/** Filters meaning "not complete", or [] when completion cannot be told. */
export function notCompleteFilters(db: Database): ViewFilter[] {
  const field = completionField(db);
  if (!field) return [];
  if (field.property.type === "checkbox") {
    return [{ propertyId: field.property.id, operator: "is", value: false }];
  }
  return [
    {
      propertyId: field.property.id,
      operator: "is_not",
      value: field.doneValues.filter((v): v is string => typeof v === "string"),
    },
  ];
}

// ---------------------------------------------------------------------------
// Deadlines

export type DueTone = "overdue" | "today" | "soon" | "week" | "later" | "past" | "done";

/**
 * Where a date sits relative to today, for deadline styling. Completed rows
 * never read as overdue: a finished assignment from last week is just "past".
 */
export function dueInfo(
  day: CellValue | undefined,
  today: string,
  complete = false,
): { days: number; tone: DueTone } | null {
  if (!isDayKey(day)) return null;
  const days = dayDiff(today, day);
  let tone: DueTone;
  if (complete) tone = days < 0 ? "past" : "done";
  else if (days < 0) tone = "overdue";
  else if (days === 0) tone = "today";
  else if (days <= 3) tone = "soon";
  else if (days <= 7) tone = "week";
  else tone = "later";
  return { days, tone };
}

// ---------------------------------------------------------------------------
// Filter operators per type

const EMPTY_OPS: FilterOperator[] = ["is_empty", "is_not_empty"];

export const FILTER_OPERATORS: Record<PropertyType, FilterOperator[]> = {
  text: ["contains", "not_contains", "is", "is_not", ...EMPTY_OPS],
  url: ["contains", "not_contains", "is", "is_not", ...EMPTY_OPS],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", ...EMPTY_OPS],
  checkbox: ["is"],
  date: [
    "next_days", "overdue", "is", "before", "after", "on_or_before", "on_or_after",
    "past_days", ...EMPTY_OPS,
  ],
  select: ["is", "is_not", ...EMPTY_OPS],
  status: ["is", "is_not", ...EMPTY_OPS],
  multi_select: ["contains", "not_contains", ...EMPTY_OPS],
  relation: ["contains", "not_contains", ...EMPTY_OPS],
};

/** True when the operator compares against `filter.value`. */
export function operatorTakesValue(op: FilterOperator): boolean {
  return op !== "is_empty" && op !== "is_not_empty" && op !== "overdue";
}

/** A sensible starting filter for a property (used when adding a filter). */
export function defaultFilter(prop: DatabaseProperty): ViewFilter {
  const operator = FILTER_OPERATORS[prop.type][0];
  const value: CellValue =
    prop.type === "checkbox" ? true : prop.type === "date" ? 7 : null;
  return { propertyId: prop.id, operator, value };
}

function hasValue(value: CellValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

function toIdList(value: CellValue | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string" && v !== "");
  if (typeof value === "string" && value !== "") return [value];
  return [];
}

function toNumber(value: CellValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase();
}

/** Normalize an operator the type does not use but obviously means something. */
function canonicalOperator(type: PropertyType, op: FilterOperator): FilterOperator {
  if (type === "multi_select" || type === "relation") {
    if (op === "is") return "contains";
    if (op === "is_not") return "not_contains";
  }
  if (type === "number") {
    if (op === "is") return "eq";
    if (op === "is_not") return "neq";
  }
  return op;
}

/**
 * True when the filter would actually narrow rows: its property exists, the
 * operator fits the property type, and it has whatever value it needs.
 * Half-built filters (no value picked yet) are inactive, never "match nothing".
 */
export function isFilterActive(db: Database, filter: ViewFilter): boolean {
  const prop = db.properties.find((p) => p.id === filter.propertyId);
  if (!prop) return false;
  const op = canonicalOperator(prop.type, filter.operator);
  if (!FILTER_OPERATORS[prop.type].includes(op)) return false;
  if (!operatorTakesValue(op)) return true;
  const value = filter.value;
  switch (prop.type) {
    case "checkbox":
      return typeof value === "boolean" || value === "true" || value === "false";
    case "number":
      return toNumber(value) !== null;
    case "date":
      if (op === "next_days" || op === "past_days") {
        const n = toNumber(value);
        return n !== null && n >= 0;
      }
      return resolveDayValue(value, "2000-01-01") !== null;
    case "select":
    case "status":
    case "multi_select":
    case "relation":
      return toIdList(value).length > 0;
    default:
      return typeof value === "string" && value.trim() !== "";
  }
}

export interface ViewContext {
  /** The viewer's local calendar day, YYYY-MM-DD. */
  today: string;
}

/** Does one row satisfy one (active) filter? */
export function matchesFilter(
  db: Database,
  row: DatabaseRow,
  filter: ViewFilter,
  ctx: ViewContext,
  completion: CompletionField | null = completionField(db),
): boolean {
  const prop = db.properties.find((p) => p.id === filter.propertyId);
  if (!prop || !isFilterActive(db, filter)) return true;
  const op = canonicalOperator(prop.type, filter.operator);
  const cell = row.cells[prop.id] ?? null;

  if (op === "is_empty") return prop.type === "checkbox" ? cell !== true : !hasValue(cell);
  if (op === "is_not_empty") return prop.type === "checkbox" ? cell === true : hasValue(cell);

  switch (prop.type) {
    case "text":
    case "url": {
      const hay = fold(typeof cell === "string" ? cell : cell === null ? "" : String(cell));
      const needle = fold(String(filter.value ?? "").trim());
      if (op === "contains") return hay.includes(needle);
      if (op === "not_contains") return !hay.includes(needle);
      if (op === "is") return hay.trim() === needle;
      if (op === "is_not") return hay.trim() !== needle;
      return true;
    }
    case "number": {
      const target = toNumber(filter.value) as number;
      const n = toNumber(cell);
      if (op === "neq") return n === null || n !== target;
      if (n === null) return false;
      if (op === "eq") return n === target;
      if (op === "gt") return n > target;
      if (op === "gte") return n >= target;
      if (op === "lt") return n < target;
      if (op === "lte") return n <= target;
      return true;
    }
    case "checkbox": {
      const want = filter.value === true || filter.value === "true";
      return (cell === true) === want;
    }
    case "date": {
      const day = isDayKey(cell) ? cell : null;
      if (op === "overdue") {
        return day !== null && day < ctx.today && !isRowComplete(db, row, completion);
      }
      if (day === null) return false;
      if (op === "next_days") {
        const n = Math.floor(toNumber(filter.value) as number);
        return day >= ctx.today && day <= addDays(ctx.today, n);
      }
      if (op === "past_days") {
        const n = Math.floor(toNumber(filter.value) as number);
        return day <= ctx.today && day >= addDays(ctx.today, -n);
      }
      const target = resolveDayValue(filter.value, ctx.today) as string;
      if (op === "is") return day === target;
      if (op === "before") return day < target;
      if (op === "after") return day > target;
      if (op === "on_or_before") return day <= target;
      if (op === "on_or_after") return day >= target;
      return true;
    }
    case "select":
    case "status": {
      const ids = toIdList(filter.value);
      const value = typeof cell === "string" ? cell : null;
      const hit = value !== null && ids.includes(value);
      return op === "is" ? hit : !hit;
    }
    case "multi_select":
    case "relation": {
      const ids = toIdList(filter.value);
      const values = Array.isArray(cell) ? cell : [];
      const hit = values.some((v) => ids.includes(v));
      return op === "contains" ? hit : !hit;
    }
  }
}

/** Rows that satisfy the view's filters (all of them, or any when match is "any"). */
export function filterRows(
  db: Database,
  rows: DatabaseRow[],
  filters: ViewFilter[] | undefined,
  match: "all" | "any" | undefined,
  ctx: ViewContext,
): DatabaseRow[] {
  const active = (filters ?? []).filter((f) => isFilterActive(db, f));
  if (active.length === 0) return rows;
  const completion = completionField(db);
  const test = (row: DatabaseRow, f: ViewFilter) => matchesFilter(db, row, f, ctx, completion);
  return match === "any"
    ? rows.filter((row) => active.some((f) => test(row, f)))
    : rows.filter((row) => active.every((f) => test(row, f)));
}

// ---------------------------------------------------------------------------
// Search

/** Resolve a related row id to its display label (for relation search). */
export type RelationLabeler = (property: DatabaseProperty, rowId: string) => string | undefined;

/** Everything a person can see in a row, as one lowercase string. */
export function rowSearchText(db: Database, row: DatabaseRow, relationLabel?: RelationLabeler): string {
  const parts: string[] = [];
  for (const prop of db.properties) {
    const value = row.cells[prop.id];
    if (value === null || value === undefined) continue;
    switch (prop.type) {
      case "select":
      case "status":
      case "multi_select":
        for (const id of toIdList(value)) {
          const label = prop.options?.find((o) => o.id === id)?.label;
          if (label) parts.push(label);
        }
        break;
      case "relation":
        for (const id of toIdList(value)) {
          const label = relationLabel?.(prop, id);
          if (label) parts.push(label);
        }
        break;
      case "checkbox":
        if (value === true) parts.push(prop.name);
        break;
      default:
        parts.push(String(value));
    }
  }
  return fold(parts.join(" \u0001 "));
}

/** Rows containing every word of the query (case- and accent-insensitive). */
export function searchRows(
  db: Database,
  rows: DatabaseRow[],
  query: string,
  relationLabel?: RelationLabeler,
): DatabaseRow[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter((row) => {
    const text = rowSearchText(db, row, relationLabel);
    return terms.every((t) => text.includes(t));
  });
}

// ---------------------------------------------------------------------------
// Sorting

type SortKey = string | number | number[] | null;

function sortKey(prop: DatabaseProperty, value: CellValue | undefined): SortKey {
  if (value === null || value === undefined) return prop.type === "checkbox" ? 0 : null;
  switch (prop.type) {
    case "number":
      return toNumber(value);
    case "checkbox":
      return value === true ? 1 : 0;
    case "date":
      return isDayKey(value) ? value : null;
    case "select":
    case "status": {
      const index = (prop.options ?? []).findIndex((o) => o.id === value);
      return index === -1 ? null : index;
    }
    case "multi_select": {
      const options = prop.options ?? [];
      const indices = toIdList(value)
        .map((id) => options.findIndex((o) => o.id === id))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);
      return indices.length ? indices : null;
    }
    case "relation": {
      const n = toIdList(value).length;
      return n === 0 ? null : n;
    }
    default: {
      const text = String(value).trim();
      return text === "" ? null : text;
    }
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareKeys(a: Exclude<SortKey, null>, b: Exclude<SortKey, null>): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  }
  return collator.compare(String(a), String(b));
}

/**
 * Stable multi-key sort. Empty values always go last whatever the direction
 * (a missing due date is not "earliest"); ties keep the stored order.
 * Select and status sort by option order, checkboxes unchecked first.
 */
export function sortRows(db: Database, rows: DatabaseRow[], sorts: ViewSort[] | undefined): DatabaseRow[] {
  const keys = (sorts ?? [])
    .map((s) => ({ sort: s, prop: db.properties.find((p) => p.id === s.propertyId) }))
    .filter((k): k is { sort: ViewSort; prop: DatabaseProperty } => Boolean(k.prop));
  if (keys.length === 0) return rows;
  const decorated = rows.map((row, index) => ({
    row,
    index,
    keys: keys.map((k) => sortKey(k.prop, row.cells[k.prop.id])),
  }));
  decorated.sort((x, y) => {
    for (let i = 0; i < keys.length; i++) {
      const a = x.keys[i];
      const b = y.keys[i];
      if (a === null && b === null) continue;
      if (a === null) return 1;
      if (b === null) return -1;
      const c = compareKeys(a, b);
      if (c !== 0) return keys[i].sort.direction === "desc" ? -c : c;
    }
    return x.index - y.index;
  });
  return decorated.map((d) => d.row);
}

// ---------------------------------------------------------------------------
// Whole view

/** Filter, search and sort a database's rows exactly as a saved view shows them. */
export function applyView(
  db: Database,
  view: Pick<DatabaseView, "filters" | "filterMatch" | "sorts">,
  ctx: ViewContext & { search?: string; relationLabel?: RelationLabeler },
): DatabaseRow[] {
  let rows = filterRows(db, db.rows, view.filters, view.filterMatch, ctx);
  if (ctx.search) rows = searchRows(db, rows, ctx.search, ctx.relationLabel);
  return sortRows(db, rows, view.sorts);
}

/**
 * The filters and sort for a "This week" view: due within the next `days`
 * days (today included) and not complete, soonest first. Null when the
 * database has no date property.
 */
export function upcomingViewSettings(
  db: Database,
  datePropertyId?: string,
  days = 7,
): Pick<DatabaseView, "filters" | "filterMatch" | "sorts" | "datePropertyId"> | null {
  const dateProp =
    db.properties.find((p) => p.id === datePropertyId && p.type === "date") ??
    db.properties.find((p) => p.type === "date");
  if (!dateProp) return null;
  return {
    datePropertyId: dateProp.id,
    filters: [
      { propertyId: dateProp.id, operator: "next_days", value: days },
      ...notCompleteFilters(db),
    ],
    filterMatch: "all",
    sorts: [{ propertyId: dateProp.id, direction: "asc" }],
  };
}

/**
 * Starting cells for a row created inside a filtered view, so it satisfies
 * the simple "is" conditions and does not vanish the moment it is added
 * (adding to a "Course is CS 101" view gives the row Course = CS 101).
 */
export function newRowCells(
  db: Database,
  view: Pick<DatabaseView, "filters" | "filterMatch">,
  today: string,
): Record<string, CellValue> {
  const cells: Record<string, CellValue> = {};
  // With "match any", satisfying one condition is enough and none is implied.
  const filters = view.filterMatch === "any" ? [] : (view.filters ?? []);
  for (const filter of filters) {
    if (!isFilterActive(db, filter)) continue;
    const prop = db.properties.find((p) => p.id === filter.propertyId)!;
    const op = canonicalOperator(prop.type, filter.operator);
    switch (prop.type) {
      case "text":
      case "url":
        if (op === "is" || op === "contains") cells[prop.id] = String(filter.value).trim();
        break;
      case "number":
        if (op === "eq") cells[prop.id] = toNumber(filter.value);
        break;
      case "checkbox":
        cells[prop.id] = filter.value === true || filter.value === "true";
        break;
      case "date":
        if (op === "is" || op === "on_or_after" || op === "on_or_before") {
          cells[prop.id] = resolveDayValue(filter.value, today);
        } else if (op === "next_days") {
          cells[prop.id] = today;
        }
        break;
      case "select":
      case "status":
        if (op === "is") cells[prop.id] = toIdList(filter.value)[0];
        break;
      case "multi_select":
      case "relation":
        if (op === "contains") cells[prop.id] = toIdList(filter.value).slice(0, 1);
        break;
    }
  }
  // A new row starts in the first open status ("Not started"), not in a
  // "No Status" limbo, unless a filter already chose one.
  for (const prop of db.properties) {
    if (prop.type !== "status" || prop.id in cells) continue;
    const open = (prop.options ?? []).find((o) => !isCompleteOption(prop, o));
    if (open) cells[prop.id] = open.id;
  }
  return cells;
}

/** Words in a number column's name that make a column total meaningless. */
const AVERAGE_ONLY = /%|percent|prozent|pourcent|porcentaje|percentuale|procent|target|goal|ziel|objectif|objetivo|obiettivo|doel|score|grade|note|rating|gpa|average|avg|mark|rate|progress|level|目标|目標|得点|分数|成绩|成績|نسبة|درجة|هدف/i;
/** Weights do add up (to 100 %), so they keep their sum. */
const SUMMABLE = /weight|gewicht|poids|peso|gewogen|weging|权重|重み|配点|وزن/i;

/**
 * Whether a column total means something. Credits, minutes or points add
 * up; targets, scores, grades and percentages only have an average.
 */
export function numberColumnSums(prop: Pick<DatabaseProperty, "name">): boolean {
  const name = prop.name.toLowerCase();
  if (SUMMABLE.test(name)) return true;
  return !AVERAGE_ONLY.test(name);
}

// ---------------------------------------------------------------------------
// Summaries

/** Count, sum and average of the numeric values in a column. */
export function summarizeNumbers(
  rows: DatabaseRow[],
  propertyId: string,
): { count: number; sum: number; average: number | null } {
  let count = 0;
  let sum = 0;
  for (const row of rows) {
    const n = toNumber(row.cells[propertyId]);
    if (n === null) continue;
    count++;
    sum += n;
  }
  return { count, sum, average: count ? sum / count : null };
}

// ---------------------------------------------------------------------------
// Links

/** The URL to open for a cell value, or null unless it is http(s). */
export function safeHttpUrl(value: CellValue | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  // Bare domains ("example.com/x") are common in notes; treat them as https.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : /^[^\s/]+\.[^\s/]+/.test(raw) ? `https://${raw}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
