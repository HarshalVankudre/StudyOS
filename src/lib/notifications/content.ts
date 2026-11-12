/**
 * The words of each notification, in the student's language, and where
 * tapping it goes. Pure: takes the dictionary, so it is tested without a
 * database. The student's own titles are never translated.
 *
 * Tone: say something useful (what, which course, when, how long), never
 * guilt. No exclamation marks, no "you missed", no counts of failures.
 */
import { createHash } from "node:crypto";
import { dirFor, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { plural } from "@/lib/i18n/plural";
import { formatDuration, itemTitle, planTotals } from "@/lib/agents/daily-study/present";
import type { DailyStudyPlanItem } from "@/lib/agents/daily-study/types";
import { workspaceHref, type WorkspaceLinkTarget } from "@/lib/workspace/deep-link";
import type { NotificationKind } from "./schedule";

export interface NotificationMessage {
  kind: NotificationKind | "test";
  title: string;
  body: string;
  /** Same-origin path the notification opens. */
  url: string;
  /** Replaces an earlier notification with the same tag on the device. */
  tag: string;
  lang: Locale;
  dir: "ltr" | "rtl";
}

/** A deadline or exam a reminder is about. */
export interface DeadlineReminder {
  /** De-duplication key: the row, its due day and the lead time. */
  key: string;
  title: string;
  /** Course, else the workspace's name. */
  context: string;
  dueDate: string;
  daysLeft: number;
  exam: boolean;
  effortMinutes: number | null;
  target: WorkspaceLinkTarget;
}

const MAX_TITLE = 120;
const MAX_BODY = 300;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function message(
  kind: NotificationMessage["kind"],
  locale: Locale,
  title: string,
  body: string,
  url: string,
  tag: string,
): NotificationMessage {
  return { kind, title: clip(title, MAX_TITLE), body: clip(body, MAX_BODY), url, tag, lang: locale, dir: dirFor(locale) };
}

/** "Fri 20 Nov" in the student's language. */
export function shortDay(day: string, locale: Locale): string {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** The daily "here is your plan" note, or null when nothing is open today. */
export function dailyPlanMessage(
  items: DailyStudyPlanItem[],
  localDate: string,
  dict: Dictionary,
  locale: Locale,
): NotificationMessage | null {
  const open = items.filter((item) => !item.completed);
  if (open.length === 0) return null;
  const first = open.find((item) => item.startHere) ?? open[0];
  const N = dict.notifications;
  const T = dict.today;
  const total = planTotals(open).minutes;
  const title = fmt(N.msgDailyTitle, { total: formatDuration(total, T) });
  const vars = { title: itemTitle(first, T), time: formatDuration(first.minutes, T), count: open.length - 1 };
  const body =
    open.length === 1 ? fmt(N.msgDailyBodyOne, vars) : plural(locale, N.msgDailyBodyOther, vars.count, vars);
  return message("daily", locale, title, body, workspaceHref(first.target), `daily-${localDate}`);
}

function deadlineTitle(r: DeadlineReminder, N: Dictionary["notifications"], locale: Locale): string {
  const vars = { title: r.title, count: r.daysLeft, day: shortDay(r.dueDate, locale) };
  if (r.exam) return r.daysLeft === 1 ? fmt(N.msgExamTomorrow, vars) : plural(locale, N.msgExamIn, r.daysLeft, vars);
  return r.daysLeft === 1 ? fmt(N.msgDueTomorrow, vars) : plural(locale, N.msgDueIn, r.daysLeft, vars);
}

export function deadlineMessage(r: DeadlineReminder, dict: Dictionary, locale: Locale): NotificationMessage {
  const N = dict.notifications;
  const parts = [
    r.context,
    !r.exam && r.effortMinutes ? fmt(N.msgEffort, { time: formatDuration(r.effortMinutes, dict.today) }) : "",
  ].filter(Boolean);
  const nudge = r.exam ? N.msgExamNudge : N.msgDeadlineNudge;
  const body = parts.length > 0 ? `${parts.join(" · ")}. ${nudge}` : nudge;
  return message("deadline", locale, deadlineTitle(r, N, locale), body, workspaceHref(r.target), `deadline-${tagHash(r.key)}`);
}

/** Several reminders due at once, in one notification. */
export function groupedDeadlineMessage(
  reminders: DeadlineReminder[],
  localDate: string,
  dict: Dictionary,
  locale: Locale,
): NotificationMessage {
  const N = dict.notifications;
  const shown = reminders.slice(0, 2).map((r) => fmt(N.msgGroupItem, { title: r.title, day: shortDay(r.dueDate, locale) }));
  const more = reminders.length - shown.length;
  const body = [shown.join(dict.today.listSeparator), more > 0 ? fmt(N.msgGroupMore, { count: more }) : ""]
    .filter(Boolean)
    .join(" ");
  return message(
    "deadline",
    locale,
    plural(locale, N.msgGroupTitle, reminders.length),
    body,
    "/app",
    `deadlines-${localDate}`,
  );
}

export function streakMessage(current: number, dict: Dictionary, locale: Locale): NotificationMessage {
  const N = dict.notifications;
  return message("streak", locale, fmt(N.msgStreakTitle, { count: current }), N.msgStreakBody, "/app", "streak");
}

export function testMessage(dict: Dictionary, locale: Locale): NotificationMessage {
  const N = dict.notifications;
  return message("test", locale, N.msgTestTitle, N.msgTestBody, "/app/settings#notifications", "test");
}

/**
 * Largest payload sent, in UTF-8 bytes. Push services cap the encrypted
 * request body at 4096 bytes, and encryption adds an 86-byte header and 17
 * bytes of tag and delimiter (webpush.ts), so 3,993 is the real ceiling; the
 * rest is margin.
 */
export const PUSH_PAYLOAD_BUDGET = 3_800;

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

/**
 * The JSON the service worker reads (public/sw.js), always within
 * PUSH_PAYLOAD_BUDGET. A deep link built from very long page or row ids
 * could push it over; then the notification opens the app's home ("/app")
 * instead, and as a last resort the text is shortened. Never throws, so an
 * oversized message can never count against the device as a rejection.
 */
export function pushPayload(m: NotificationMessage): string {
  const json = (url: string, title = m.title, body = m.body) =>
    JSON.stringify({ title, body, url, tag: m.tag.slice(0, 64), lang: m.lang, dir: m.dir });
  const full = json(m.url);
  if (bytes(full) <= PUSH_PAYLOAD_BUDGET) return full;
  const short = json("/app");
  if (bytes(short) <= PUSH_PAYLOAD_BUDGET) return short;
  // Titles and bodies are already clipped by character count; only a message
  // built outside `message()` could still be too long.
  return json("/app", clip(m.title, 60), clip(m.body, 120));
}

/** A short, stable, base64url Topic for the push service (<= 32 chars). */
export function topicFor(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 32);
}

function tagHash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
