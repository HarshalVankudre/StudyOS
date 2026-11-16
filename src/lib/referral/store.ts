/**
 * Invite codes and what a student's invite card shows (server-only).
 *
 * A code is made lazily, the first time the student opens the card, from the
 * OS CSPRNG (crypto.randomInt draws each character uniformly). A collision
 * with another student's code (unique index) is retried with a new code; a
 * parallel first open by the same student finds the row the other one wrote.
 */
import "server-only";

import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { REFERRAL_MAX_PER_DAY, REFERRAL_MAX_REWARDS } from "@/lib/price-list";
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_REASON_REFERRER,
  REFERRAL_REASONS,
} from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A fresh random code (REFERRAL_CODE_LENGTH characters of the alphabet). */
export function newReferralCode(length = REFERRAL_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  return code;
}

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";

/** The student's code, made on first use. */
export async function getOrCreateReferralCode(userId: string, generate = newReferralCode): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await prisma.referralCode.findUnique({ where: { userId }, select: { code: true } });
    if (existing) return existing.code;
    try {
      const created = await prisma.referralCode.create({ data: { userId, code: generate() }, select: { code: true } });
      return created.code;
    } catch (err) {
      // Our own row written meanwhile (found on the next pass), or another
      // student's code drawn again (a new one is drawn).
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("could not allocate a referral code");
}

/** The owner of `code`, or null. */
export async function findReferralCode(code: string): Promise<{ userId: string; code: string } | null> {
  return prisma.referralCode.findUnique({ where: { code }, select: { userId: true, code: true } });
}

export interface ReferralSummary {
  code: string;
  /** Friends attributed to the student (rejected attempts are not counted). */
  joined: number;
  /** Of them, friends whose first workspace build was rewarded. */
  rewarded: number;
  /** Credits the student received from invites (as inviter, and as an invited friend). */
  creditsEarned: number;
  /** The inviter's half has been granted REFERRAL_MAX_REWARDS times: no more. */
  capReached: boolean;
  /** REFERRAL_MAX_PER_DAY grants in the last 24 hours: none until one ages out. */
  dailyCapReached: boolean;
}

/**
 * What the invite card shows. The caps are counted from the student's own
 * ledger (as the reward does), so a friend deleting their account never
 * frees a capped slot.
 */
export async function referralSummary(userId: string, now = new Date()): Promise<ReferralSummary> {
  const code = await getOrCreateReferralCode(userId);
  const [joined, rewarded, earned, granted, grantedToday] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId, status: { in: ["pending", "rewarded"] } } }),
    prisma.referral.count({ where: { referrerId: userId, status: "rewarded" } }),
    prisma.creditLedger.aggregate({
      _sum: { delta: true },
      where: { userId, reason: { in: [...REFERRAL_REASONS] } },
    }),
    prisma.creditLedger.count({ where: { userId, reason: REFERRAL_REASON_REFERRER } }),
    prisma.creditLedger.count({
      where: { userId, reason: REFERRAL_REASON_REFERRER, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    }),
  ]);
  const capReached = granted >= REFERRAL_MAX_REWARDS;
  return {
    code,
    joined,
    rewarded,
    creditsEarned: Math.max(0, earned._sum.delta ?? 0),
    capReached,
    dailyCapReached: !capReached && grantedToday >= REFERRAL_MAX_PER_DAY,
  };
}
