/**
 * A student's notification choices: shape, defaults and validation. Pure, so
 * the settings UI, the API routes and the dispatch share one definition.
 */
import { z } from "zod";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { safeTimeZone, type ScheduleSettings } from "./schedule";

/** Lead times a student can pick, in days before the due date. */
export const LEAD_DAY_OPTIONS = [1, 2, 3, 5, 7, 14] as const;
export const DEFAULT_DEADLINE_LEADS = [7, 2, 1];
/** Exams get an earlier first reminder. */
export const DEFAULT_EXAM_LEADS = [14, 7, 2, 1];
/** At most this many notifications per local day, whatever is due. */
export const DAILY_CAP = 4;

export interface NotificationPreferences extends ScheduleSettings {
  locale: Locale;
  deadlineLeads: number[];
  examLeads: number[];
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  timeZone: "UTC",
  locale: DEFAULT_LOCALE,
  dailyEnabled: true,
  dailyMinute: 8 * 60,
  deadlineEnabled: true,
  deadlineMinute: 18 * 60,
  deadlineLeads: DEFAULT_DEADLINE_LEADS,
  examLeads: DEFAULT_EXAM_LEADS,
  streakEnabled: true,
  quietEnabled: true,
  quietStart: 22 * 60,
  quietEnd: 7 * 60,
};

const minute = z.number().int().min(0).max(1439);
const leads = z
  .array(z.number().int())
  .max(LEAD_DAY_OPTIONS.length)
  .transform((list) => normalizeLeads(list));

/** What the settings form may change (everything optional: a partial update). */
export const preferencesInputSchema = z
  .object({
    timeZone: z.string().max(100),
    locale: z.string().max(10),
    dailyEnabled: z.boolean(),
    dailyMinute: minute,
    deadlineEnabled: z.boolean(),
    deadlineMinute: minute,
    deadlineLeads: leads,
    examLeads: leads,
    streakEnabled: z.boolean(),
    quietEnabled: z.boolean(),
    quietStart: minute,
    quietEnd: minute,
  })
  .partial()
  .strict();
export type PreferencesInput = z.input<typeof preferencesInputSchema>;

export function normalizeLeads(list: readonly number[]): number[] {
  const allowed = new Set<number>(LEAD_DAY_OPTIONS);
  return [...new Set(list.filter((n) => allowed.has(n)))].sort((a, b) => b - a);
}

function parseLeads(text: string | null | undefined, fallback: number[]): number[] {
  if (!text) return fallback;
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? normalizeLeads(value.filter((n) => typeof n === "number")) : fallback;
  } catch {
    return fallback;
  }
}

const clampMinute = (n: number | undefined, fallback: number) =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1439 ? n : fallback;

export interface PreferenceRow {
  timeZone: string;
  locale: string;
  dailyEnabled: boolean;
  dailyMinute: number;
  deadlineEnabled: boolean;
  deadlineMinute: number;
  deadlineLeads: string;
  examLeads: string;
  streakEnabled: boolean;
  quietEnabled: boolean;
  quietStart: number;
  quietEnd: number;
}

/** A stored row as preferences (tolerant: bad values fall back to defaults). */
export function fromRow(row: PreferenceRow | null | undefined): NotificationPreferences {
  if (!row) return { ...DEFAULT_PREFERENCES };
  const d = DEFAULT_PREFERENCES;
  return {
    timeZone: safeTimeZone(row.timeZone),
    locale: isLocale(row.locale) ? row.locale : DEFAULT_LOCALE,
    dailyEnabled: row.dailyEnabled,
    dailyMinute: clampMinute(row.dailyMinute, d.dailyMinute),
    deadlineEnabled: row.deadlineEnabled,
    deadlineMinute: clampMinute(row.deadlineMinute, d.deadlineMinute),
    deadlineLeads: parseLeads(row.deadlineLeads, d.deadlineLeads),
    examLeads: parseLeads(row.examLeads, d.examLeads),
    streakEnabled: row.streakEnabled,
    quietEnabled: row.quietEnabled,
    quietStart: clampMinute(row.quietStart, d.quietStart),
    quietEnd: clampMinute(row.quietEnd, d.quietEnd),
  };
}

/** Preferences as the columns to store. */
export function toRow(prefs: NotificationPreferences): PreferenceRow {
  return {
    ...prefs,
    deadlineLeads: JSON.stringify(prefs.deadlineLeads),
    examLeads: JSON.stringify(prefs.examLeads),
  };
}

/** Apply a validated partial update. */
export function mergePreferences(
  current: NotificationPreferences,
  input: z.output<typeof preferencesInputSchema>,
): NotificationPreferences {
  const next: NotificationPreferences = { ...current };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  }
  next.timeZone = safeTimeZone(next.timeZone);
  next.locale = isLocale(next.locale) ? next.locale : current.locale;
  return next;
}

/** "HH:MM" for an <input type="time">. */
export function minuteToTime(minute: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes after midnight from "HH:MM" (null when it is not a time). */
export function timeToMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}
