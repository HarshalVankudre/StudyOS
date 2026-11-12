/**
 * The student's "now": local date, weekday, time and IANA time zone.
 *
 * Every AI flow that writes or edits dates is told this, so "add a midterm next
 * Friday" resolves to a real date and generated deadlines land in the current
 * term instead of whatever year the model's training data suggests.
 *
 * The browser supplies only the time zone (it is the one thing the server can't
 * know); the instant itself always comes from the server clock, so a wrong or
 * spoofed client clock can't skew it. Pure and dependency-free so both routes
 * and tests can use it.
 */

/** Cookie the generator page sets with the browser's IANA zone. */
export const TIME_ZONE_COOKIE = "studyos_tz";

export const DEFAULT_TIME_ZONE = "UTC";

export interface StudentClock {
  /** Validated IANA zone, e.g. "Europe/Berlin". */
  timeZone: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Local weekday in English, e.g. "Thursday". */
  weekday: string;
  /** Local wall-clock time, HH:mm (24h). */
  time: string;
  /** Offset from UTC at this instant, e.g. "+01:00". */
  utcOffset: string;
}

/** The zone when it is a real IANA zone Intl accepts, otherwise null. */
export function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 100) return null;
  // IANA names are letters, digits, "/", "_", "-", "+". Reject anything else
  // before handing it to Intl (keeps odd input out of prompts).
  if (!/^[A-Za-z0-9/_+-]+$/.test(candidate)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return null;
  }
}

/** First valid zone among the candidates (most trusted first), else UTC. */
export function resolveTimeZone(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const zone = validTimeZone(candidate);
    if (zone) return zone;
  }
  return DEFAULT_TIME_ZONE;
}

/** Read the time-zone cookie from a raw Cookie header. */
export function timeZoneFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== TIME_ZONE_COOKIE) continue;
    try {
      return validTimeZone(decodeURIComponent(rest.join("=")));
    } catch {
      return null;
    }
  }
  return null;
}

/** The student's local clock at `now` in `timeZone` (invalid zones fall back to UTC). */
export function studentClock(timeZone?: string | null, now: Date = new Date()): StudentClock {
  const zone = validTimeZone(timeZone) ?? DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const offset = part("timeZoneName").replace(/^GMT/, "");
  return {
    timeZone: zone,
    date: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: part("weekday"),
    time: `${part("hour")}:${part("minute")}`,
    utcOffset: offset === "" ? "+00:00" : offset,
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Add whole days to an ISO date (calendar arithmetic, no time zone involved). */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Weekday abbreviation of an ISO date. */
export function weekdayOfIso(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Prompt block telling the model what "now" is. Put it near the END of a
 * prompt: it changes every minute, so placing it after the long stable prefix
 * (system prompt, examples) keeps that prefix cacheable.
 */
export function clockPromptBlock(
  clock: StudentClock,
  purpose: "generate" | "agent",
): string {
  const upcoming = Array.from({ length: 14 }, (_, index) => {
    const date = addDaysIso(clock.date, index + 1);
    return `${weekdayOfIso(date)} ${date}`;
  }).join(", ");
  const lines = [
    "CURRENT DATE AND TIME (the student's local clock — the anchor for every date you write):",
    `- Today is ${clock.weekday}, ${clock.date}, ${clock.time} in ${clock.timeZone} (UTC${clock.utcOffset}).`,
    `- The next 14 days: ${upcoming}.`,
    '- Resolve relative dates ("tomorrow", "next Friday", "in two weeks", "end of the month") from today. If one is ambiguous, pick the most likely date and name the exact date you used.',
    "- Write every date as ISO YYYY-MM-DD.",
  ];
  if (purpose === "generate") {
    lines.push(
      "- Dates from the student's own course material are authoritative: use them exactly.",
      "- Every other date (starter deadlines, exams, study sessions) must fall in the student's current or upcoming academic term relative to today — never before today. Spread them realistically over the rest of the term (regular homework, midterms mid-term, finals at the end). If the current term ends within about three weeks, plan the next term instead.",
    );
  } else {
    lines.push(
      "- Never move or create a deadline in the past unless the student explicitly asks for it.",
    );
  }
  return lines.join("\n");
}
