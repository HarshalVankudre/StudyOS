/**
 * What the settings and the enable prompt do: read a student's notification
 * settings, save their choices, add and remove a device, turn email on and
 * off. Every function is scoped to the signed-in student's own rows (the
 * caller passes the Clerk user id), except `unsubscribeEmail`, which the
 * signed unsubscribe link calls, and `reseedNotificationSchedules`, which the
 * daily maintenance job runs. After any change the student's `nextCheckAt` is
 * recomputed so the dispatch looks at them at the right moment, or never when
 * neither a device nor email is on.
 *
 * Clerk is asked afresh (past the address book's memory) only when a student
 * turns email ON, and then at most every 30 s (lib/email/address).
 */
import "server-only";

import { prisma } from "@/lib/db";
import { emailAddresses, type AddressLookup } from "@/lib/email/address";
import { refusalApplies } from "@/lib/email/bounce";
import { emailConfigured } from "@/lib/email/config";
import { isLocale } from "@/lib/i18n/config";
import { pushConfigured, vapidPublicKey } from "./config";
import { endpointHash, type SubscriptionCheck } from "./endpoint";
import {
  DAILY_CAP,
  fromRow,
  mergePreferences,
  preferencesInputSchema,
  toRow,
  type NotificationPreferences,
  type PreferenceRow,
} from "./preferences";
import { nextSlotAfter, safeTimeZone } from "./schedule";

/** Devices kept per student; the oldest goes when a new one is added. */
export const MAX_DEVICES = 10;

/** The email switch as the settings section shows it. */
export interface EmailSettingsView {
  /** The student turned email on (it may still be stopped by a rejection). */
  enabled: boolean;
  /** The primary address on the student's account, read from Clerk (null: none, or not known right now). */
  address: string | null;
  /** Clerk has verified that address; email can only be turned on then. */
  verified: boolean;
  /** The mail server refused THIS address for good; email to it stopped until turned on again. */
  bounced: boolean;
  /** The address could not be looked up just now. */
  unavailable: boolean;
}

export interface NotificationSettingsView {
  /** Anything to show: push or email is set up on this server. */
  configured: boolean;
  /** The Web Push key; null when push is not set up. */
  publicKey: string | null;
  preferences: NotificationPreferences;
  /** Devices with notifications on (all of them, this one included). */
  devices: number;
  /** False when the Daily Study Agent is paused (no plan to send). */
  agentEnabled: boolean;
  dailyCap: number;
  /** Email reminders; null when email is not set up on this server. */
  email: EmailSettingsView | null;
}

type EmailRow = { emailEnabled: boolean; emailBouncedAt: Date | null; emailBouncedHash?: string | null } | null;

/**
 * Does the refusal on record stop email to the address the student has now?
 * Unknown (Clerk not reachable, no address): it still counts.
 */
function refusedNow(row: EmailRow, address: AddressLookup): boolean {
  if (!row?.emailBouncedAt) return false;
  return "email" in address ? refusalApplies(row.emailBouncedHash ?? null, address.email) : true;
}

function emailView(row: EmailRow, address: AddressLookup): EmailSettingsView {
  return {
    enabled: Boolean(row?.emailEnabled),
    address: "email" in address ? address.email : null,
    verified: address.kind === "verified",
    bounced: refusedNow(row, address),
    unavailable: address.kind === "unavailable",
  };
}

/**
 * A refusal of an address the student no longer has is lifted (and the
 * student put back on the schedule). Returns the row as it now is.
 */
async function liftStaleRefusal<T extends NonNullable<EmailRow>>(
  userId: string,
  row: T | null,
  address: AddressLookup,
): Promise<T | null> {
  if (!row?.emailBouncedAt || !("email" in address) || refusedNow(row, address)) return row;
  await prisma.notificationPreference.updateMany({
    where: { userId, emailBouncedAt: row.emailBouncedAt },
    data: { emailBouncedAt: null, emailBouncedHash: null },
  });
  await refreshNextCheck(userId);
  return { ...row, emailBouncedAt: null, emailBouncedHash: null };
}

/**
 * Email is on for this student and no refusal stopped it. Whether email is
 * configured right now does not matter: a short gap in the SMTP settings
 * must not drop email-only students from the schedule (the dispatch keeps
 * them waiting meanwhile, see channels.ts dispatchChannels).
 */
function emailActive(row: EmailRow): boolean {
  return Boolean(row?.emailEnabled && !row.emailBouncedAt);
}

export async function getNotificationSettings(userId: string): Promise<NotificationSettingsView> {
  const push = pushConfigured();
  const email = emailConfigured();
  if (!push && !email) {
    return {
      configured: false,
      publicKey: null,
      preferences: fromRow(null),
      devices: 0,
      agentEnabled: true,
      dailyCap: DAILY_CAP,
      email: null,
    };
  }
  // The address from the address book's memory: a short one (half a minute
  // for an unverified address), so a student who has just verified theirs
  // sees it on a reload soon after, without the settings page asking Clerk
  // afresh on every visit.
  const [stored, devices, agent, address] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { userId } }),
    push ? prisma.pushSubscription.count({ where: { userId } }) : 0,
    prisma.dailyStudyAgentConfig.findUnique({ where: { userId }, select: { enabled: true } }),
    email ? emailAddresses.lookup(userId) : null,
  ]);
  const row = address ? await liftStaleRefusal(userId, stored, address) : stored;
  return {
    configured: true,
    publicKey: push ? vapidPublicKey() : null,
    preferences: fromRow(row),
    devices,
    agentEnabled: agent?.enabled ?? true,
    dailyCap: DAILY_CAP,
    email: address ? emailView(row, address) : null,
  };
}

/** Recompute when the dispatch should next look at this student. */
export async function refreshNextCheck(userId: string, now = new Date()): Promise<void> {
  const [row, devices] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { userId } }),
    prisma.pushSubscription.count({ where: { userId } }),
  ]);
  if (!row) return;
  const next = devices > 0 || emailActive(row) ? nextSlotAfter(fromRow(row), now) : null;
  await prisma.notificationPreference.update({ where: { userId }, data: { nextCheckAt: next } });
}

/** Rows looked at per page, and pages per run at most, of the re-seed. */
const RESEED_PAGE = 500;
const RESEED_MAX_PAGES = 40;

/**
 * Daily (maintenance job): put back on the schedule every student who has
 * no `nextCheckAt` although a device is on or email is on (with no refusal on
 * record): one a dispatch dropped while a channel was briefly not configured
 * or Clerk briefly had no address, or whose release failed. Only an empty
 * `nextCheckAt` is filled in (a concurrent change wins). A student with every
 * reminder off has no next moment and stays as they are. Returns how many
 * were put back.
 */
export async function reseedNotificationSchedules(now = new Date()): Promise<number> {
  let reseeded = 0;
  let after = "";
  for (let page = 0; page < RESEED_MAX_PAGES; page++) {
    const rows = await prisma.$queryRaw<(PreferenceRow & { userId: string })[]>`
      SELECT p."userId", p."timeZone", p."locale", p."dailyEnabled", p."dailyMinute",
        p."deadlineEnabled", p."deadlineMinute", p."deadlineLeads", p."examLeads",
        p."streakEnabled", p."weeklyEnabled", p."weeklyDay", p."weeklyMinute",
        p."quietEnabled", p."quietStart", p."quietEnd"
      FROM "NotificationPreference" AS p
      WHERE p."nextCheckAt" IS NULL
        AND p."userId" > ${after}
        AND (
          (p."emailEnabled" AND p."emailBouncedAt" IS NULL)
          OR EXISTS (SELECT 1 FROM "PushSubscription" AS s WHERE s."userId" = p."userId")
        )
      ORDER BY p."userId" ASC
      LIMIT ${RESEED_PAGE}`;
    for (const row of rows) {
      const next = nextSlotAfter(fromRow(row), now);
      if (!next) continue;
      const result = await prisma.notificationPreference.updateMany({
        where: { userId: row.userId, nextCheckAt: null },
        data: { nextCheckAt: next },
      });
      reseeded += result.count;
    }
    if (rows.length < RESEED_PAGE) break;
    after = rows[rows.length - 1].userId;
  }
  return reseeded;
}

export type EmailSwitchResult =
  | { ok: true; email: EmailSettingsView }
  | { ok: false; reason: "not_configured" | "no_address" | "unverified" | "unavailable" };

/**
 * Turn email reminders on or off. On needs a verified primary address (asked
 * of Clerk afresh, as the student may have just verified it) and clears an
 * earlier rejection: the student says the address works again. The browser's
 * time zone and language come along, as when a device is turned on, so a
 * student without any device gets reminders at their own hours. Off never
 * asks Clerk afresh (the address shown comes from memory when it is there).
 */
export async function setEmailReminders(
  userId: string,
  enabled: boolean,
  context: { timeZone?: string; locale?: string } = {},
): Promise<EmailSwitchResult> {
  if (!emailConfigured()) return { ok: false, reason: "not_configured" };
  const address = await emailAddresses.lookup(userId, enabled ? { fresh: true } : {});
  if (enabled) {
    if (address.kind === "missing") return { ok: false, reason: "no_address" };
    if (address.kind === "unverified") return { ok: false, reason: "unverified" };
    if (address.kind === "unavailable") return { ok: false, reason: "unavailable" };
    const timeZone = context.timeZone ? safeTimeZone(context.timeZone) : undefined;
    const locale = isLocale(context.locale) ? context.locale : undefined;
    const here = { ...(timeZone ? { timeZone } : {}), ...(locale ? { locale } : {}) };
    await prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...toRow(fromRow(null)), ...here, emailEnabled: true },
      update: { ...here, emailEnabled: true, emailBouncedAt: null, emailBouncedHash: null },
    });
  } else {
    // Turning off always works, whatever Clerk says.
    await prisma.notificationPreference.updateMany({ where: { userId }, data: { emailEnabled: false } });
  }
  await refreshNextCheck(userId);
  const row = await prisma.notificationPreference.findUnique({
    where: { userId },
    select: { emailEnabled: true, emailBouncedAt: true, emailBouncedHash: true },
  });
  return { ok: true, email: emailView(row, address) };
}

/**
 * The unsubscribe link: email off for this student (true when it was on).
 * Works whether or not email is still configured, and leaves push alone.
 */
export async function unsubscribeEmail(userId: string): Promise<boolean> {
  const result = await prisma.notificationPreference.updateMany({
    where: { userId, emailEnabled: true },
    data: { emailEnabled: false },
  });
  if (result.count > 0) await refreshNextCheck(userId);
  return result.count > 0;
}

export type SaveResult = { ok: true; preferences: NotificationPreferences } | { ok: false };

export async function saveNotificationPreferences(userId: string, input: unknown): Promise<SaveResult> {
  const parsed = preferencesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const row = await prisma.notificationPreference.findUnique({ where: { userId } });
  const next = mergePreferences(fromRow(row), parsed.data);
  const data = toRow(next);
  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await refreshNextCheck(userId);
  return { ok: true, preferences: next };
}

/**
 * "added": the device is on for this student. "taken": the endpoint belongs
 * to another student's device record; the browser must make a fresh
 * subscription (a new endpoint, see push-client) before it can be added.
 * "unknown": a refresh for a device the student does not have on (turned
 * off here or from another device); nothing was stored.
 */
export type AddSubscriptionResult = "added" | "taken" | "unknown";

/**
 * `refreshOnly`: the browser is keeping a device current (push-client
 * syncPush), not turning one on, so an endpoint the student has no record of
 * is never added: "Turn off on all devices" must not be undone by another
 * device that still holds its browser subscription. `replaces` is the
 * endpoint the browser just swapped out (a new server key), whose record
 * moves to the new endpoint.
 */
export interface AddSubscriptionOptions {
  refreshOnly?: boolean;
  replaces?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

export async function addPushSubscription(
  userId: string,
  subscription: Extract<SubscriptionCheck, { ok: true }>,
  context: { timeZone?: string; locale?: string; label: string },
  options: AddSubscriptionOptions = {},
): Promise<AddSubscriptionResult> {
  const hash = endpointHash(subscription.endpoint);
  const keys = { p256dh: subscription.p256dh, auth: subscription.auth };
  // An endpoint is never moved from one student to another. Presenting an
  // endpoint proves nothing about who owns the device (it could be copied),
  // and a reassignment would silently stop the first student's reminders and
  // send the second student's titles to the first student's lock screen.
  // The browser proves it is the device by subscribing afresh, which yields
  // an endpoint nobody has stored. The old record then dies on its own: the
  // push service answers 404/410 for the unsubscribed endpoint and the
  // channel deletes it.
  const updated = await prisma.pushSubscription.updateMany({
    where: { endpointHash: hash, userId },
    data: { ...keys, label: context.label, failures: 0 },
  });
  if (updated.count === 0 && options.refreshOnly) {
    if (!options.replaces) return "unknown";
    try {
      const moved = await prisma.pushSubscription.updateMany({
        where: { endpointHash: endpointHash(options.replaces), userId },
        data: { endpoint: subscription.endpoint, endpointHash: hash, ...keys, label: context.label, failures: 0 },
      });
      if (moved.count === 0) return "unknown";
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The new endpoint is stored already: fine if it is this student's own.
      const owner = await prisma.pushSubscription.findUnique({ where: { endpointHash: hash }, select: { userId: true } });
      if (owner?.userId !== userId) return "taken";
    }
  } else if (updated.count === 0) {
    try {
      await prisma.pushSubscription.create({
        data: { userId, endpoint: subscription.endpoint, endpointHash: hash, ...keys, label: context.label },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost a race: fine if the winner was this student's own other request.
      const owner = await prisma.pushSubscription.findUnique({ where: { endpointHash: hash }, select: { userId: true } });
      if (owner?.userId !== userId) return "taken";
    }
  }

  const extra = await prisma.pushSubscription.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    skip: MAX_DEVICES,
    select: { id: true },
  });
  if (extra.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { userId, id: { in: extra.map((s) => s.id) } } });
  }

  // The device knows the student's time zone and language best.
  const timeZone = context.timeZone ? safeTimeZone(context.timeZone) : undefined;
  const locale = isLocale(context.locale) ? context.locale : undefined;
  const defaults = toRow(fromRow(null));
  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...defaults, ...(timeZone ? { timeZone } : {}), ...(locale ? { locale } : {}) },
    update: { ...(timeZone ? { timeZone } : {}), ...(locale ? { locale } : {}) },
  });
  await refreshNextCheck(userId);
  return "added";
}

/** Turn off one device (by its endpoint) or every device of the student. */
export async function removePushSubscriptions(
  userId: string,
  target: { endpoint: string } | { all: true },
): Promise<number> {
  const where =
    "all" in target ? { userId } : { userId, endpointHash: endpointHash(target.endpoint) };
  const result = await prisma.pushSubscription.deleteMany({ where });
  await refreshNextCheck(userId);
  return result.count;
}

/** Is this endpoint (this browser) one of the student's devices? */
export async function hasPushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const row = await prisma.pushSubscription.findFirst({
    where: { userId, endpointHash: endpointHash(endpoint) },
    select: { id: true },
  });
  return Boolean(row);
}
