/**
 * The notifications dispatch: run every few minutes by Cloud Scheduler
 * (POST /api/ops/notifications). Per student, in their time zone, it works out
 * what is due now, builds the words, and hands them to the channels.
 *
 * How it stays cheap: each student's preference row carries `nextCheckAt`,
 * the next moment anything could be due for them (at most three a day, plus
 * the weekly recap on its day). A run claims only rows whose moment has
 * passed, through an index, in batches,
 * and moves `nextCheckAt` to the following moment. A tick where nobody is due
 * is one indexed query; a student's workspaces are loaded only at their own
 * moments (at most three times a day), never on every tick. Work is bounded
 * per run (users and time), and anything left is still due on the next tick.
 *
 * Time. A run starts no new student after `timeBudgetMs` (45 s): the check
 * is made before EACH student, not per batch, and students claimed but not
 * started by then are handed back as they were (lease ended, `nextCheckAt`
 * untouched), so the next tick takes them. A student started just before the
 * deadline still finishes: an address lookup (5 s at most, lib/email/address)
 * and at most DAILY_CAP messages, each by push and email at once, an email
 * waiting at most 15 s for its turn and 15 s to send (lib/email/mailer), a
 * push 10 s (webpush.ts): about 5 + 3 x 30 = 95 s. The worst run is thus
 * about 45 + 95 = 140 s, well inside the 5-minute lease (`leaseMs`), so a
 * lease never runs out on a student still being worked on.
 *
 * How nothing is sent twice: a run leases the students it claims (so two
 * overlapping runs never work on the same student), and every reminder is
 * claimed in the sent-log under a unique key BEFORE it is sent. A second run,
 * a retry or a crash can therefore only ever skip a reminder, never repeat it.
 *
 * How it never nags: nothing for done work, nothing in quiet hours, at most
 * DAILY_CAP notifications a local day (several deadlines at once become one
 * notification), and no reminder of anything that is not actually coming up.
 *
 * The weekly recap (opt-in) is claimed under the student's local day, like
 * the daily note, and is also held back when one was shown in the six days
 * before (so moving the recap day never brings two in one week). A week
 * without any study gets no recap: it is logged as skipped.
 *
 * Several channels (push, email): a reminder is claimed ONCE, before any
 * channel is tried, and then handed to every channel that can reach the
 * student. Its one log row is "sent" when at least one channel accepted it
 * and "failed" when none did. The daily cap and the weekly limit count log
 * rows, so a reminder that went out by push AND by email counts once. Each
 * channel is tried on its own: one that fails or throws never keeps the
 * reminder from the others. A student no channel can reach right now leaves
 * the schedule, unless a channel is only waiting (`standby`): Clerk could not
 * be asked for the address (look again in a few minutes, the reminder is
 * still due then), the address is not verified yet, or email is briefly not
 * configured on the server (keep the schedule; channels.ts dispatchChannels).
 * Anyone dropped all the same is put back by the daily maintenance job
 * (service.ts reseedNotificationSchedules).
 */
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { DailyStudyPlanItem } from "@/lib/agents/daily-study/types";
import { streakStatus } from "@/lib/study/streak";
import type { Workspace } from "@/lib/workspace/types";
import { addDays } from "@/lib/workspace/view-logic";
import { reportError } from "@/lib/ops/report-error";
import {
  dailyPlanMessage,
  deadlineMessage,
  groupedDeadlineMessage,
  streakMessage,
  weeklyRecapMessage,
  type NotificationMessage,
  type WeeklyRecap,
} from "./content";
import { DAILY_CAP, type NotificationPreferences } from "./preferences";
import { deadlineRemindersFor } from "./reminders";
import { dueSlots, inQuietHours, localClock, nextSlotAfter, safeTimeZone, type NotificationKind } from "./schedule";

export interface DueUser {
  userId: string;
  prefs: NotificationPreferences;
}

export type LogStatus = "pending" | "sent" | "failed" | "skipped";

export interface LogClaim {
  userId: string;
  dedupeKey: string;
  kind: NotificationKind;
  localDate: string;
  message: boolean;
}

/** Everything the dispatch reads and writes. Prisma in production (store.ts). */
export interface NotificationStore {
  /** Lease up to `limit` students whose `nextCheckAt` has passed (and who are not leased). */
  claimDueUsers(now: Date, limit: number, leaseUntil: Date): Promise<DueUser[]>;
  /** End the lease and set the next moment to look at this student (null = never). */
  release(userId: string, nextCheckAt: Date | null): Promise<void>;
  /** End the lease of students claimed but not handled, leaving `nextCheckAt` as it is (still due). */
  unlease(userIds: string[]): Promise<void>;
  /** Notifications shown (or being sent) on this local day. */
  countMessages(userId: string, localDate: string): Promise<number>;
  /** Notifications of `kind` shown (or being sent) on local day `fromLocalDate` or later. */
  countShownSince(userId: string, kind: NotificationKind, fromLocalDate: string): Promise<number>;
  /** Claim a reminder; the log row id, or null when it was claimed before. */
  claim(entry: LogClaim): Promise<string | null>;
  finish(id: string, status: LogStatus, message: boolean, at: Date): Promise<void>;
  loadWorkspaces(userId: string): Promise<Workspace[]>;
  /** Today's plan (built and stored when there is none yet); null when the agent is off. */
  todayPlan(
    userId: string,
    localDate: string,
    timeZone: string,
    workspaces: Workspace[],
    now: Date,
  ): Promise<DailyStudyPlanItem[] | null>;
  /** Local days the student studied on (for the streak). */
  studyDays(userId: string, today: string, timeZone: string): Promise<string[]>;
  /** The student's totals for the 7 local days ending on `today` (the weekly recap). */
  weekTotals(userId: string, today: string): Promise<WeeklyRecap>;
}

export interface DeliveryResult {
  /** Devices / addresses that accepted the message. */
  delivered: number;
}

/**
 * A way to reach a student: push (channels.ts) and email (email-channel.ts).
 */
export interface NotificationChannel {
  readonly name: string;
  /** Can this student be reached on this channel at all (a device, an address)? */
  reachable(userId: string): Promise<boolean>;
  /**
   * Optional, asked only when no channel can reach the student: the student
   * turned this channel on, but it cannot deliver right now. "retry": a
   * passing failure (look again in a few minutes); "wait": waiting on the
   * student, e.g. an address not verified yet (keep their schedule). Null, or
   * no method: the channel is off for this student.
   */
  standby?(userId: string): Promise<"retry" | "wait" | null>;
  deliver(userId: string, message: NotificationMessage): Promise<DeliveryResult>;
}

export interface DispatchOptions {
  store: NotificationStore;
  channels: NotificationChannel[];
  now?: () => Date;
  /** Students claimed per query. */
  batchSize?: number;
  /** Students handled per run at most. */
  maxUsers?: number;
  /** Start no new student after this long (ms); the rest are handed back still due. */
  timeBudgetMs?: number;
  /** The clock the time budget is measured on (ms); tests drive it. */
  clock?: () => number;
  /** Students handled in parallel. */
  concurrency?: number;
  leaseMs?: number;
}

export interface DispatchResult {
  /** Students handled. */
  users: number;
  /** Students claimed but handed back unhandled (the run's time was up); still due. */
  deferred: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: number;
}

const RETRY_AFTER_ERROR_MS = 5 * 60 * 1000;

export async function runNotificationDispatch(options: DispatchOptions): Promise<DispatchResult> {
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? 100;
  const maxUsers = options.maxUsers ?? 2_000;
  const budget = options.timeBudgetMs ?? 45_000;
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const leaseMs = options.leaseMs ?? 5 * 60 * 1000;
  const clock = options.clock ?? Date.now;
  const result: DispatchResult = { users: 0, deferred: 0, sent: 0, skipped: 0, failed: 0, errors: 0 };
  const started = clock();
  const timeLeft = () => clock() - started < budget;
  let claimed = 0;

  while (claimed < maxUsers && timeLeft()) {
    const at = now();
    const batch = await options.store.claimDueUsers(
      at,
      Math.min(batchSize, maxUsers - claimed),
      new Date(at.getTime() + leaseMs),
    );
    if (batch.length === 0) break;
    claimed += batch.length;
    const left: string[] = [];
    await pool(batch, concurrency, async (user) => {
      // Checked per student: a slow student (a stalling mail server) must not
      // keep the run going through the rest of the batch.
      if (!timeLeft()) {
        left.push(user.userId);
        return;
      }
      result.users += 1;
      await processUser(user, options, now, result);
    });
    if (left.length > 0) {
      result.deferred += left.length;
      await options.store.unlease(left).catch((error) => {
        // The lease then simply runs out; the students are still due.
        result.errors += 1;
        reportError(error, { source: "notifications.release" });
      });
      break;
    }
    if (batch.length < batchSize) break;
  }
  return result;
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await run(item);
    }
  });
  await Promise.all(workers);
}

type Reach = "now" | "retry" | "wait" | "off";

/**
 * Can any channel reach the student now; if not, is one only waiting? A
 * channel that throws counts as a passing failure and never hides the others.
 */
async function reachability(channels: NotificationChannel[], userId: string): Promise<Reach> {
  let failed = false;
  for (const channel of channels) {
    try {
      if (await channel.reachable(userId)) return "now";
    } catch (error) {
      failed = true;
      reportError(error, { source: `notifications.${channel.name}`, userId });
    }
  }
  let reach: Reach = failed ? "retry" : "off";
  for (const channel of channels) {
    if (reach === "retry") break;
    try {
      const waiting = (await channel.standby?.(userId)) ?? null;
      if (waiting === "retry") reach = "retry";
      else if (waiting === "wait") reach = "wait";
    } catch (error) {
      reach = "retry";
      reportError(error, { source: `notifications.${channel.name}`, userId });
    }
  }
  return reach;
}

/** When to look at a student no channel can reach right now (null = not until they change a setting). */
function standbyNext(reach: Exclude<Reach, "now">, prefs: NotificationPreferences, t: Date): Date | null {
  if (reach === "off") return null;
  const next = nextSlotAfter(prefs, t);
  if (reach === "wait") return next;
  const retry = new Date(t.getTime() + RETRY_AFTER_ERROR_MS);
  return next && next < retry ? next : retry;
}

async function processUser(
  user: DueUser,
  options: DispatchOptions,
  now: () => Date,
  result: DispatchResult,
): Promise<void> {
  const { store, channels } = options;
  const { userId, prefs } = user;
  const t = now();
  let next: Date | null = null;
  try {
    const before = await reachability(channels, userId);
    if (before !== "now") {
      // No device or address: nothing to schedule until the student turns one
      // on, unless a channel is only waiting (see standby).
      await store.release(userId, standbyNext(before, prefs, t));
      return;
    }
    next = nextSlotAfter(prefs, t);
    await handleDueSlots(user, options, t, result);
    const after = await reachability(channels, userId);
    if (after !== "now") next = standbyNext(after, prefs, t);
  } catch (error) {
    result.errors += 1;
    reportError(error, { source: "notifications.dispatch", userId });
    // Look again soon: the sent-log keeps a retry from repeating anything.
    const retry = new Date(t.getTime() + RETRY_AFTER_ERROR_MS);
    next = next && next < retry ? next : retry;
  }
  await store.release(userId, next).catch((error) => {
    result.errors += 1;
    reportError(error, { source: "notifications.release", userId });
  });
}

async function handleDueSlots(
  user: DueUser,
  options: DispatchOptions,
  t: Date,
  result: DispatchResult,
): Promise<void> {
  const { store, channels } = options;
  const { userId, prefs } = user;
  const slots = dueSlots(prefs, t);
  if (slots.length === 0) return;

  const timeZone = safeTimeZone(prefs.timeZone);
  const clock = localClock(t, timeZone);
  const today = clock.date;
  const dict = getDictionary(prefs.locale);
  const locale = prefs.locale;
  const quiet = inQuietHours(clock.minute, prefs);

  let workspaces: Workspace[] | null = null;
  const loadWorkspaces = async () => (workspaces ??= await store.loadWorkspaces(userId));
  const room = async () => DAILY_CAP - (await store.countMessages(userId, today));

  // Every channel that can reach the student, all at once and each on its
  // own: one failing, throwing or slow (a stalling mail server) never keeps
  // the message from another, nor delays it.
  const deliver = async (message: NotificationMessage): Promise<boolean> => {
    const counts = await Promise.all(
      channels.map(async (channel) => {
        try {
          if (!(await channel.reachable(userId))) return 0;
          return (await channel.deliver(userId, message)).delivered;
        } catch (error) {
          reportError(error, { source: `notifications.${channel.name}`, userId });
          return 0;
        }
      }),
    );
    return counts.some((n) => n > 0);
  };

  const sendClaimed = async (ids: string[], message: NotificationMessage) => {
    const ok = await deliver(message);
    const at = new Date();
    await Promise.all(ids.map((id, i) => store.finish(id, ok ? "sent" : "failed", i === 0, at)));
    if (ok) result.sent += 1;
    else result.failed += 1;
  };

  const skip = async (id: string) => {
    await store.finish(id, "skipped", false, new Date());
    result.skipped += 1;
  };

  for (const slot of slots) {
    if (slot.kind === "daily") {
      if ((await room()) <= 0) continue;
      const id = await store.claim({ userId, dedupeKey: `daily:${today}`, kind: "daily", localDate: today, message: true });
      if (!id) continue;
      if (quiet) {
        await skip(id);
        continue;
      }
      const items = await store.todayPlan(userId, today, timeZone, await loadWorkspaces(), t);
      const message = items ? dailyPlanMessage(items, today, dict, locale) : null;
      if (!message) await skip(id);
      else await sendClaimed([id], message);
      continue;
    }

    if (slot.kind === "deadline") {
      if (quiet) continue;
      const reminders = deadlineRemindersFor(await loadWorkspaces(), today, prefs);
      if (reminders.length === 0) continue;
      const left = await room();
      if (left <= 0) continue;
      const claimed: { id: string; reminder: (typeof reminders)[number] }[] = [];
      for (const reminder of reminders) {
        const id = await store.claim({ userId, dedupeKey: reminder.key, kind: "deadline", localDate: today, message: false });
        if (id) claimed.push({ id, reminder });
      }
      if (claimed.length === 0) continue;
      if (claimed.length <= Math.min(2, left)) {
        for (const { id, reminder } of claimed) await sendClaimed([id], deadlineMessage(reminder, dict, locale));
      } else {
        const message = groupedDeadlineMessage(claimed.map((c) => c.reminder), today, dict, locale);
        await sendClaimed(claimed.map((c) => c.id), message);
      }
      continue;
    }

    if (slot.kind === "weekly") {
      if ((await room()) <= 0) continue;
      // Once a week at most, even when the student moved their recap day.
      if ((await store.countShownSince(userId, "weekly", addDays(today, -6))) > 0) continue;
      const id = await store.claim({ userId, dedupeKey: `weekly:${today}`, kind: "weekly", localDate: today, message: true });
      if (!id) continue;
      if (quiet) {
        await skip(id);
        continue;
      }
      const message = weeklyRecapMessage(await store.weekTotals(userId, today), today, dict, locale);
      if (!message) await skip(id);
      else await sendClaimed([id], message);
      continue;
    }

    // Streak: only when it would end tonight, and never in quiet hours.
    if (quiet || (await room()) <= 0) continue;
    const status = streakStatus(await store.studyDays(userId, today, timeZone), today);
    if (!status.atRisk || status.current < 2) continue;
    const id = await store.claim({ userId, dedupeKey: `streak:${today}`, kind: "streak", localDate: today, message: true });
    if (!id) continue;
    await sendClaimed([id], streakMessage(status.current, dict, locale));
  }
}
