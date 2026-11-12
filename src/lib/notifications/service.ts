/**
 * What the settings and the enable prompt do: read a student's notification
 * settings, save their choices, add and remove a device. Every function is
 * scoped to the signed-in student's own rows (the caller passes the Clerk
 * user id). After any change the student's `nextCheckAt` is recomputed so the
 * dispatch looks at them at the right moment, or never when no device is on.
 */
import "server-only";

import { prisma } from "@/lib/db";
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
} from "./preferences";
import { nextSlotAfter, safeTimeZone } from "./schedule";

/** Devices kept per student; the oldest goes when a new one is added. */
export const MAX_DEVICES = 10;

export interface NotificationSettingsView {
  configured: boolean;
  publicKey: string | null;
  preferences: NotificationPreferences;
  /** Devices with notifications on (all of them, this one included). */
  devices: number;
  /** False when the Daily Study Agent is paused (no plan to send). */
  agentEnabled: boolean;
  dailyCap: number;
}

export async function getNotificationSettings(userId: string): Promise<NotificationSettingsView> {
  const configured = pushConfigured();
  if (!configured) {
    return {
      configured,
      publicKey: null,
      preferences: fromRow(null),
      devices: 0,
      agentEnabled: true,
      dailyCap: DAILY_CAP,
    };
  }
  const [row, devices, agent] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { userId } }),
    prisma.pushSubscription.count({ where: { userId } }),
    prisma.dailyStudyAgentConfig.findUnique({ where: { userId }, select: { enabled: true } }),
  ]);
  return {
    configured,
    publicKey: vapidPublicKey(),
    preferences: fromRow(row),
    devices,
    agentEnabled: agent?.enabled ?? true,
    dailyCap: DAILY_CAP,
  };
}

/** Recompute when the dispatch should next look at this student. */
export async function refreshNextCheck(userId: string, now = new Date()): Promise<void> {
  const [row, devices] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { userId } }),
    prisma.pushSubscription.count({ where: { userId } }),
  ]);
  if (!row) return;
  const next = devices > 0 ? nextSlotAfter(fromRow(row), now) : null;
  await prisma.notificationPreference.update({ where: { userId }, data: { nextCheckAt: next } });
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
 */
export type AddSubscriptionResult = "added" | "taken";

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

export async function addPushSubscription(
  userId: string,
  subscription: Extract<SubscriptionCheck, { ok: true }>,
  context: { timeZone?: string; locale?: string; label: string },
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
  if (updated.count === 0) {
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
