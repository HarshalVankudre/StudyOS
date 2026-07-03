/**
 * Minimal RFC 5545 (iCalendar) serializer for StudyOS deadline feeds.
 * Pure and dependency-free so it's fully unit-testable.
 *
 * Produces a VCALENDAR of all-day VEVENTs that Google/Apple/Outlook Calendar
 * can subscribe to at a webcal/https URL. Handles the three things naive
 * emitters get wrong: text escaping, 75-octet line folding, and CRLF endings.
 */
import type { CalendarEvent } from "./events";

/** Escape a text value per RFC 5545 §3.3.11 (backslash, ; , and newlines). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Fold a content line to <=75 OCTETS with CRLF + space continuations (§3.1).
 * Folds on UTF-8 byte length and only ever breaks between code points, so a
 * multibyte character (accented course name, CJK, emoji) is never split into
 * invalid bytes — which naive length-based folding would do.
 */
export function foldLine(line: string): string {
  if (utf8Bytes(line) <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let limit = 75; // first line has no leading space
  for (const cp of line) {
    // Iterating a string yields whole code points, never half a surrogate pair.
    if (utf8Bytes(cur) + utf8Bytes(cp) > limit) {
      out.push(cur);
      cur = cp;
      limit = 74; // continuation lines spend 1 octet on the leading space
    } else {
      cur += cp;
    }
  }
  if (cur) out.push(cur);
  return out.map((l, i) => (i === 0 ? l : " " + l)).join("\r\n");
}

/** UTC timestamp form YYYYMMDDTHHMMSSZ for DTSTAMP. */
function icsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** YYYY-MM-DD → YYYYMMDD for all-day DATE values. */
function icsDate(day: string): string {
  return day.slice(0, 10).replace(/-/g, "");
}

export function buildIcs(
  events: CalendarEvent[],
  opts: { name: string; now: Date },
): string {
  const stamp = icsTimestamp(opts.now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StudyOS//Deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(`X-WR-CALNAME:${escapeText(opts.name)}`),
  ];
  for (const ev of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(foldLine(`UID:${escapeText(ev.uid)}`));
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(ev.date)}`);
    lines.push(foldLine(`SUMMARY:${escapeText(ev.summary)}`));
    if (ev.description) {
      lines.push(foldLine(`DESCRIPTION:${escapeText(ev.description)}`));
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
