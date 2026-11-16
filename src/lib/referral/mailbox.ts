/**
 * The pseudonymous mailbox register (server-only): what stops one person
 * farming invites with many accounts on one mailbox.
 *
 * Every invite credit granted writes a ReferralMailbox row: the side it was
 * for (`role`: friend | inviter) and `hash`, an HMAC-SHA256 (base64url) of
 * the mailbox it went to, normalized by emailIdentity (lower case, no
 * "+tag", Gmail dots dropped, googlemail.com read as gmail.com). The key is
 * lib/ops/secret.ts derivedServerKey("referral-mailbox:v1"), so the register
 * holds no address, no user id, and nothing anyone can match against an
 * address without the server secret. Rows are never erased with an account:
 * the rules below must outlive the accounts that tried them.
 *
 * The rules (applied by reward.ts, under a lock keyed by the hash, so two
 * accounts of one mailbox are decided one after the other):
 *  - a mailbox earns the FRIEND bonus once, ever;
 *  - the inviter's caps (REFERRAL_MAX_REWARDS, REFERRAL_MAX_PER_DAY) count
 *    the inviter's mailbox across all its accounts, as well as the account;
 *  - past REFERRAL_MAX_FRIEND_GRANTS_PER_DAY friend bonuses across everyone
 *    in 24 hours, new ones wait (counted under the mailbox lock only, so
 *    parallel rewards can pass it by a few: it is an alarm, not a balance).
 *
 * Rotating CLERK_SECRET_KEY changes the key, so the register starts again
 * from empty (the per-account ledger caps still hold).
 */
import "server-only";

import { createHmac } from "node:crypto";
import { lockKey, type LockedTx } from "@/lib/db-lock";
import { derivedServerKey } from "@/lib/ops/secret";

export type MailboxRole = "friend" | "inviter";

const KEY_LABEL = "referral-mailbox:v1";

/**
 * One mailbox, however it is written: lower case, no "+tag", and for Gmail
 * no dots (googlemail.com is gmail.com).
 */
export function emailIdentity(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return value;
  let local = value.slice(0, at).split("+")[0];
  let domain = value.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** The register's key, or null when the server secret is missing. */
export function referralMailboxKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  return derivedServerKey(KEY_LABEL, env);
}

/** The register's name for the mailbox of `email`. */
export function mailboxHash(email: string, key: Buffer): string {
  return createHmac("sha256", key).update(emailIdentity(email)).digest("base64url");
}

/** Serialize every decision about one mailbox (held to the end of the transaction). */
export async function lockMailbox(tx: LockedTx, hash: string): Promise<void> {
  await lockKey(tx, `studyos:referral-mailbox:${hash}`);
}

/** Grants recorded for `hash` as `role` (since `since`, when given). */
export function mailboxGrants(tx: LockedTx, hash: string, role: MailboxRole, since?: Date): Promise<number> {
  return tx.referralMailbox.count({ where: { hash, role, ...(since ? { createdAt: { gte: since } } : {}) } });
}

/** Friend bonuses granted across everyone since `since`. */
export function friendGrantsSince(tx: LockedTx, since: Date): Promise<number> {
  return tx.referralMailbox.count({ where: { role: "friend", createdAt: { gte: since } } });
}

/** Record one grant to `hash` as `role` (in the transaction that grants it). */
export async function recordMailboxGrant(tx: LockedTx, hash: string, role: MailboxRole): Promise<void> {
  await tx.referralMailbox.create({ data: { hash, role } });
}
