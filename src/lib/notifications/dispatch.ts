/**
 * The notifications dispatch: run every few minutes by Cloud Scheduler
 * (POST /api/ops/notifications). Per student, in their time zone, it works out
 * what is due now, builds the words, and hands them to the channels.
 *
 * How it stays cheap: each student's preference row carries `nextCheckAt`,
 * the next moment anything could be due for them (at most three a day). A run
 * claims only rows whose moment has passed, through an index, in batches,
 * and moves `nextCheckAt` to the following moment. A tick where nobody is due
 * is one indexed query; a student's workspaces are loaded only at their own
 * moments (at most three times a day), never on every tick. Work is bounded
 * per run (users and time), and anything left is still due on the next tick.
 *
 * How nothing is sent twice: a run leases the students it claims (so two
 * overlapping runs never work on the same student), and every reminder is
 * claimed in the sent-log under a unique key BEFORE it is sent. A second run,
 * a retry or a crash can therefore only ever skip a reminder, never repeat it.
 *
 * How it never nags: nothing for done work, nothing in quiet hours, at most
 * DAILY_CAP notifications a local day (several deadlines at once become one
 * notification), and no reminder of anything that is not actually coming up.
 */
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { DailyStudyPlanItem } from "@/lib/agents/daily-study/types";
import { streakStatus } from "@/lib/study/streak";
import type { Workspace } from "@/lib/workspace/types";
import { reportError } from "@/lib/ops/report-error";
import {
  dailyPlanMessage,
  deadlineMessage,
  groupedDeadlineMessage,
  streakMessage,
  type NotificationMessage,
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
  /** Notifications shown (or being sent) on this local day. */
  countMessages(userId: string, localDate: string): Promise<number>;
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
}

export interface DeliveryResult {
  /** Devices / addresses that accepted the message. */
  delivered: number;
}

/**
 * A way to reach a student. Push is the one implemented (channels.ts); email
 * would be another implementation of this interface.
 */
export interface NotificationChannel {
  readonly name: string;
  /** Can this student be reached on this channel at all (a device, an address)? */
  reachable(userId: string): Promise<boolean>;
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
  /** Stop claiming new batches after this long (ms). */
  timeBudgetMs?: number;
  /** Students handled in parallel. */
  concurrency?: number;
  leaseMs?: number;
}

export interface DispatchResult {
  users: number;
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
  const result: DispatchResult = { users: 0, sent: 0, skipped: 0, failed: 0, errors: 0 };
  const started = Date.now();

  while (result.users < maxUsers && Date.now() - started < budget) {
    const at = now();
    const batch = await options.store.claimDueUsers(
      at,
      Math.min(batchSize, maxUsers - result.users),
      new Date(at.getTime() + leaseMs),
    );
    if (batch.length === 0) break;
    result.users += batch.length;
    await pool(batch, concurrency, (user) => processUser(user, options, now, result));
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

async function reachable(channels: NotificationChannel[], userId: string): Promise<boolean> {
  for (const channel of channels) {
    if (await channel.reachable(userId)) return true;
  }
  return false;
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
    if (!(await reachable(channels, userId))) {
      // No device left: nothing to schedule until the student turns one on.
      await store.release(userId, null);
      return;
    }
    next = nextSlotAfter(prefs, t);
    await handleDueSlots(user, options, t, result);
    if (!(await reachable(channels, userId))) next = null;
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

  const deliver = async (message: NotificationMessage): Promise<boolean> => {
    let delivered = 0;
    for (const channel of channels) {
      if (!(await channel.reachable(userId))) continue;
      delivered += (await channel.deliver(userId, message)).delivered;
    }
    return delivered > 0;
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

    // Streak: only when it would end tonight, and never in quiet hours.
    if (quiet || (await room()) <= 0) continue;
    const status = streakStatus(await store.studyDays(userId, today, timeZone), today);
    if (!status.atRisk || status.current < 2) continue;
    const id = await store.claim({ userId, dedupeKey: `streak:${today}`, kind: "streak", localDate: today, message: true });
    if (!id) continue;
    await sendClaimed([id], streakMessage(status.current, dict, locale));
  }
}
