/**
 * Notion's database CSVs (and Markdown tables) → StudyOS databases.
 *
 * Column types are inferred conservatively: a column gets a type only when
 * EVERY non-empty value fits it, and anything in doubt stays text (a student
 * can change a column's type later; a wrong guess would garble their data).
 *   title         the first column, always text (Notion's "Name")
 *   checkbox      every value "Yes"/"No" (how Notion writes checkboxes)
 *   number        plain numbers ("12", "-3.5", "1,234", "$12.50", "40%");
 *                 a leading zero ("007", an id or a postcode) keeps it text
 *   date          Notion's date formats: "March 3, 2024", "Mar 3, 2024 3:00 PM",
 *                 "3 March 2024", "2024/03/03", "03/03/2024" (day or month
 *                 first, decided for the whole column), ISO dates, ranges
 *                 "A → B" (the start is kept), "(GMT+1)" suffixes; the day only
 *   url           every value an http(s) link
 *   multi_select  comma lists ("Math, Physics") whose items recur across rows
 *   select        a small set of values that recur ("Done", "To do", "Done"),
 *                 or status-like columns ("Status", "Priority") with few values;
 *                 "Status" becomes a status column
 *   text          everything else
 * Relation cells ("Lecture 3 (../Lectures%20…/Lecture%203%20….md)") keep the
 * linked titles as text.
 */
import { stableId } from "@/lib/workspace/stable-id";
import type { CellValue, Database, DatabaseProperty, DatabaseRow, PropertyType, SelectOption } from "@/lib/workspace/types";
import { splitDelimited } from "@/lib/study/transfer";

export interface Table {
  header: string[];
  rows: string[][];
}

/** A CSV as Notion writes it (UTF-8, BOM, RFC 4180 quoting). */
export function parseCsv(text: string): Table {
  const rows = splitDelimited(text.replace(/^\uFEFF/, ""), ",").map((r) => r.fields);
  while (rows.length > 0 && rows[rows.length - 1].every((f) => f.trim() === "")) rows.pop();
  const header = rows.shift() ?? [];
  return { header, rows: rows.filter((r) => r.some((f) => f.trim() !== "")) };
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const TIME = String.raw`(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp]\.?[Mm]\.?)?)?(?:\s*\((?:GMT|UTC)[^)]{0,10}\))?`;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const MONTH_FIRST = new RegExp(String.raw`^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})${TIME}$`);
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})\.?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})${TIME}$`);
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})${TIME}$`);
const YEAR_LAST = new RegExp(String.raw`^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})${TIME}$`);
const CJK_DATE = /^(\d{4})年(\d{1,2})月(\d{1,2})日/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" for a real calendar day, else null. */
function dayKey(y: number, m: number, d: number): string | null {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** The start of a date range ("A → B"), without Notion's mention "@". */
function dateStart(raw: string): string {
  const s = raw.trim().replace(/^@/, "");
  const arrow = s.indexOf("→");
  return (arrow === -1 ? s : s.slice(0, arrow)).trim();
}

type NumericDate = { a: number; b: number; y: number };

/** A date in an unambiguous format, or the parts of a "dd/mm/yyyy"-or-"mm/dd/yyyy" one. */
function readDate(raw: string): string | NumericDate | null {
  const s = dateStart(raw);
  if (s.length > 60) return null;
  let m = ISO_DATE.exec(s);
  if (m) return dayKey(+m[1], +m[2], +m[3]);
  m = MONTH_FIRST.exec(s);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? dayKey(+m[3], month, +m[2]) : null;
  }
  m = DAY_FIRST.exec(s);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? dayKey(+m[3], month, +m[1]) : null;
  }
  m = YEAR_FIRST.exec(s);
  if (m) return dayKey(+m[1], +m[2], +m[3]);
  m = YEAR_LAST.exec(s);
  if (m) return { a: +m[1], b: +m[2], y: +m[3] };
  m = CJK_DATE.exec(s);
  if (m) return dayKey(+m[1], +m[2], +m[3]);
  return null;
}

/**
 * Every value of a column as "YYYY-MM-DD", or null when any is not a date.
 * Numeric "a/b/yyyy" dates are read the same way for the whole column: day
 * first when some first part is over 12, month first when some second part
 * is, and `dayFirst` when nothing tells.
 */
export function readDateColumn(values: string[], dayFirst = false): string[] | null {
  const parsed = values.map(readDate);
  if (parsed.some((p) => p === null)) return null;
  const numeric = parsed.filter((p): p is NumericDate => typeof p === "object" && p !== null);
  let first = dayFirst;
  if (numeric.length > 0) {
    const aOver = numeric.some((n) => n.a > 12);
    const bOver = numeric.some((n) => n.b > 12);
    if (aOver && bOver) return null;
    if (aOver) first = true;
    else if (bOver) first = false;
  }
  const out: string[] = [];
  for (const p of parsed) {
    if (typeof p === "string") {
      out.push(p);
      continue;
    }
    const n = p as NumericDate;
    const key = first ? dayKey(n.y, n.b, n.a) : dayKey(n.y, n.a, n.b);
    if (!key) return null;
    out.push(key);
  }
  return out;
}

/** Notion's date for one value ("" when it is not a date). */
export function parseNotionDate(raw: string, dayFirst = false): string | null {
  return readDateColumn([raw], dayFirst)?.[0] ?? null;
}

const NUMBER = /^[-+]?[$€£¥]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?%?$/;

/** A plain number, or null (a leading zero keeps "007" or "01234" text). */
export function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (!NUMBER.test(s)) return null;
  const digits = s.replace(/[$€£¥%,\s+]/g, "");
  if (/^-?0\d/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

const URL_VALUE = /^https?:\/\/[^\s]+$/i;

/** Relation and file cells link to exported files: keep the titles. */
function cleanCell(value: string): string {
  if (!value.includes(".md)") && !value.includes("%20")) return value.trim();
  return value.replace(/\s*\((?:[^()\n]|\([^()\n]*\))*?\.(?:md|csv)\)/g, "").trim();
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const STATUS_NAMES = /^(status|state|stage|priority)$/i;
const MAX_SELECT_OPTIONS = 25;
const MAX_OPTION_CHARS = 60;
const PALETTE = ["blue", "green", "amber", "violet", "rose", "cyan", "orange", "pink", "indigo", "teal", "red", "purple"];

function statusColor(label: string): string | undefined {
  const l = label.toLowerCase();
  if (/\b(done|complete|completed|finished|submitted|passed)\b/.test(l)) return "green";
  if (/\b(progress|doing|started|working|review)\b/.test(l) && !/not started/.test(l)) return "amber";
  if (/\b(not started|to ?do|todo|backlog|planned|open)\b/.test(l)) return "zinc";
  return undefined;
}

interface Inferred {
  type: PropertyType;
  /** Labels of the options, in order of first appearance (select types). */
  options?: string[];
  /** For date columns: the parsed day of each value, in order of `values`. */
  dates?: string[];
}

function splitList(value: string): string[] {
  return value
    .split(/,\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The type of a column from its values (see the header). `isTitle` keeps the first column text. */
export function inferColumn(name: string, rawValues: string[], options: { isTitle?: boolean; dayFirst?: boolean } = {}): Inferred {
  if (options.isTitle) return { type: "text" };
  const values = rawValues.map((v) => v.trim()).filter((v) => v !== "");
  if (values.length === 0) return { type: "text" };

  if (values.every((v) => /^(yes|no)$/i.test(v))) return { type: "checkbox" };
  if (values.every((v) => parseNumber(v) !== null)) return { type: "number" };
  const dates = readDateColumn(values, options.dayFirst);
  if (dates) return { type: "date", dates };
  if (values.every((v) => URL_VALUE.test(v))) return { type: "url" };

  const short = values.every((v) => v.length <= MAX_OPTION_CHARS * 4 && !v.includes("\n"));
  if (short && values.some((v) => /,\s/.test(v))) {
    const tokens = values.flatMap(splitList);
    const distinct = [...new Set(tokens)];
    const fits =
      tokens.length > 0 &&
      distinct.length <= MAX_SELECT_OPTIONS * 2 &&
      distinct.length < tokens.length &&
      tokens.every((t) => t.length <= MAX_OPTION_CHARS && t.split(/\s+/).length <= 5 && !/[.!?]$/.test(t));
    if (fits) return { type: "multi_select", options: distinct };
  }

  const distinct = [...new Set(values)];
  const smallValues = values.every((v) => v.length <= MAX_OPTION_CHARS && !v.includes("\n"));
  const statusLike = STATUS_NAMES.test(name.trim());
  const recurs = values.length >= 2 && distinct.length <= Math.ceil(values.length / 2);
  if (smallValues && distinct.length <= MAX_SELECT_OPTIONS && (recurs || statusLike)) {
    return { type: /^status$/i.test(name.trim()) ? "status" : "select", options: distinct };
  }
  return { type: "text" };
}

export interface BuiltDatabase {
  database: Database;
  /** Each kept row's title, in row order (for matching Notion's row pages). */
  rowTitles: string[];
  /** Rows left out past the row cap. */
  skippedRows: number;
  /** Columns left out past the column cap. */
  skippedColumns: number;
  /** Cells cut at the cell limit. */
  truncatedCells: number;
}

export interface BuildDatabaseOptions {
  maxRows: number;
  maxColumns: number;
  maxCellChars: number;
  dayFirst?: boolean;
  /** Name for a column without one ("Column {n}"). */
  columnName: (n: number) => string;
  /** Names of the table, board and calendar views, in the student's language. */
  viewNames: { table: string; board: string; calendar: string };
  icon?: string;
}

/** A StudyOS database from a table of text (a Notion CSV or a Markdown table). */
export function buildDatabase(id: string, name: string, table: Table, options: BuildDatabaseOptions): BuiltDatabase {
  const width = Math.max(table.header.length, 1);
  const columns = Math.min(width, options.maxColumns);
  const kept = table.rows.slice(0, options.maxRows);
  let truncatedCells = 0;
  const cell = (row: string[], c: number): string => {
    const value = cleanCell(row[c] ?? "");
    if (value.length <= options.maxCellChars) return value;
    truncatedCells += 1;
    return value.slice(0, options.maxCellChars);
  };
  const grid = kept.map((row) => Array.from({ length: columns }, (_, c) => cell(row, c)));

  const usedNames = new Set<string>();
  const properties: DatabaseProperty[] = [];
  const writers: ((value: string, rowIndex: number) => CellValue | undefined)[] = [];
  for (let c = 0; c < columns; c += 1) {
    let propName = (table.header[c] ?? "").replace(/^\uFEFF/, "").trim() || options.columnName(c + 1);
    for (let n = 2; usedNames.has(propName.toLowerCase()); n += 1) propName = `${(table.header[c] ?? "").trim() || options.columnName(c + 1)} ${n}`;
    usedNames.add(propName.toLowerCase());
    const propId = stableId(id, "property", String(c));
    const values = grid.map((r) => r[c]);
    const inferred = inferColumn(propName, values, { isTitle: c === 0, dayFirst: options.dayFirst });
    const property: DatabaseProperty = { id: propId, name: propName, type: inferred.type };

    if (inferred.options) {
      const opts: SelectOption[] = inferred.options.map((label, n) => ({
        id: stableId(propId, "option", label),
        label,
        color: (inferred.type === "status" ? statusColor(label) : undefined) ?? PALETTE[n % PALETTE.length],
      }));
      property.options = opts;
      const byLabel = new Map(opts.map((o) => [o.label, o.id]));
      writers.push(
        inferred.type === "multi_select"
          ? (v) => {
              const ids = splitList(v).map((t) => byLabel.get(t)).filter((x): x is string => Boolean(x));
              return ids.length ? [...new Set(ids)] : undefined;
            }
          : (v) => (v ? byLabel.get(v) : undefined),
      );
    } else if (inferred.type === "checkbox") {
      writers.push((v) => /^yes$/i.test(v));
    } else if (inferred.type === "number") {
      writers.push((v) => (v ? (parseNumber(v) ?? undefined) : undefined));
    } else if (inferred.type === "date") {
      // The column was parsed as a whole (day/month order); map back by row.
      const days = inferred.dates ?? [];
      const nonEmpty: number[] = [];
      values.forEach((v, r) => {
        if (v.trim()) nonEmpty.push(r);
      });
      const byRow = new Map(nonEmpty.map((r, k) => [r, days[k]]));
      writers.push((v, r) => (v ? byRow.get(r) : undefined));
    } else {
      writers.push((v) => (v ? v : undefined));
    }
    properties.push(property);
  }

  const rows: DatabaseRow[] = grid.map((values, r) => {
    const cells: Record<string, CellValue> = {};
    values.forEach((v, c) => {
      const value = writers[c](v, r);
      if (value !== undefined && value !== "") cells[properties[c].id] = value;
    });
    return { id: stableId(id, "row", String(r)), cells };
  });

  const names = options.viewNames;
  const views: Database["views"] = [{ id: stableId(id, "view", "table"), name: names.table, type: "table" }];
  const group = properties.find((p) => p.type === "status" || p.type === "select");
  if (group) views.push({ id: stableId(id, "view", "board"), name: names.board, type: "board", groupByPropertyId: group.id });
  const date = properties.find((p) => p.type === "date");
  if (date) views.push({ id: stableId(id, "view", "calendar"), name: names.calendar, type: "calendar", datePropertyId: date.id });

  return {
    database: {
      id,
      name,
      ...(options.icon ? { icon: options.icon } : {}),
      properties,
      rows,
      views,
    },
    rowTitles: grid.map((r) => r[0] ?? ""),
    skippedRows: Math.max(0, table.rows.length - kept.length),
    skippedColumns: Math.max(0, width - columns),
    truncatedCells,
  };
}
