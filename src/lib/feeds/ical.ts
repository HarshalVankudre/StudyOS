/**
 * A focused, bounded iCalendar (RFC 5545) reader for importing deadlines.
 *
 * This is the INCOMING direction (a student's learning-platform feed or an
 * uploaded .ics file). The product's own OUTGOING feed is written by
 * src/lib/calendar/ics.ts; the two never share code paths.
 *
 * Why a focused reader instead of a library: deadline import needs a small
 * subset of iCalendar (VEVENT / VTODO with summary, start or due, UID, URL,
 * categories, one recurrence rule, exceptions and overrides), but it must
 * treat every byte as hostile. Owning the loop lets every stage be bounded
 * (characters, lines, line length, components, recurrence iterations and
 * occurrences), keeps it dependency-free so the same code parses an uploaded
 * file in the browser and a fetched feed on the server, and resolves time
 * zones with the runtime's own, always-current Intl zone data rather than a
 * bundled zone database (the widely used libraries either bundle one, pull in
 * moment-timezone, or ignore IANA TZIDs that come without a VTIMEZONE block).
 *
 * Handled: CRLF / LF / CR line endings, line folding (space or tab), a UTF-8
 * BOM, quoted parameter values, text escapes (\n \, \; \\), DATE values
 * (all-day), UTC times, TZID times (IANA, Windows and decorated names, with
 * the file's VTIMEZONE as a fallback), floating times (in the calendar's
 * X-WR-TIMEZONE when it names one), RRULE (DAILY / WEEKLY with BYDAY /
 * MONTHLY / YEARLY with INTERVAL, COUNT, UNTIL), EXDATE, RECURRENCE-ID
 * overrides and cancelled events. Anything else degrades instead of failing:
 * an unsupported recurrence rule yields just its first occurrence, an
 * unreadable date drops only that event.
 */
import { parseOffset, resolveZone, wallTimeToUtc, type WallTime, type ZoneRef } from "./timezones";

export const ICS_LIMITS = {
  /** Characters read; the fetcher caps bytes well below this. */
  maxChars: 5_000_000,
  maxLines: 250_000,
  /** One unfolded content line; longer values are cut (descriptions mostly). */
  maxLineChars: 16_000,
  /** VEVENT + VTODO components read. */
  maxComponents: 6_000,
  /** Occurrences produced per repeating event. */
  maxOccurrencesPerSeries: 60,
  /** Rule steps tried per repeating event (stops runaway rules). */
  maxIterations: 4_000,
  /** Rule steps tried across the whole calendar. */
  maxTotalIterations: 40_000,
  /** Events returned after expansion. */
  maxEvents: 2_500,
  maxTextChars: 500,
  maxDescriptionChars: 4_000,
  /**
   * Distinct TZID names resolved per calendar. Real calendars use a handful;
   * a TZID beyond this is treated as unknown without being looked up, so a
   * file of hundreds of junk zone names cannot cost a zone lookup per date.
   */
  maxZonesPerCalendar: 100,
  /** EXDATE values read per event and per calendar (real feeds: a few each). */
  maxExdatesPerComponent: 1_000,
  maxExdatesPerCalendar: 20_000,
  /**
   * Wall-clock budget for reading one calendar (parse and expansion). Reading
   * runs synchronously on the server's event loop, so this is the backstop
   * for any shape the counts above miss; past it the calendar is refused as
   * too large (a partial read would make a sync flag the missing events).
   */
  timeBudgetMs: 2_500,
} as const;

/** Thrown inside the reader when the time budget runs out. */
export class IcsBudgetError extends Error {
  constructor() {
    super("calendar took too long to read");
    this.name = "IcsBudgetError";
  }
}

/** A deadline check that reads the clock only every `every` calls. */
export function budgetClock(deadline: number, every = 256): () => void {
  let n = 0;
  return () => {
    n += 1;
    if (n % every === 0 && Date.now() > deadline) throw new IcsBudgetError();
  };
}

export interface ContentLine {
  name: string;
  params: Record<string, string[]>;
  value: string;
}

export type ICalTime =
  | { kind: "date"; wall: WallTime }
  | { kind: "utc"; wall: WallTime }
  | { kind: "zoned"; wall: WallTime; ref: ZoneRef }
  | { kind: "floating"; wall: WallTime };

export type IcsWarning =
  | "truncated"
  | "unknown_zone"
  | "unsupported_recurrence"
  | "bad_dates"
  | "too_many_events";

export interface ParsedComponent {
  type: "VEVENT" | "VTODO";
  uid: string;
  summary: string;
  description: string;
  url: string;
  location: string;
  categories: string[];
  start: ICalTime;
  status: string;
  completed: boolean;
  recurrenceId?: ICalTime;
  rrule?: string;
  exdates: ICalTime[];
  /**
   * Calendar days the event covers, from DTEND or DURATION (all-day: DTEND
   * is exclusive; timed: rounded up). Set only when more than one, so a
   * "Reading week" can be told apart from a single deadline.
   */
  spanDays?: number;
}

export interface ParsedCalendar {
  prodId: string;
  name: string;
  components: ParsedComponent[];
  warnings: Set<IcsWarning>;
}

// ---------------------------------------------------------------------------
// Lines

/** Unfold content lines (RFC 5545 §3.1), bounded in count and length. */
export function unfoldLines(text: string, warnings?: Set<IcsWarning>): string[] {
  let source = text;
  if (source.length > ICS_LIMITS.maxChars) {
    source = source.slice(0, ICS_LIMITS.maxChars);
    warnings?.add("truncated");
  }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const raw = source.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      const last = lines.length - 1;
      if (lines[last].length < ICS_LIMITS.maxLineChars) {
        lines[last] = (lines[last] + line.slice(1)).slice(0, ICS_LIMITS.maxLineChars);
      }
      continue;
    }
    if (lines.length >= ICS_LIMITS.maxLines) {
      warnings?.add("truncated");
      break;
    }
    lines.push(line.length > ICS_LIMITS.maxLineChars ? line.slice(0, ICS_LIMITS.maxLineChars) : line);
  }
  return lines;
}

/** Parse "NAME;PARAM=a,"b;c":value". Returns null for a malformed line. */
export function parseContentLine(line: string): ContentLine | null {
  const len = line.length;
  let i = 0;
  while (i < len && line[i] !== ";" && line[i] !== ":") i += 1;
  const name = line.slice(0, i).trim().toUpperCase();
  if (!name || !/^[A-Z0-9-]+$/.test(name)) return null;
  const params: Record<string, string[]> = {};
  let guard = 0;
  while (line[i] === ";" && guard < 50) {
    guard += 1;
    i += 1;
    const start = i;
    while (i < len && line[i] !== "=" && line[i] !== ";" && line[i] !== ":") i += 1;
    const key = line.slice(start, i).trim().toUpperCase();
    const values: string[] = [];
    if (line[i] === "=") {
      i += 1;
      for (let n = 0; n < 50; n += 1) {
        if (line[i] === '"') {
          const s = i + 1;
          const end = line.indexOf('"', s);
          if (end === -1) return null;
          values.push(line.slice(s, end));
          i = end + 1;
        } else {
          const s = i;
          while (i < len && line[i] !== "," && line[i] !== ";" && line[i] !== ":") i += 1;
          values.push(line.slice(s, i));
        }
        if (line[i] === ",") {
          i += 1;
          continue;
        }
        break;
      }
    }
    if (key) params[key] = values;
  }
  if (line[i] !== ":") return null;
  return { name, params, value: line.slice(i + 1) };
}

/** Undo TEXT escaping: \n \N → newline, \, \; \\ → the character. */
export function unescapeText(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Split a list value on commas that are not escaped. */
export function splitList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) {
      current += c + value[i + 1];
      i += 1;
    } else if (c === ",") {
      out.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  out.push(current);
  return out;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return clean.length > max ? clean.slice(0, max) : clean;
}

// ---------------------------------------------------------------------------
// Dates and times

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "YYYY-MM-DD" of a wall time. */
export function wallDay(wall: WallTime): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

export interface TimeContext {
  /** Resolve a TZID (memoized per calendar). */
  zone: (tzid: string) => ZoneRef | null;
  /** The calendar's X-WR-TIMEZONE, applied to floating times. */
  calendarZone: ZoneRef | null;
  warnings: Set<IcsWarning>;
}

/** Parse a DATE or DATE-TIME value; null when it is not a real date. */
export function parseTimeValue(
  value: string,
  params: Record<string, string[]>,
  ctx: TimeContext,
): ICalTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  const isDate = !m[4] || params.VALUE?.[0]?.toUpperCase() === "DATE";
  if (isDate) return { kind: "date", wall: { year, month, day, hour: 0, minute: 0, second: 0 } };
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Math.min(59, Number(m[6] ?? 0));
  if (hour > 23 || minute > 59) return null;
  const wall: WallTime = { year, month, day, hour, minute, second };
  if (m[7]) return { kind: "utc", wall };
  const tzid = params.TZID?.[0];
  if (tzid) {
    const ref = ctx.zone(tzid);
    if (ref) return { kind: "zoned", wall, ref };
    ctx.warnings.add("unknown_zone");
  }
  if (ctx.calendarZone) return { kind: "zoned", wall, ref: ctx.calendarZone };
  return { kind: "floating", wall };
}

function wallToUtcMs(wall: WallTime): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/**
 * A comparable instant: the real UTC instant for utc/zoned times, and the
 * wall time read as UTC for all-day and floating times (exact enough for
 * windows and ordering; the student's day is computed separately).
 */
export function instantOf(time: ICalTime): number {
  if (time.kind === "zoned") return wallTimeToUtc(time.wall, time.ref);
  return wallToUtcMs(time.wall);
}

const SPAN_DAY_MS = 86_400_000;

/** A DURATION value ("P5D", "P1W", "PT2H30M", "P1DT12H") in milliseconds, or null. */
export function parseDurationMs(value: string): number | null {
  const m = /^\s*([+-])?P(?:(\d{1,4})W)?(?:(\d{1,5})D)?(?:T(?:(\d{1,6})H)?(?:(\d{1,7})M)?(?:(\d{1,9})S)?)?\s*$/i.exec(value);
  if (!m || m[1] === "-") return null;
  const [w, d, h, min, sec] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0));
  return (((w * 7 + d) * 24 + h) * 60 + min) * 60_000 + sec * 1000;
}

/**
 * How many calendar days an event covers (at least 1). All-day events count
 * their dates (DTEND is exclusive); timed events count started days of
 * length, so a 2-hour exam is 1 and a 3-day field trip is 3.
 */
export function eventSpanDays(start: ICalTime, end: ICalTime | null, duration: string | undefined): number {
  let ms: number | null = null;
  if (end) {
    if (start.kind === "date" && end.kind === "date") {
      const a = Date.UTC(start.wall.year, start.wall.month - 1, start.wall.day);
      const b = Date.UTC(end.wall.year, end.wall.month - 1, end.wall.day);
      return Math.max(1, Math.min(4000, Math.round((b - a) / SPAN_DAY_MS)));
    }
    ms = instantOf(end) - instantOf(start);
  } else if (duration) {
    ms = parseDurationMs(duration);
  }
  if (ms === null || !Number.isFinite(ms) || ms <= SPAN_DAY_MS) return 1;
  return Math.min(4000, Math.ceil(ms / SPAN_DAY_MS));
}

function compactUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Stable text form of a time, used in occurrence keys (RECURRENCE-ID style). */
export function compactTime(time: ICalTime): string {
  const w = time.wall;
  const day = `${pad(w.year, 4)}${pad(w.month)}${pad(w.day)}`;
  if (time.kind === "date") return day;
  if (time.kind === "floating") return `${day}T${pad(w.hour)}${pad(w.minute)}${pad(w.second)}`;
  return compactUtc(instantOf(time));
}

// ---------------------------------------------------------------------------
// Components

interface VTimezoneInfo {
  location?: string;
  standardOffset?: number;
}

/**
 * Parse the calendar's text into components. Null when it is not iCalendar.
 * Throws IcsBudgetError once `options.deadline` (epoch ms) has passed.
 */
export function parseIcs(text: string, options: { deadline?: number } = {}): ParsedCalendar | null {
  const tick = budgetClock(options.deadline ?? Date.now() + ICS_LIMITS.timeBudgetMs);
  const warnings = new Set<IcsWarning>();
  const lines = unfoldLines(text, warnings);
  const firstReal = lines.find((l) => l.trim() !== "");
  if (!firstReal || firstReal.trim().toUpperCase() !== "BEGIN:VCALENDAR") return null;

  const timezones = new Map<string, VTimezoneInfo>();
  const calendarProps: Record<string, string> = {};
  const rawComponents: { type: "VEVENT" | "VTODO"; props: Map<string, ContentLine[]> }[] = [];

  const stack: string[] = [];
  let current: { type: "VEVENT" | "VTODO"; props: Map<string, ContentLine[]> } | null = null;
  let tz: { id: string; info: VTimezoneInfo } | null = null;
  let componentsSeen = 0;

  for (const line of lines) {
    tick();
    if (!line.trim()) continue;
    const cl = parseContentLine(line);
    if (!cl) continue;
    if (cl.name === "BEGIN") {
      const kind = cl.value.trim().toUpperCase();
      if (stack.length > 20) break;
      stack.push(kind);
      if ((kind === "VEVENT" || kind === "VTODO") && stack.length === 2 && stack[0] === "VCALENDAR") {
        componentsSeen += 1;
        if (componentsSeen > ICS_LIMITS.maxComponents) {
          warnings.add("too_many_events");
          current = null;
        } else {
          current = { type: kind, props: new Map() };
        }
      } else if (kind === "VTIMEZONE" && stack.length === 2) {
        tz = { id: "", info: {} };
      }
      continue;
    }
    if (cl.name === "END") {
      const kind = cl.value.trim().toUpperCase();
      const at = stack.lastIndexOf(kind);
      if (at === -1) continue;
      stack.length = at;
      if ((kind === "VEVENT" || kind === "VTODO") && current) {
        rawComponents.push(current);
        current = null;
      } else if (kind === "VTIMEZONE" && tz) {
        if (tz.id && timezones.size < 100) timezones.set(tz.id, tz.info);
        tz = null;
      }
      if (kind === "VCALENDAR") break;
      continue;
    }
    const top = stack[stack.length - 1];
    if (stack.length === 1 && top === "VCALENDAR") {
      if (!(cl.name in calendarProps)) calendarProps[cl.name] = cl.value;
    } else if (current && stack.length === 2) {
      const list = current.props.get(cl.name) ?? [];
      if (list.length < (cl.name === "EXDATE" ? 400 : 20)) list.push(cl);
      current.props.set(cl.name, list);
    } else if (tz) {
      if (stack.length === 2 && cl.name === "TZID") tz.id = cl.value.trim();
      if (stack.length === 2 && cl.name === "X-LIC-LOCATION") tz.info.location = cl.value.trim();
      if (stack.length === 3 && top === "STANDARD" && cl.name === "TZOFFSETTO") {
        const off = parseOffset(cl.value);
        if (off !== null && tz.info.standardOffset === undefined) tz.info.standardOffset = off;
      }
    }
  }

  // Every TZID is resolved at most once per calendar, and only the first
  // `maxZonesPerCalendar` distinct names are resolved at all: later new names
  // count as unknown zones (no lookup), so no date ever pays for a resolution
  // beyond those.
  const zoneCache = new Map<string, ZoneRef | null>();
  const zone = (tzid: string): ZoneRef | null => {
    const cached = zoneCache.get(tzid);
    if (cached !== undefined) return cached;
    if (zoneCache.size >= ICS_LIMITS.maxZonesPerCalendar) return null;
    const ref = resolveZone(tzid, timezones.get(tzid));
    zoneCache.set(tzid, ref);
    return ref;
  };
  const calTz = calendarProps["X-WR-TIMEZONE"]?.trim();
  const ctx: TimeContext = { zone, calendarZone: calTz ? zone(calTz) : null, warnings };

  const components: ParsedComponent[] = [];
  let exdatesLeft: number = ICS_LIMITS.maxExdatesPerCalendar;
  for (const raw of rawComponents) {
    tick();
    const one = (name: string) => raw.props.get(name)?.[0];
    const text = (name: string, max: number = ICS_LIMITS.maxTextChars) => {
      const cl = one(name);
      return cl ? clip(unescapeText(cl.value), max).trim() : "";
    };
    const time = (cl: ContentLine | undefined) => (cl ? parseTimeValue(cl.value, cl.params, ctx) : null);

    const startLine = raw.type === "VTODO" ? (one("DUE") ?? one("DTSTART")) : one("DTSTART");
    const start = time(startLine);
    if (!start) {
      warnings.add("bad_dates");
      continue;
    }
    const exdates: ICalTime[] = [];
    let ownLeft: number = ICS_LIMITS.maxExdatesPerComponent;
    exdateLines: for (const cl of raw.props.get("EXDATE") ?? []) {
      if (ownLeft <= 0 || exdatesLeft <= 0) {
        warnings.add("truncated");
        break;
      }
      for (const value of splitList(cl.value)) {
        if (ownLeft <= 0 || exdatesLeft <= 0) {
          warnings.add("truncated");
          break exdateLines;
        }
        ownLeft -= 1;
        exdatesLeft -= 1;
        tick();
        const t = parseTimeValue(value, cl.params, ctx);
        if (t) exdates.push(t);
      }
    }
    const categories: string[] = [];
    for (const cl of raw.props.get("CATEGORIES") ?? []) {
      for (const value of splitList(cl.value)) {
        const c = clip(unescapeText(value), 200).trim();
        if (c && categories.length < 10) categories.push(c);
      }
    }
    const status = text("STATUS", 40).toUpperCase();
    const rrule = one("RRULE")?.value.trim();
    const recurrenceId = time(one("RECURRENCE-ID"));
    const spanDays = raw.type === "VEVENT" ? eventSpanDays(start, time(one("DTEND")), one("DURATION")?.value) : 1;
    components.push({
      type: raw.type,
      uid: clip(one("UID")?.value.trim() ?? "", 400),
      summary: text("SUMMARY"),
      description: text("DESCRIPTION", ICS_LIMITS.maxDescriptionChars),
      url: clip(one("URL")?.value.trim() ?? "", 2_000),
      location: text("LOCATION", 300),
      categories,
      start,
      status,
      completed: status === "COMPLETED" || Boolean(one("COMPLETED")),
      ...(recurrenceId ? { recurrenceId } : {}),
      ...(rrule ? { rrule } : {}),
      exdates,
      ...(spanDays > 1 ? { spanDays } : {}),
    });
  }

  return {
    prodId: clip(calendarProps.PRODID ?? "", 300),
    name: clip(unescapeText(calendarProps["X-WR-CALNAME"] ?? ""), 200).trim(),
    components,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Recurrence

type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurrenceRule {
  freq: Freq;
  interval: number;
  count?: number;
  until?: ICalTime;
  /** Weekdays for WEEKLY, 0 = Sunday … 6 = Saturday. */
  byDay?: number[];
  /** Day of the month for MONTHLY. */
  byMonthDay?: number;
}

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const SUPPORTED_PARTS = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"]);

/**
 * Parse an RRULE into the supported subset; "unsupported" for valid rules
 * this reader does not expand (BYSETPOS, ordinal weekdays, hourly…).
 */
export function parseRule(
  text: string,
  start: ICalTime,
  ctx: TimeContext,
): RecurrenceRule | "unsupported" {
  const parts = new Map<string, string>();
  for (const piece of text.split(";")) {
    const [k, v] = piece.split("=");
    if (k && v !== undefined) parts.set(k.trim().toUpperCase(), v.trim().toUpperCase());
  }
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return "unsupported";
  for (const key of parts.keys()) if (!SUPPORTED_PARTS.has(key)) return "unsupported";

  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return "unsupported";
  const rule: RecurrenceRule = { freq, interval };
  if (parts.has("COUNT")) {
    const count = Number(parts.get("COUNT"));
    if (!Number.isInteger(count) || count < 1) return "unsupported";
    rule.count = Math.min(count, ICS_LIMITS.maxIterations);
  }
  if (parts.has("UNTIL")) {
    const until = parseTimeValue(parts.get("UNTIL")!, {}, { ...ctx, calendarZone: null });
    if (!until) return "unsupported";
    // A floating UNTIL on a zoned series is read in the series' zone.
    rule.until =
      until.kind === "floating" && start.kind === "zoned" ? { kind: "zoned", wall: until.wall, ref: start.ref } : until;
  }
  if (parts.has("BYDAY")) {
    if (freq !== "WEEKLY") return "unsupported";
    const days: number[] = [];
    for (const code of parts.get("BYDAY")!.split(",")) {
      if (!(code in WEEKDAYS)) return "unsupported"; // ordinal forms like 2TU
      days.push(WEEKDAYS[code]);
    }
    rule.byDay = [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  }
  if (parts.has("BYMONTHDAY")) {
    const day = Number(parts.get("BYMONTHDAY"));
    if (freq !== "MONTHLY" || !Number.isInteger(day) || day < 1 || day > 31) return "unsupported";
    rule.byMonthDay = day;
  }
  if (parts.has("BYMONTH")) {
    if (freq !== "YEARLY" || Number(parts.get("BYMONTH")) !== start.wall.month) return "unsupported";
  }
  return rule;
}

const DAY_MS = 86_400_000;

function addDaysToWall(wall: WallTime, days: number): WallTime {
  const d = new Date(Date.UTC(wall.year, wall.month - 1, wall.day) + days * DAY_MS);
  return { ...wall, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function withWall(time: ICalTime, wall: WallTime): ICalTime {
  return { ...time, wall } as ICalTime;
}

/**
 * Occurrence start times of a repeating event inside [windowStart, windowEnd]
 * (instants in ms), excluding EXDATEs, bounded in steps and results.
 */
export function expandRule(
  start: ICalTime,
  rule: RecurrenceRule,
  window: { start: number; end: number },
  exdates: Set<string>,
  budget: { steps: number } = { steps: ICS_LIMITS.maxTotalIterations },
): ICalTime[] {
  const out: ICalTime[] = [];
  const untilMs = rule.until ? instantOf(rule.until) : Infinity;
  const firstMs = instantOf(start);
  const startDayMs = Date.UTC(start.wall.year, start.wall.month - 1, start.wall.day);
  let emitted = 0;
  let steps = 0;

  // Fast-forward plain daily / weekly rules to just before the window. Not
  // allowed with COUNT, which counts from the first occurrence.
  let k = 0;
  if (rule.count === undefined && (rule.freq === "DAILY" || rule.freq === "WEEKLY")) {
    const periodDays = rule.interval * (rule.freq === "WEEKLY" ? 7 : 1);
    const behind = Math.floor((window.start - startDayMs) / DAY_MS / periodDays) - 1;
    if (behind > 0) k = behind;
  }

  const consider = (wall: WallTime): "stop" | "next" => {
    steps += 1;
    budget.steps -= 1;
    if (steps > ICS_LIMITS.maxIterations || budget.steps < 0) return "stop";
    const time = withWall(start, wall);
    const ms = instantOf(time);
    if (ms < firstMs) return "next";
    emitted += 1;
    if (rule.count !== undefined && emitted > rule.count) return "stop";
    if (ms > untilMs || ms > window.end) return "stop";
    if (ms >= window.start && !exdates.has(compactTime(time))) {
      out.push(time);
      if (out.length >= ICS_LIMITS.maxOccurrencesPerSeries) return "stop";
    }
    return "next";
  };

  for (; steps <= ICS_LIMITS.maxIterations; k += 1) {
    if (rule.freq === "DAILY") {
      if (consider(addDaysToWall(start.wall, k * rule.interval)) === "stop") break;
    } else if (rule.freq === "WEEKLY") {
      if (!rule.byDay) {
        if (consider(addDaysToWall(start.wall, k * 7 * rule.interval)) === "stop") break;
        continue;
      }
      // Weeks start on Monday (the RFC default WKST).
      const startWeekday = new Date(startDayMs).getUTCDay();
      const monday = addDaysToWall(start.wall, -((startWeekday + 6) % 7));
      const weekBase = addDaysToWall(monday, k * 7 * rule.interval);
      let stop = false;
      for (const wd of rule.byDay) {
        if (consider(addDaysToWall(weekBase, (wd + 6) % 7)) === "stop") {
          stop = true;
          break;
        }
      }
      if (stop) break;
    } else if (rule.freq === "MONTHLY") {
      const monthIndex = start.wall.month - 1 + k * rule.interval;
      const year = start.wall.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const day = rule.byMonthDay ?? start.wall.day;
      if (year > 2200) break;
      if (day > daysInMonth(year, month)) {
        steps += 1;
        continue;
      }
      if (consider({ ...start.wall, year, month, day }) === "stop") break;
    } else {
      const year = start.wall.year + k * rule.interval;
      if (year > 2200) break;
      if (start.wall.day > daysInMonth(year, start.wall.month)) {
        steps += 1;
        continue;
      }
      if (consider({ ...start.wall, year }) === "stop") break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Occurrences

export interface Occurrence {
  /** Stable key for sync: the UID, plus "#<original start>" for one occurrence. */
  key: string;
  component: ParsedComponent;
  start: ICalTime;
  /** The repeating event's UID when this is one of its occurrences. */
  seriesUid?: string;
}

/** Small stable hash for events that arrive without a UID. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

/**
 * Turn components into dated occurrences: one per single event, one per
 * occurrence of a repeating event inside the window, with overrides
 * (RECURRENCE-ID) applied and cancelled events and occurrences left out.
 */
export function expandCalendar(
  cal: ParsedCalendar,
  window: { start: number; end: number },
  options: { deadline?: number } = {},
): { occurrences: Occurrence[]; warnings: Set<IcsWarning> } {
  const tick = budgetClock(options.deadline ?? Date.now() + ICS_LIMITS.timeBudgetMs, 16);
  const warnings = new Set(cal.warnings);
  const ctx: TimeContext = { zone: () => null, calendarZone: null, warnings };
  const overrides = new Map<string, Map<string, ParsedComponent>>();
  const masters: ParsedComponent[] = [];
  for (const c of cal.components) {
    if (c.recurrenceId && c.uid) {
      const byKey = overrides.get(c.uid) ?? new Map<string, ParsedComponent>();
      byKey.set(compactTime(c.recurrenceId), c);
      overrides.set(c.uid, byKey);
    } else {
      masters.push(c);
    }
  }

  const out: Occurrence[] = [];
  const used = new Set<string>();
  const push = (o: Occurrence) => {
    if (out.length >= ICS_LIMITS.maxEvents) {
      warnings.add("too_many_events");
      return;
    }
    let key = o.key;
    if (used.has(key)) key = `${o.key}#${compactTime(o.start)}`;
    if (used.has(key)) return;
    used.add(key);
    out.push({ ...o, key });
  };
  const masterUids = new Set(masters.map((m) => m.uid).filter(Boolean));
  const budget = { steps: ICS_LIMITS.maxTotalIterations };

  for (const c of masters) {
    tick();
    if (c.status === "CANCELLED") continue;
    const uid = c.uid || `nouid-${hashText(`${c.summary}|${compactTime(c.start)}`)}`;
    if (!c.rrule) {
      push({ key: uid, component: c, start: c.start });
      continue;
    }
    const rule = parseRule(c.rrule, c.start, ctx);
    if (rule === "unsupported") {
      warnings.add("unsupported_recurrence");
      push({ key: uid, component: c, start: c.start, seriesUid: uid });
      continue;
    }
    const exdates = new Set(c.exdates.map(compactTime));
    const own = overrides.get(c.uid);
    for (const time of expandRule(c.start, rule, window, exdates, budget)) {
      const occKey = compactTime(time);
      const override = own?.get(occKey);
      if (override) {
        own!.delete(occKey);
        if (override.status === "CANCELLED") continue;
        push({ key: `${uid}#${occKey}`, component: override, start: override.start, seriesUid: uid });
      } else {
        push({ key: `${uid}#${occKey}`, component: c, start: time, seriesUid: uid });
      }
    }
  }
  // Overrides whose original slot fell outside the window (or whose master is
  // missing) still count when the moved occurrence itself is in the window.
  for (const [uid, byKey] of overrides) {
    for (const [occKey, c] of byKey) {
      if (c.status === "CANCELLED") continue;
      const ms = instantOf(c.start);
      if (masterUids.has(uid) && (ms < window.start || ms > window.end)) continue;
      push({ key: `${uid}#${occKey}`, component: c, start: c.start, seriesUid: uid });
    }
  }
  return { occurrences: out, warnings };
}
