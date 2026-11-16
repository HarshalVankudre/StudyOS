/**
 * When each kind of notification is due, in the student's own time zone.
 * Pure: every function takes the instant ("now") as an argument, so tests run
 * on a fake clock, and nothing depends on the server's time zone.
 *
 * A student has at most three moments a day (the daily plan, deadline
 * reminders, the streak check), plus the weekly recap on one chosen weekday
 * when they turned it on. Each is a local wall-clock time on a local
 * day, turned into an instant with the zone's rules for THAT day, so daylight
 * saving changes are handled: a time that does not exist (the hour skipped in
 * spring) moves forward by the gap, and a time that happens twice (the hour
 * repeated in autumn) uses the first one.
 *
 * Quiet hours: a moment that falls inside them waits until they end, if that
 * is still the same local day; otherwise it is skipped. The streak check never
 * waits (a "your streak is still open" at 7 the next morning would be wrong).
 *
 * Lateness: a moment is still sent up to GRACE_MS after it, except the weekly
 * recap, which stays due until the end of its local day (a missed run sends
 * it late the same evening). Nothing is ever sent after local midnight.
 */
import { addDays, dayDiff } from "@/lib/workspace/view-logic";

export const NOTIFICATION_KINDS = ["daily", "deadline", "streak", "weekly"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Local time of the streak check (20:00): late in the day, before most quiet hours. */
export const STREAK_MINUTE = 20 * 60;
/** A moment is still sent this long after it was due (a late or skipped tick). */
export const GRACE_MS = 90 * 60 * 1000;
/** The furthest ahead a next moment can be: the weekly recap, a week away. */
const LOOKAHEAD_DAYS = 7;

export interface ScheduleSettings {
  timeZone: string;
  dailyEnabled: boolean;
  dailyMinute: number;
  deadlineEnabled: boolean;
  deadlineMinute: number;
  streakEnabled: boolean;
  weeklyEnabled: boolean;
  /** 0 = Sunday … 6 = Saturday, in the student's zone. */
  weeklyDay: number;
  weeklyMinute: number;
  quietEnabled: boolean;
  quietStart: number;
  quietEnd: number;
}

export interface Slot {
  kind: NotificationKind;
  /** The student's local day the moment belongs to. */
  localDate: string;
  /** When it is sent (after the quiet-hours rule). */
  at: Date;
}

// ---- Time-zone arithmetic ---------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** A valid IANA zone name, else "UTC". */
export function safeTimeZone(value: string | null | undefined): string {
  const candidate = value?.trim().slice(0, 100);
  if (!candidate) return "UTC";
  try {
    formatter(candidate);
    return candidate;
  } catch {
    return "UTC";
  }
}

export interface LocalClock {
  /** YYYY-MM-DD */
  date: string;
  /** Minutes after local midnight, 0..1439. */
  minute: number;
}

/** The wall clock in `timeZone` at `instant`. */
export function localClock(instant: Date, timeZone: string): LocalClock {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${get("year")}-${pad(get("month"))}-${pad(get("day"))}`,
    minute: (get("hour") % 24) * 60 + get("minute"),
  };
}

/** Local wall time minus UTC at `instant`, in milliseconds. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which the clock in `timeZone` reads `minute` on `localDate`.
 * Skipped times move forward by the gap; repeated times take the first.
 */
export function zonedInstant(localDate: string, minute: number, timeZone: string): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minute);
  const before = offsetMs(wall - 86_400_000, timeZone);
  const after = offsetMs(wall + 86_400_000, timeZone);
  const candidates = [...new Set([wall - before, wall - after])].sort((a, b) => a - b);
  const exact = candidates.filter((t) => t + offsetMs(t, timeZone) === wall);
  if (exact.length > 0) return new Date(exact[0]);
  // In a gap: the offset in force before the change carries the wall time
  // past it (02:30 in a 02:00→03:00 jump becomes 03:30).
  return new Date(wall - before);
}

// ---- Quiet hours ------------------------------------------------------------

/** Is `minute` inside quiet hours [start, end), which may wrap midnight? */
export function inQuietHours(minute: number, settings: Pick<ScheduleSettings, "quietEnabled" | "quietStart" | "quietEnd">): boolean {
  if (!settings.quietEnabled) return false;
  const { quietStart: start, quietEnd: end } = settings;
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * Where a moment at `minute` lands after quiet hours: the same minute, the
 * end of quiet hours later that day, or null (skipped).
 */
export function afterQuietHours(
  minute: number,
  settings: Pick<ScheduleSettings, "quietEnabled" | "quietStart" | "quietEnd">,
  canWait: boolean,
): number | null {
  if (!inQuietHours(minute, settings)) return minute;
  if (!canWait) return null;
  // The end of quiet hours is later the same day only when it is after `minute`.
  return settings.quietEnd > minute ? settings.quietEnd : null;
}

// ---- Slots ------------------------------------------------------------------

/** The weekday (0 = Sunday … 6 = Saturday) of a local YYYY-MM-DD day. */
export function weekdayOf(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function slotMinute(kind: NotificationKind, s: ScheduleSettings, localDate: string): number | null {
  switch (kind) {
    case "daily":
      return s.dailyEnabled ? afterQuietHours(s.dailyMinute, s, true) : null;
    case "deadline":
      return s.deadlineEnabled ? afterQuietHours(s.deadlineMinute, s, true) : null;
    case "streak":
      return s.streakEnabled ? afterQuietHours(STREAK_MINUTE, s, false) : null;
    case "weekly":
      return s.weeklyEnabled && weekdayOf(localDate) === s.weeklyDay
        ? afterQuietHours(s.weeklyMinute, s, true)
        : null;
  }
}

/** How long after its moment a kind is still sent (see "Lateness" above). */
function stillDue(slot: Slot, t: number): boolean {
  const late = t - slot.at.getTime();
  if (late < 0) return false;
  // The weekly recap: any time later the same local day (slots are of today).
  return slot.kind === "weekly" || late <= GRACE_MS;
}

/** The moments of one local day, in time order. */
export function slotsForDay(localDate: string, settings: ScheduleSettings): Slot[] {
  const tz = safeTimeZone(settings.timeZone);
  const out: Slot[] = [];
  for (const kind of NOTIFICATION_KINDS) {
    const minute = slotMinute(kind, settings, localDate);
    if (minute === null) continue;
    out.push({ kind, localDate, at: zonedInstant(localDate, minute, tz) });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.kind.localeCompare(b.kind));
}

/**
 * Today's moments due at `now`: passed, but by no more than the grace period
 * (the weekly recap: by no more than the rest of the day). A moment of
 * yesterday is never sent after midnight (its content would be about the
 * wrong day).
 */
export function dueSlots(settings: ScheduleSettings, now: Date): Slot[] {
  const today = localClock(now, safeTimeZone(settings.timeZone)).date;
  const t = now.getTime();
  return slotsForDay(today, settings).filter((slot) => stillDue(slot, t));
}

/** The first moment strictly after `now` (null when everything is off). */
export function nextSlotAfter(settings: ScheduleSettings, now: Date): Date | null {
  const today = localClock(now, safeTimeZone(settings.timeZone)).date;
  // Today plus a full week: the weekly recap may be seven days away.
  for (let i = 0; i <= LOOKAHEAD_DAYS; i++) {
    const next = slotsForDay(addDays(today, i), settings).find((slot) => slot.at.getTime() > now.getTime());
    if (next) return next.at;
  }
  return null;
}

/** Days from `localDate` to `dueDate` (calendar days, DST-safe). */
export function daysUntil(localDate: string, dueDate: string): number {
  return dayDiff(localDate, dueDate);
}
