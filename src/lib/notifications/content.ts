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
  const body = fmt(open.length === 1 ? N.msgDailyBodyOne : N.msgDailyBodyOther, vars);
  return message("daily", locale, title, body, workspaceHref(first.target), `daily-${localDate}`);
}

function deadlineTitle(r: DeadlineReminder, N: Dictionary["notifications"], locale: Locale): string {
  const vars = { title: r.title, count: r.daysLeft, day: shortDay(r.dueDate, locale) };
  if (r.exam) return fmt(r.daysLeft === 1 ? N.msgExamTomorrow : N.msgExamIn, vars);
  return fmt(r.daysLeft === 1 ? N.msgDueTomorrow : N.msgDueIn, vars);
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
    fmt(N.msgGroupTitle, { count: reminders.length }),
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

/** The JSON the service worker reads (public/sw.js). */
export function pushPayload(m: NotificationMessage): string {
  return JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag, lang: m.lang, dir: m.dir });
}

/** A short, stable, base64url Topic for the push service (<= 32 chars). */
export function topicFor(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 32);
}

function tagHash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
