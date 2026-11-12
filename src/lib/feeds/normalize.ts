/**
 * From a parsed calendar to the deadline events StudyOS imports: platform
 * detection, title and course cleanup for the common learning platforms,
 * safe links, echo suppression and secret redaction. Pure and isomorphic
 * (runs on the server for feeds and in the browser for uploaded files).
 *
 * Platform shapes handled (degrading to plain titles for anything else):
 *   Canvas       SUMMARY "Essay 2 [ENG 102-01 FA26]" (course code in trailing
 *                brackets), UID "event-assignment-123" for assignments,
 *                "event-calendar-event-45" for plain calendar events, URL set.
 *   Moodle       SUMMARY "Essay 2 is due" / "Quiz 1 closes" / "Quiz 1 opens",
 *                course in CATEGORIES, no URL (the link may be in DESCRIPTION).
 *   Brightspace  SUMMARY "Lab 3 - Due" / "Quiz - Availability Ends", course in
 *                LOCATION.
 *   Blackboard   SUMMARY "CHEM-101-001: Lab report" or plain, course sometimes
 *                as a code prefix.
 *   Google       Free-form SUMMARY; a "[CS 101]" suffix or "CS 101: " prefix
 *                is still read as the course.
 */
import { dayKeyOf } from "@/lib/workspace/view-logic";
import {
  ICS_LIMITS,
  IcsBudgetError,
  expandCalendar,
  hashText,
  instantOf,
  parseIcs,
  wallDay,
  type ICalTime,
  type Occurrence,
} from "./ical";

export type FeedPlatform =
  | "canvas"
  | "moodle"
  | "blackboard"
  | "brightspace"
  | "google"
  | "outlook"
  | "apple"
  | "other";

/** When an event is due: an all-day date, a UTC instant, or a floating local time. */
export type FeedWhen = { date: string } | { at: number } | { local: string };

export interface FeedEvent {
  /** Stable sync key (UID, plus "#<original start>" for an occurrence). */
  key: string;
  title: string;
  when: FeedWhen;
  /** http(s) link back to the item on the platform. */
  link?: string;
  /** The course as the feed names it ("ENG 102-01 FA26", "Intro to Psychology"). */
  course?: string;
  /** "opening" = the start of an availability window, not a deadline. */
  role: "deadline" | "opening" | "event";
  /** The repeating event's key when this is one of its occurrences. */
  series?: string;
  completed?: boolean;
  /** Calendar days the event covers, when more than one ("Reading week"). */
  days?: number;
}

export interface FeedSnapshot {
  platform: FeedPlatform;
  /** The calendar's own name (X-WR-CALNAME), if any. */
  name: string;
  events: FeedEvent[];
  /**
   * Oldest UTC day covered. Events (and occurrences) before it are not read,
   * so a row whose event is older than this must never be flagged as gone.
   */
  horizonDay: string;
  /** Events skipped because StudyOS itself published them (an echo). */
  echoes: number;
  warnings: string[];
}

export type ReadFeedResult =
  | { ok: true; feed: FeedSnapshot }
  | { ok: false; error: "not_calendar" | "studyos_feed" | "too_large" };

export const HISTORY_DAYS = 120;
export const FUTURE_DAYS = 400;
const DAY_MS = 86_400_000;

/** UIDs StudyOS writes in its own outgoing feed (lib/calendar/events.ts). */
export function isStudyOsUid(uid: string): boolean {
  return /@studyos$/i.test(uid.trim());
}

export function detectPlatform(prodId: string, uids: string[]): FeedPlatform {
  const p = prodId.toLowerCase();
  if (p.includes("instructure") || p.includes("canvas")) return "canvas";
  if (p.includes("moodle")) return "moodle";
  if (p.includes("blackboard")) return "blackboard";
  if (p.includes("desire2learn") || p.includes("d2l") || p.includes("brightspace")) return "brightspace";
  if (p.includes("google")) return "google";
  if (p.includes("microsoft") || p.includes("outlook") || p.includes("exchange")) return "outlook";
  if (p.includes("apple")) return "apple";
  if (uids.some((u) => /^event-(assignment|calendar-event)-\d+/.test(u))) return "canvas";
  return "other";
}

// ---------------------------------------------------------------------------
// Secrets

/**
 * Pieces of a feed link that grant access: the link itself (with or without
 * scheme), a long path, long query values (Moodle authtoken, Canvas and
 * Google tokens), and the bare token inside a path segment or value
 * ("user_<token>.ics" → "<token>", "private-<token>" → "<token>"). Any text
 * containing one is redacted or dropped.
 */
export function feedSecrets(feedUrl: string | undefined): string[] {
  if (!feedUrl) return [];
  const out = new Set<string>();
  const addPieces = (value: string) => {
    for (const piece of value.split(/[._~\-+=]+/)) if (piece.length >= 16) out.add(piece);
  };
  try {
    const url = new URL(feedUrl);
    out.add(url.href);
    out.add(`${url.host}${url.pathname}`);
    if (url.pathname.length >= 16) out.add(url.pathname);
    for (const value of url.searchParams.values()) {
      if (value.length >= 12) out.add(value);
      addPieces(value);
    }
    for (const segment of url.pathname.split("/")) {
      if (segment.length >= 20) out.add(segment);
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // keep raw
      }
      addPieces(decoded);
    }
  } catch {
    out.add(feedUrl);
  }
  return [...out].filter((s) => s.length >= 8);
}

/**
 * The letters and digits of `text`, lowercased after NFKC folding and with
 * %xx escapes decoded, plus for each kept character the span of `text` it
 * came from. Matching secrets on this skeleton defeats case changes,
 * percent-encoding, full-width digits, and any separator slipped inside a
 * token (zero-width characters, an escaped comma, spaces, dashes).
 */
function skeleton(text: string): { chars: string; from: number[]; to: number[] } {
  let chars = "";
  const from: number[] = [];
  const to: number[] = [];
  const isHex = (code: number) =>
    (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
  let i = 0;
  while (i < text.length) {
    let piece: string;
    let width: number;
    if (text[i] === "%" && isHex(text.charCodeAt(i + 1)) && isHex(text.charCodeAt(i + 2))) {
      piece = String.fromCharCode(parseInt(text.slice(i + 1, i + 3), 16));
      width = 3;
    } else {
      const cp = text.codePointAt(i)!;
      width = cp > 0xffff ? 2 : 1;
      piece = String.fromCodePoint(cp);
      if (cp > 0x7f) piece = piece.normalize("NFKC");
    }
    for (const c of piece.toLowerCase()) {
      const code = c.charCodeAt(0);
      if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) {
        chars += c;
        from.push(i);
        to.push(i + width);
      }
    }
    i += width;
  }
  return { chars, from, to };
}

/**
 * Skeleton forms of the secrets, with both halves of long bare tokens (a
 * half of a random token still narrows it down; halves of a path or host
 * would only redact ordinary words).
 */
function secretSkeletons(secrets: string[]): string[] {
  const out = new Set<string>();
  for (const s of secrets) {
    const k = skeleton(s).chars;
    if (k.length < 12) continue;
    out.add(k);
    if (k.length >= 24 && !/[/.]/.test(s)) {
      const half = Math.ceil(k.length / 2);
      out.add(k.slice(0, half));
      out.add(k.slice(k.length - half));
    }
  }
  return [...out];
}

function containsSecret(text: string, secrets: string[]): boolean {
  if (!text || secrets.length === 0) return false;
  const k = skeleton(text).chars;
  return secrets.some((s) => k.includes(s));
}

/** Replace every span of `text` that spells a secret with "…". */
function redact(text: string, secrets: string[]): string {
  const sk = skeleton(text);
  const spans: [number, number][] = [];
  for (const s of secrets) {
    for (let at = sk.chars.indexOf(s); at !== -1; at = sk.chars.indexOf(s, at + 1)) {
      spans.push([sk.from[at], sk.to[at + s.length - 1]]);
    }
  }
  if (spans.length === 0) return text;
  spans.sort((a, b) => a[0] - b[0]);
  let out = "";
  let pos = 0;
  for (const [start, end] of spans) {
    if (end <= pos) continue;
    if (start >= pos) {
      out += text.slice(pos, start) + "…";
    }
    pos = Math.max(pos, end);
  }
  return out + text.slice(pos);
}

/**
 * A sync key (event UID) that would carry a secret is replaced by a stable
 * hash of itself, so the token never reaches the workspace document while
 * the same event still maps to the same row on every sync.
 */
function safeUid(uid: string, secrets: string[]): string {
  return containsSecret(uid, secrets) ? `h-${hashText(uid)}` : uid;
}

// ---------------------------------------------------------------------------
// Titles, courses, links

const TRAILING_BRACKET = /\s*\[([^\[\]]{1,120})\]\s*$/;
/** "CS101", "CS 101", "CHEM-101-001", "MATH2410H" — a course-code prefix. */
const CODE_PREFIX = /^([A-Z]{2,6}[\s_-]?\d{2,4}[A-Z]?(?:[\s_-]\d{1,4}[A-Z]?)?)\s*(?::|-|–|—|\|)\s+(.+)$/;

const MOODLE_SUFFIX = /\s+(is due|is due\.|due|closes|should be completed|deadline)\s*$/i;
const MOODLE_OPENS = /\s+(opens|is open|starts)\s*$/i;
const D2L_SUFFIX = /\s+[-–]\s+(Due|Availability Ends|End Date|Ends)\s*$/i;
const D2L_OPENS = /\s+[-–]\s+(Availability Starts|Start Date|Starts)\s*$/i;

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface Cleaned {
  title: string;
  course?: string;
  role: FeedEvent["role"];
}

export function cleanTitle(
  summary: string,
  platform: FeedPlatform,
  extras: { categories: string[]; location: string; uid: string },
): Cleaned {
  let title = tidy(summary);
  let course: string | undefined;
  let role: FeedEvent["role"] = "event";

  const bracket = TRAILING_BRACKET.exec(title);
  if (bracket && (platform === "canvas" || platform === "google" || platform === "other" || platform === "apple" || platform === "outlook")) {
    course = tidy(bracket[1]);
    title = tidy(title.slice(0, bracket.index));
  }
  if (platform === "canvas") {
    role = /^event-assignment-/.test(extras.uid) ? "deadline" : "event";
  }
  if (platform === "moodle") {
    if (MOODLE_OPENS.test(title)) role = "opening";
    else if (MOODLE_SUFFIX.test(title)) {
      title = tidy(title.replace(MOODLE_SUFFIX, ""));
      role = "deadline";
    }
    course = course ?? extras.categories[0];
  }
  if (platform === "brightspace") {
    if (D2L_OPENS.test(title)) role = "opening";
    else if (D2L_SUFFIX.test(title)) {
      title = tidy(title.replace(D2L_SUFFIX, ""));
      role = "deadline";
    }
    course = course ?? (extras.location || undefined);
  }
  if (!course) {
    const prefix = CODE_PREFIX.exec(title);
    if (prefix) {
      course = tidy(prefix[1]);
      title = tidy(prefix[2]);
    }
  }
  if (!course && platform !== "google" && platform !== "apple" && platform !== "outlook") {
    course = extras.categories[0];
  }
  if (role === "event" && /\b(due|deadline|submission|submit)\b/i.test(summary)) role = "deadline";
  return { title: title || tidy(summary), course: course ? course.slice(0, 120) : undefined, role };
}

function httpLink(raw: string): string | undefined {
  const value = raw.trim();
  if (!value || value.length > 2_000) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function sameSite(a: string, b: string): boolean {
  const tail = (h: string) => h.toLowerCase().split(".").slice(-2).join(".");
  return tail(a) === tail(b);
}

function pickLink(
  occurrence: Occurrence,
  platform: FeedPlatform,
  feedHost: string | undefined,
  secrets: string[],
): string | undefined {
  const own = httpLink(occurrence.component.url);
  const candidates: string[] = own ? [own] : [];
  // Learning platforms that omit URL usually put the item link in the
  // description; only trust one that points at the platform itself.
  if (!own && feedHost && (platform === "moodle" || platform === "brightspace" || platform === "blackboard")) {
    const match = occurrence.component.description.match(/https?:\/\/[^\s<>"')\]]+/);
    const link = match ? httpLink(match[0]) : undefined;
    if (link && sameSite(new URL(link).hostname, feedHost)) candidates.push(link);
  }
  return candidates.find((link) => !containsSecret(link, secrets));
}

function whenOf(time: ICalTime): FeedWhen {
  if (time.kind === "date") return { date: wallDay(time.wall) };
  if (time.kind === "floating") {
    const w = time.wall;
    const p = (n: number) => String(n).padStart(2, "0");
    return { local: `${wallDay(w)}T${p(w.hour)}:${p(w.minute)}:${p(w.second)}` };
  }
  return { at: instantOf(time) };
}

// ---------------------------------------------------------------------------

/**
 * Read a calendar's text into deadline events. `feedUrl` (server only) lets
 * the reader drop anything that would echo the secret link back.
 *
 * Reading is synchronous and bounded in time (`ICS_LIMITS.timeBudgetMs`, or
 * `options.timeBudgetMs`): a calendar that cannot be read within it is
 * refused as "too_large" rather than returned in part, because a partial
 * read would make the next sync flag every missing event as gone.
 */
export function readFeed(
  text: string,
  options: { now?: number; feedUrl?: string; timeBudgetMs?: number } = {},
): ReadFeedResult {
  try {
    return readFeedWithin(text, options, Date.now() + (options.timeBudgetMs ?? ICS_LIMITS.timeBudgetMs));
  } catch (error) {
    if (error instanceof IcsBudgetError) return { ok: false, error: "too_large" };
    throw error;
  }
}

function readFeedWithin(
  text: string,
  options: { now?: number; feedUrl?: string },
  deadline: number,
): ReadFeedResult {
  const cal = parseIcs(text, { deadline });
  if (!cal) return { ok: false, error: "not_calendar" };
  if (/\/\/StudyOS\/\//i.test(cal.prodId)) return { ok: false, error: "studyos_feed" };

  const now = options.now ?? Date.now();
  const windowStart = now - HISTORY_DAYS * DAY_MS;
  const window = { start: windowStart, end: now + FUTURE_DAYS * DAY_MS };
  const platform = detectPlatform(cal.prodId, cal.components.map((c) => c.uid));
  const { occurrences, warnings } = expandCalendar(cal, window, { deadline });

  const secrets = secretSkeletons(feedSecrets(options.feedUrl));
  let feedHost: string | undefined;
  try {
    feedHost = options.feedUrl ? new URL(options.feedUrl).hostname : undefined;
  } catch {
    feedHost = undefined;
  }

  let echoes = 0;
  const events: FeedEvent[] = [];
  for (const occ of occurrences) {
    const c = occ.component;
    if (isStudyOsUid(c.uid)) {
      echoes += 1;
      continue;
    }
    // Single events older than the history window are not deadlines anyone
    // needs imported; repeating ones were already windowed.
    if (!occ.seriesUid && instantOf(occ.start) < windowStart) continue;
    const cleaned = cleanTitle(c.summary, platform, { categories: c.categories, location: c.location, uid: c.uid });
    const title = containsSecret(cleaned.title, secrets) ? redact(cleaned.title, secrets) : cleaned.title;
    const course = cleaned.course && !containsSecret(cleaned.course, secrets) ? cleaned.course : undefined;
    const link = pickLink(occ, platform, feedHost, secrets);
    // The sync key starts with the UID (the series UID for an occurrence);
    // a UID carrying the token is swapped for its hash, keeping the rest.
    let key = occ.key;
    let series = occ.seriesUid;
    if (secrets.length > 0) {
      const uid = occ.seriesUid ?? c.uid;
      if (uid && key.startsWith(uid)) key = safeUid(uid, secrets) + key.slice(uid.length);
      key = safeUid(key, secrets);
      if (series) series = safeUid(series, secrets);
    }
    events.push({
      key: key.slice(0, 500),
      title: title.slice(0, 300),
      when: whenOf(occ.start),
      ...(link ? { link } : {}),
      ...(course ? { course } : {}),
      role: cleaned.role,
      ...(series ? { series: series.slice(0, 400) } : {}),
      ...(c.completed ? { completed: true } : {}),
      ...(c.spanDays && c.spanDays > 1 ? { days: c.spanDays } : {}),
    });
  }
  events.sort((a, b) => sortInstant(a.when) - sortInstant(b.when));

  const horizon = new Date(windowStart);
  return {
    ok: true,
    feed: {
      platform,
      name: containsSecret(cal.name, secrets) ? "" : cal.name,
      events,
      horizonDay: horizon.toISOString().slice(0, 10),
      echoes,
      warnings: [...warnings],
    },
  };
}

function sortInstant(when: FeedWhen): number {
  if ("at" in when) return when.at;
  if ("date" in when) return Date.parse(`${when.date}T12:00:00Z`);
  return Date.parse(`${when.local}Z`);
}

/**
 * The student's local calendar day for an event (YYYY-MM-DD): all-day dates
 * and floating times keep their own day; instants are read in `timeZone`
 * (the browser's zone when omitted).
 */
export function eventDay(when: FeedWhen, timeZone?: string): string {
  if ("date" in when) return when.date;
  if ("local" in when) return when.local.slice(0, 10);
  return dayKeyOf(new Date(when.at), timeZone);
}
