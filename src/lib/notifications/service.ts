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

export async function addPushSubscription(
  userId: string,
  subscription: Extract<SubscriptionCheck, { ok: true }>,
  context: { timeZone?: string; locale?: string; label: string },
): Promise<void> {
  const hash = endpointHash(subscription.endpoint);
  const keys = { p256dh: subscription.p256dh, auth: subscription.auth };
  // The same browser signed in as someone else now belongs to this student.
  await prisma.pushSubscription.upsert({
    where: { endpointHash: hash },
    create: { userId, endpoint: subscription.endpoint, endpointHash: hash, ...keys, label: context.label },
    update: { userId, ...keys, label: context.label, failures: 0 },
  });

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
