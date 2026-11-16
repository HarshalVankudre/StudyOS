/**
 * The statutory online functions for consumers (client-safe, pure):
 *
 *  - /withdraw  "Withdraw from contract here" (German: „Vertrag widerrufen“),
 *               the electronic withdrawal function of Art. 11a Consumer
 *               Rights Directive (§ 356a BGB). Two steps: the form, then a
 *               review with the „Widerruf bestätigen“ button.
 *  - /cancel    "Cancel contracts here" (German: „Verträge hier kündigen“),
 *               the cancellation button of § 312k BGB. Two steps: the form,
 *               then a review with the „Jetzt kündigen“ button.
 *
 * Both work signed out (only name, contract and the email address for the
 * acknowledgement are required), are stored as ContractNotice rows for the
 * operator, and acknowledge receipt by email (lib/contract-notices/email.ts).
 */

export const NOTICE_KINDS = ["withdrawal", "cancellation"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** What a notice is about: the Pro subscription, a credit pack, or something else. */
export const CONTRACT_KINDS = ["pro", "pack", "other"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

/** Contracts each function offers: credit packs are one-off, so only withdrawn, never cancelled. */
export const CONTRACTS_FOR: Record<NoticeKind, readonly ContractKind[]> = {
  withdrawal: ["pro", "pack", "other"],
  cancellation: ["pro", "other"],
};

export const CANCEL_TYPES = ["ordinary", "extraordinary"] as const;
export type CancelType = (typeof CANCEL_TYPES)[number];

/** When a cancellation should take effect. */
export const END_CHOICES = ["earliest", "date"] as const;
export type EndChoice = (typeof END_CHOICES)[number];

export const NOTICE_STATUSES = ["open", "done"] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

/** Outcome of the acknowledgement email. */
export type AckStatus = "pending" | "sent" | "failed" | "not_configured";

/** What a cancellation did in Stripe (null on the row: Stripe was not touched). */
export type StripeOutcome = "scheduled" | "already_scheduled" | "no_live_subscription" | "failed";

export const NOTICE_PATHS: Record<NoticeKind, string> = { withdrawal: "/withdraw", cancellation: "/cancel" };

/** Field length caps (characters, after trimming). */
export const NOTICE_LIMITS = {
  name: 120,
  /** RFC 5321's practical maximum for an address. */
  email: 254,
  details: 1000,
  reason: 2000,
} as const;

/** Notices confirmed per client address (an IPv6 client by its /64) per hour, counted in memory. */
export const NOTICES_PER_ADDRESS_PER_HOUR = 5;
/** Acknowledgements sent to one email address per day, counted in memory (no inbox gets flooded). */
export const NOTICES_PER_EMAIL_PER_DAY = 5;
/**
 * Notices accepted online across everyone in 24 hours. Far above what a
 * small service receives: reaching it means a flood, which is reported
 * (reportError) so the owner sees it; visitors are told the email route.
 */
export const NOTICES_GLOBAL_DAILY_CAP = 300;

/**
 * Time zone the receipt time is stated in (the operator is in Germany), with
 * its zone name, so "received on" is unambiguous; the UTC instant is given too.
 */
export const NOTICE_TIME_ZONE = "Europe/Berlin";

/** Name of the honeypot field: hidden from people, filled in by naive bots. */
export const HONEYPOT_FIELD = "website";
