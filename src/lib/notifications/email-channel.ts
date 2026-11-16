/**
 * EMAIL, the second notification channel: the same reminders as push (same
 * kinds, times, quiet hours and daily cap), to the student's verified
 * primary address, which is read from Clerk at send time and never stored.
 *
 * Reachable when the student turned email on, Clerk has a VERIFIED primary
 * address for them, and no permanent refusal of THAT address is on record.
 * When Clerk cannot be reached the student is not reachable by email this
 * run, and `standby` tells the dispatch to look again in a few minutes; an
 * address still waiting to be verified keeps them on their normal schedule;
 * no address at all (an account deleted in Clerk, a phone-only account)
 * counts as email off.
 *
 * Every email carries a one-click unsubscribe (RFC 8058) to a signed,
 * unauthenticated route (lib/email/unsubscribe.ts).
 *
 * Refusals. A permanent refusal of the recipient (lib/email/mailer.ts)
 * records `emailBouncedAt` with a keyed hash of the refused address
 * (lib/email/bounce.ts): email stops until the student turns it on again or
 * their primary address changes (the record is then ignored and cleared).
 * Every other failure changes nothing (the next reminder simply tries again)
 * and is reported once per run, without any address.
 *
 * Circuit breaker: one channel is made per run (configuredEmailChannel). When
 * more than MAX_REFUSALS_PER_RUN different students' addresses are refused in
 * one run, the refusals are far more likely our provider's setup than that
 * many dead mailboxes: refusals stop being recorded for the rest of the run,
 * the ones recorded in it are lifted again, and one alarm is reported.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { emailAddresses, type AddressBook, type AddressLookup } from "@/lib/email/address";
import { bounceHash, refusalApplies } from "@/lib/email/bounce";
import { emailConfig } from "@/lib/email/config";
import { sendMail, type MailOutcome, type OutgoingMail } from "@/lib/email/mailer";
import { reminderHeaders, renderNotificationEmail, type EmailOperator } from "@/lib/email/render";
import { unsubscribeKey, unsubscribeOrigin, unsubscribeUrl } from "@/lib/email/unsubscribe";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { operatorDetails } from "@/lib/legal/operator";
import { reportError } from "@/lib/ops/report-error";
import type { DeliveryResult, NotificationChannel } from "./dispatch";

/** Different students' addresses refused in one run before refusals stop being believed. */
export const MAX_REFUSALS_PER_RUN = 5;

/** The student's email switch as stored (null: no preference row). */
export interface EmailPreference {
  emailEnabled: boolean;
  emailBouncedAt: Date | null;
  /** Keyed hash of the refused address (null: recorded before hashes, applies to any address). */
  emailBouncedHash: string | null;
}

export interface EmailPreferenceStore {
  get(userId: string): Promise<EmailPreference | null>;
  /** Record a permanent refusal of the student's address (its keyed hash). */
  markBounced(userId: string, at: Date, addressHash: string | null): Promise<void>;
  /** Lift a recorded refusal; with `at`, only the one recorded at that moment. */
  clearBounce(userId: string, at?: Date): Promise<void>;
}

export interface EmailChannelOptions {
  preferences: EmailPreferenceStore;
  addresses: AddressBook;
  send: (mail: OutgoingMail) => Promise<MailOutcome>;
  /** The app's public origin, no trailing slash (lib/email/unsubscribe unsubscribeOrigin). */
  origin: string;
  /** Signs the unsubscribe link; without it nothing is sent. */
  unsubscribeKey: Buffer | null;
  operator: EmailOperator | null;
  /** The stored hash of an address (lib/email/bounce). */
  addressHash?: (address: string) => string | null;
  /** See MAX_REFUSALS_PER_RUN. */
  maxRefusals?: number;
  now?: () => Date;
}

export type EmailChannel = NotificationChannel & Required<Pick<NotificationChannel, "standby">>;

const SOURCE = "notifications.email";

export function createEmailChannel(options: EmailChannelOptions): EmailChannel {
  const now = options.now ?? (() => new Date());
  const hash = options.addressHash ?? ((address: string) => bounceHash(address));
  const maxRefusals = options.maxRefusals ?? MAX_REFUSALS_PER_RUN;

  // This run's state (one channel per run).
  const reported = new Set<string>();
  const refused = new Set<string>();
  const recorded = new Map<string, { at: Date; saving: Promise<void> }>();
  let breakerOpen = false;

  /** Report a failure once per run (and kind), without any address or student. */
  const reportOnce = (key: string, message: string, status: number | null) => {
    if (reported.has(key)) return;
    reported.add(key);
    reportError(new Error(message), { source: SOURCE, status });
  };

  /**
   * The student's address when email is on for them and no refusal of that
   * address is on record ("off" otherwise). A refusal of an earlier address
   * is cleared on the way.
   */
  const lookup = async (userId: string): Promise<AddressLookup | "off"> => {
    const pref = await options.preferences.get(userId);
    if (!pref?.emailEnabled) return "off";
    const address = await options.addresses.lookup(userId);
    if (!pref.emailBouncedAt) return address;
    // Stopped by a refusal: of the address the student has now?
    if (!("email" in address)) return "off";
    if (refusalApplies(pref.emailBouncedHash, address.email, hash)) return "off";
    await options.preferences.clearBounce(userId);
    return address;
  };

  const recordRefusal = async (userId: string, email: string, code: number | null) => {
    if (breakerOpen) return;
    refused.add(userId);
    if (refused.size > maxRefusals) {
      breakerOpen = true;
      reportError(
        new Error(
          `email: more than ${maxRefusals} students' addresses refused in one run; likely the mail provider's setup, so refusals are not recorded for the rest of the run and this run's are lifted`,
        ),
        { source: SOURCE, status: code },
      );
      // Lift the refusals recorded in this run: as likely the same setup problem.
      for (const [id, mark] of recorded) {
        await mark.saving.catch(() => {});
        await options.preferences.clearBounce(id, mark.at).catch((error) => reportError(error, { source: SOURCE, userId: id }));
      }
      recorded.clear();
      return;
    }
    const at = now();
    const saving = options.preferences.markBounced(userId, at, hash(email));
    recorded.set(userId, { at, saving });
    await saving;
    // The status only: the address is never logged.
    reportError(new Error(`email address rejected with status ${code ?? "unknown"}`), { source: SOURCE, userId, status: code });
  };

  return {
    name: "email",

    async reachable(userId) {
      const address = await lookup(userId);
      return address !== "off" && address.kind === "verified";
    },

    async standby(userId) {
      const address = await lookup(userId);
      if (address === "off") return null;
      if (address.kind === "unavailable") return "retry";
      // Waiting for the student to verify it; no address at all is email off.
      return address.kind === "unverified" ? "wait" : null;
    },

    async deliver(userId, message): Promise<DeliveryResult> {
      // Read again: the address book keeps an address for a minute at most
      // (lib/email/address), so an address replaced in Clerk is not written to.
      const address = await lookup(userId);
      if (address === "off" || address.kind !== "verified") return { delivered: 0 };
      if (!options.unsubscribeKey) {
        // Never an email without a working way to stop them.
        reportOnce("no_key", "email not sent: no key for the unsubscribe link", null);
        return { delivered: 0 };
      }
      const unsubscribe = unsubscribeUrl(options.origin, userId, options.unsubscribeKey);
      const email = renderNotificationEmail(
        message,
        getDictionary(message.lang),
        { origin: options.origin, unsubscribeUrl: unsubscribe },
        options.operator,
      );
      const outcome = await options.send({ to: address.email, ...email, headers: reminderHeaders(unsubscribe) });
      if (outcome.kind === "sent") return { delivered: 1 };
      if (outcome.kind === "rejected") {
        await recordRefusal(userId, address.email, outcome.code);
      } else if (outcome.reason !== "not_configured") {
        const status = outcome.code ? `, status ${outcome.code}` : "";
        reportOnce(`${outcome.reason}:${outcome.code ?? ""}`, `email not sent (${outcome.reason}${status})`, outcome.code);
      }
      return { delivered: 0 };
    },
  };
}

/**
 * Stands in for email while it is not configured on this server (SMTP_URL or
 * MAIL_FROM missing or unreadable for a while): it reaches nobody, but keeps
 * students who turned email on (and have no refusal on record) on their
 * schedule, instead of dropping email-only students from the dispatch for
 * good. Their reminders are skipped meanwhile, never sent late.
 */
export function createDormantEmailChannel(preferences: EmailPreferenceStore): EmailChannel {
  return {
    name: "email",
    reachable: async () => false,
    async standby(userId) {
      const pref = await preferences.get(userId);
      return pref?.emailEnabled && !pref.emailBouncedAt ? "wait" : null;
    },
    deliver: async () => ({ delivered: 0 }),
  };
}

export const prismaEmailPreferenceStore: EmailPreferenceStore = {
  get: (userId) =>
    prisma.notificationPreference.findUnique({
      where: { userId },
      select: { emailEnabled: true, emailBouncedAt: true, emailBouncedHash: true },
    }),
  markBounced: async (userId, at, addressHash) => {
    await prisma.notificationPreference.updateMany({
      where: { userId, emailBouncedAt: null },
      data: { emailBouncedAt: at, emailBouncedHash: addressHash },
    });
  },
  clearBounce: async (userId, at) => {
    await prisma.notificationPreference.updateMany({
      where: { userId, ...(at ? { emailBouncedAt: at } : { emailBouncedAt: { not: null } }) },
      data: { emailBouncedAt: null, emailBouncedHash: null },
    });
  },
};

/** The email channel as configured (a new one per run: see the breaker), or null when email is not set up. */
export function configuredEmailChannel(): EmailChannel | null {
  if (!emailConfig()) return null;
  const operator = operatorDetails();
  return createEmailChannel({
    preferences: prismaEmailPreferenceStore,
    addresses: emailAddresses,
    send: sendMail,
    origin: unsubscribeOrigin(),
    unsubscribeKey: unsubscribeKey(),
    operator: operator ? { name: operator.name, address: operator.address } : null,
  });
}
