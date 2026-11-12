/**
 * Calendar-day helpers for studying. A "study day" is always the student's
 * LOCAL calendar day, written as YYYY-MM-DD. Day strings compare correctly as
 * plain strings, which is what the schedule (`Flashcard.dueAt`), the streak and
 * the Daily Study Agent all rely on.
 *
 * Two ways to get a local day:
 *  - in the browser, `isoDay(date)` reads the device's own calendar;
 *  - on the server (which runs in UTC), `dayAtOffset(date, offsetMinutes)`
 *    applies the offset the browser reported (`Date.getTimezoneOffset()`,
 *    minutes, positive WEST of UTC) and reads the UTC calendar.
 */

/** Matches a YYYY-MM-DD day string. */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Largest real-world UTC offset magnitude (UTC+14 / UTC-12), in minutes. */
export const MAX_OFFSET_MINUTES = 14 * 60;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The device-local calendar day of `date` as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The UTC calendar day of `date` as YYYY-MM-DD. */
export function utcDay(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Clamp a client-reported offset to a real time-zone range (NaN → 0). */
export function safeOffset(offsetMinutes: number): number {
  if (!Number.isFinite(offsetMinutes)) return 0;
  return Math.max(-MAX_OFFSET_MINUTES, Math.min(MAX_OFFSET_MINUTES, Math.round(offsetMinutes)));
}

/**
 * The student's local day for `date`, given their `getTimezoneOffset()`.
 * Independent of the server's own time zone.
 */
export function dayAtOffset(date: Date, offsetMinutes: number): string {
  return utcDay(new Date(date.getTime() - safeOffset(offsetMinutes) * 60_000));
}

/** `day` shifted by `n` calendar days (DST-safe: pure calendar arithmetic). */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Math.round(n)));
  return utcDay(dt);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Local midnight at the start of `day`, on this device. */
export function startOfLocalDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Day strings from `from` to `to` inclusive (empty when `to` < `from`). */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(shiftDay(from, i));
  return out;
}
