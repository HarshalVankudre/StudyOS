/**
 * Notification channels. A channel is a small interface (NotificationChannel
 * in dispatch.ts): "can this student be reached here?" and "deliver this".
 *
 * PUSH (implemented): Web Push to every device the student turned on. A
 * subscription the push service reports gone (404/410) is deleted at once;
 * one that keeps being rejected (a key mismatch after a VAPID key change, a
 * malformed record) is deleted after MAX_REJECTIONS in a row; temporary
 * failures (429, 5xx, network) are left alone.
 *
 * EMAIL (not implemented; the seam): the owner has no mail provider account
 * yet. An email channel is one more NotificationChannel:
 *   - reachable(userId): the student opted in to email AND has a verified
 *     address (from Clerk, `currentUser().emailAddresses`, fetched server-side
 *     with the Clerk backend SDK since the dispatch has no session);
 *   - deliver(userId, message): send `message.title` / `message.body` plus an
 *     absolute link (APP_URL + message.url), with a one-click unsubscribe
 *     (RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post` headers pointing
 *     at a signed, unauthenticated opt-out route), through the provider.
 * It also needs: an "Email" switch in the settings section (and a column on
 * NotificationPreference), bounce/complaint handling to stop sending to dead
 * or complaining addresses, and SPF/DKIM/DMARC on the sending domain. Plain
 * SMTP would avoid choosing a vendor, but it still needs a client library
 * (nodemailer) or a hand-written SMTP/STARTTLS client, and the unsubscribe
 * and bounce parts are provider-specific, so it was left for when the
 * provider is chosen. Register the new channel in `defaultChannels()`.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/ops/report-error";
import { pushConfigured, vapidConfig } from "./config";
import { pushPayload, topicFor, type NotificationMessage } from "./content";
import type { DeliveryResult, NotificationChannel } from "./dispatch";
import { isAllowedPushEndpoint } from "./endpoint";
import { sendWebPush, type PushOutcome, type VapidKeys } from "./webpush";

/** Rejections in a row (not "gone") before a subscription is dropped. */
export const MAX_REJECTIONS = 3;
/** How long a push service may hold a message for an offline device. */
const TTL_SECONDS: Record<NotificationMessage["kind"], number> = {
  daily: 4 * 60 * 60,
  deadline: 12 * 60 * 60,
  streak: 2 * 60 * 60,
  test: 10 * 60,
};

export interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Where the push channel reads and updates subscriptions. */
export interface SubscriptionStore {
  list(userId: string): Promise<StoredSubscription[]>;
  count(userId: string): Promise<number>;
  remove(id: string): Promise<void>;
  succeeded(id: string, at: Date): Promise<void>;
  /** Count a rejection; returns the rejections in a row so far. */
  rejected(id: string): Promise<number>;
}

export type PushSender = (
  subscription: StoredSubscription,
  payload: string,
  vapid: VapidKeys,
  options: { ttlSeconds: number; topic: string; urgency: "normal" | "low" },
) => Promise<PushOutcome>;

export interface PushChannelOptions {
  subscriptions: SubscriptionStore;
  vapid: VapidKeys;
  send?: PushSender;
  /** Tests point the sender at a local fake push service. */
  allowEndpoint?: (endpoint: string) => boolean;
  now?: () => Date;
}

export function createPushChannel(options: PushChannelOptions): NotificationChannel {
  const send: PushSender = options.send ?? ((sub, payload, vapid, o) => sendWebPush(sub, payload, vapid, o));
  const allow = options.allowEndpoint ?? isAllowedPushEndpoint;
  const now = options.now ?? (() => new Date());
  const { subscriptions } = options;

  return {
    name: "push",
    async reachable(userId) {
      return (await subscriptions.count(userId)) > 0;
    },
    async deliver(userId, message): Promise<DeliveryResult> {
      const subs = await subscriptions.list(userId);
      const payload = pushPayload(message);
      let delivered = 0;
      await Promise.all(
        subs.map(async (sub) => {
          if (!allow(sub.endpoint)) {
            // Stored before the allowlist, or tampered with: never contact it.
            await subscriptions.remove(sub.id);
            return;
          }
          const outcome = await send(sub, payload, options.vapid, {
            ttlSeconds: TTL_SECONDS[message.kind],
            topic: topicFor(message.tag),
            urgency: message.kind === "streak" ? "low" : "normal",
          });
          if (outcome.kind === "sent") {
            delivered += 1;
            await subscriptions.succeeded(sub.id, now());
          } else if (outcome.kind === "gone") {
            await subscriptions.remove(sub.id);
          } else if (outcome.kind === "rejected") {
            const count = await subscriptions.rejected(sub.id);
            if (count >= MAX_REJECTIONS) await subscriptions.remove(sub.id);
            // Status only: the endpoint is a credential and is never logged.
            reportError(new Error(`push rejected with status ${outcome.status}`), {
              source: "notifications.push",
              userId,
              status: outcome.status,
            });
          }
        }),
      );
      return { delivered };
    },
  };
}

export const prismaSubscriptionStore: SubscriptionStore = {
  list: (userId) =>
    prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  count: (userId) => prisma.pushSubscription.count({ where: { userId } }),
  remove: async (id) => {
    await prisma.pushSubscription.deleteMany({ where: { id } });
  },
  succeeded: async (id, at) => {
    await prisma.pushSubscription.updateMany({ where: { id }, data: { failures: 0, lastSuccessAt: at } });
  },
  rejected: async (id) => {
    const rows = await prisma.pushSubscription.updateManyAndReturn({
      where: { id },
      data: { failures: { increment: 1 } },
      select: { failures: true },
    });
    return rows[0]?.failures ?? MAX_REJECTIONS;
  },
};

/** The channels in use: push when VAPID keys are configured. */
export function defaultChannels(): NotificationChannel[] {
  const vapid = vapidConfig();
  if (!vapid || !pushConfigured()) return [];
  return [createPushChannel({ subscriptions: prismaSubscriptionStore, vapid })];
}
