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
import { expandCalendar, instantOf, parseIcs, wallDay, type ICalTime, type Occurrence } from "./ical";

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

export type ReadFeedResult = { ok: true; feed: FeedSnapshot } | { ok: false; error: "not_calendar" | "studyos_feed" };

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
 * scheme), a long path, and long query values (Moodle authtoken, Canvas and
 * Google tokens). Any text containing one is redacted or dropped.
 */
export function feedSecrets(feedUrl: string | undefined): string[] {
  if (!feedUrl) return [];
  const out = new Set<string>();
  try {
    const url = new URL(feedUrl);
    out.add(url.href);
    out.add(`${url.host}${url.pathname}`);
    if (url.pathname.length >= 16) out.add(url.pathname);
    for (const value of url.searchParams.values()) if (value.length >= 12) out.add(value);
    for (const segment of url.pathname.split("/")) if (segment.length >= 20) out.add(segment);
  } catch {
    out.add(feedUrl);
  }
  return [...out].filter((s) => s.length >= 8);
}

function containsSecret(text: string, secrets: string[]): boolean {
  if (!text || secrets.length === 0) return false;
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // keep raw
  }
  return secrets.some((s) => text.includes(s) || decoded.includes(s));
}

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join("…");
  return out;
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
 */
export function readFeed(
  text: string,
  options: { now?: number; feedUrl?: string } = {},
): ReadFeedResult {
  const cal = parseIcs(text);
  if (!cal) return { ok: false, error: "not_calendar" };
  if (/\/\/StudyOS\/\//i.test(cal.prodId)) return { ok: false, error: "studyos_feed" };

  const now = options.now ?? Date.now();
  const windowStart = now - HISTORY_DAYS * DAY_MS;
  const window = { start: windowStart, end: now + FUTURE_DAYS * DAY_MS };
  const platform = detectPlatform(cal.prodId, cal.components.map((c) => c.uid));
  const { occurrences, warnings } = expandCalendar(cal, window);

  const secrets = feedSecrets(options.feedUrl);
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
    events.push({
      key: occ.key.slice(0, 500),
      title: title.slice(0, 300),
      when: whenOf(occ.start),
      ...(link ? { link } : {}),
      ...(course ? { course } : {}),
      role: cleaned.role,
      ...(occ.seriesUid ? { series: occ.seriesUid.slice(0, 400) } : {}),
      ...(c.completed ? { completed: true } : {}),
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
