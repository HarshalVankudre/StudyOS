/**
 * ContractNotice rows (see the model in prisma/schema.prisma): the contracts
 * a signed-in sender can pick, the stored notices, and the operator
 * console's list of open ones.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { fmt } from "@/lib/i18n/interpolate";
import type { AckStatus, ContractKind, NoticeKind, StripeOutcome } from "./config";
import { formatDate, type NoticeMessages } from "./format";
import type { ValidNotice } from "./form";

/** One choice of the "Which contract?" field. */
export interface ContractOption {
  value: string;
  label: string;
}

/** The CreditLedger reason of a credit pack purchase (lib/billing.ts grantCreditPack). */
const PACK_REASON = "credit_purchase";
const PACK_KEY_PREFIX = `${PACK_REASON}:`;
/** Packs offered by name in the withdrawal form, newest first. */
export const PACKS_LISTED = 5;

/** A Subscription row that stands for a Pro contract (one was ever started). */
async function proContract(userId: string) {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { stripeSubscriptionId: true, status: true, currentPeriodEnd: true },
  });
  return sub?.stripeSubscriptionId && sub.status !== "free" ? sub : null;
}

/**
 * The "Which contract?" choices. Signed in, the sender's own contracts are
 * named (Pro with its paid-until date, recent credit packs by date); kinds
 * not found stay as generic choices; "Something else" is always there.
 */
export async function contractOptions(
  kind: NoticeKind,
  userId: string | null,
  M: NoticeMessages,
  locale: string,
): Promise<ContractOption[]> {
  const options: ContractOption[] = [];
  const pro = userId ? await proContract(userId) : null;
  options.push({
    value: "pro",
    label: pro?.currentPeriodEnd ? fmt(M.proUntil, { date: formatDate(pro.currentPeriodEnd, locale) }) : M.pro,
  });
  if (kind === "withdrawal") {
    const packs = userId
      ? await prisma.creditLedger.findMany({
          where: { userId, reason: PACK_REASON },
          orderBy: { createdAt: "desc" },
          take: PACKS_LISTED,
          select: { id: true, createdAt: true },
        })
      : [];
    if (packs.length === 0) options.push({ value: "pack", label: M.pack });
    for (const pack of packs) {
      options.push({ value: `pack:${pack.id}`, label: fmt(M.packOn, { date: formatDate(pack.createdAt, locale) }) });
    }
  }
  options.push({ value: "other", label: M.other });
  return options;
}

/** The contract a notice is about, as facts (labelled per language by contractLabel). */
export interface ResolvedContract {
  kind: ContractKind;
  /** When a named credit pack of the sender was bought. */
  boughtAt: Date | null;
  /** The Stripe subscription id, or a pack's checkout session id, when it is the sender's own. */
  ref: string | null;
}

/**
 * The contract of a valid notice, with its Stripe reference when it is the
 * signed-in sender's own. Null when a named pack is not the sender's.
 */
export async function resolveContract(
  userId: string | null,
  notice: Pick<ValidNotice, "contractKind" | "packId">,
): Promise<ResolvedContract | null> {
  if (notice.contractKind === "pack" && notice.packId) {
    if (!userId) return null;
    const pack = await prisma.creditLedger.findFirst({
      where: { id: notice.packId, userId, reason: PACK_REASON },
      select: { createdAt: true, idempotencyKey: true },
    });
    if (!pack) return null;
    const key = pack.idempotencyKey ?? "";
    return {
      kind: "pack",
      boughtAt: pack.createdAt,
      ref: key.startsWith(PACK_KEY_PREFIX) ? key.slice(PACK_KEY_PREFIX.length) : null,
    };
  }
  if (notice.contractKind === "pro") {
    const pro = userId ? await proContract(userId) : null;
    return { kind: "pro", boughtAt: null, ref: pro?.stripeSubscriptionId ?? null };
  }
  return { kind: notice.contractKind, boughtAt: null, ref: null };
}

/** A resolved contract in words. */
export function contractLabel(contract: ResolvedContract, M: NoticeMessages, locale: string): string {
  if (contract.kind === "pack" && contract.boughtAt) return fmt(M.packOn, { date: formatDate(contract.boughtAt, locale) });
  return contract.kind === "pro" ? M.pro : contract.kind === "pack" ? M.pack : M.other;
}

/** Notices received in the 24 hours before `now` (the global daily cap). */
export async function noticesInLastDay(now: Date): Promise<number> {
  return prisma.contractNotice.count({ where: { receivedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
}

export interface NewNotice {
  kind: NoticeKind;
  userId: string | null;
  name: string;
  email: string;
  contractKind: ContractKind;
  contractRef: string | null;
  details: string | null;
  cancelType: string | null;
  reason: string | null;
  requestedEnd: string | null;
  locale: string;
  receivedAt: Date;
}

export async function storeNotice(data: NewNotice): Promise<{ id: string }> {
  return prisma.contractNotice.create({ data, select: { id: true } });
}

export interface NoticeOutcome {
  ackStatus?: AckStatus;
  operatorNotified?: boolean;
  stripeOutcome?: StripeOutcome;
  proEndsAt?: Date | null;
  status?: "open" | "done";
  handledAt?: Date | null;
}

export async function recordNoticeOutcome(id: string, data: NoticeOutcome): Promise<void> {
  await prisma.contractNotice.update({ where: { id }, data });
}

// ---- Operator console -----------------------------------------------------

/** Open notices listed in the console, oldest first (they are the most urgent). */
export const OPEN_NOTICES_SHOWN = 100;

export interface OpenNotice {
  id: string;
  kind: string;
  receivedAt: Date;
  name: string;
  email: string;
  contractKind: string;
  contractRef: string | null;
  details: string | null;
  cancelType: string | null;
  reason: string | null;
  requestedEnd: string | null;
  locale: string;
  userId: string | null;
  ackStatus: string;
  operatorNotified: boolean;
  stripeOutcome: string | null;
  proEndsAt: Date | null;
}

export async function openContractNotices(): Promise<{ count: number; items: OpenNotice[] }> {
  const [count, items] = await Promise.all([
    prisma.contractNotice.count({ where: { status: "open" } }),
    prisma.contractNotice.findMany({
      where: { status: "open" },
      orderBy: { receivedAt: "asc" },
      take: OPEN_NOTICES_SHOWN,
      select: {
        id: true, kind: true, receivedAt: true, name: true, email: true, contractKind: true, contractRef: true,
        details: true, cancelType: true, reason: true, requestedEnd: true, locale: true, userId: true,
        ackStatus: true, operatorNotified: true, stripeOutcome: true, proEndsAt: true,
      },
    }),
  ]);
  return { count, items };
}

/** "Mark done": an open notice was processed by the operator. */
export async function markContractNoticeDone(id: string, now = new Date()): Promise<boolean> {
  const result = await prisma.contractNotice.updateMany({
    where: { id, status: "open" },
    data: { status: "done", handledAt: now },
  });
  return result.count > 0;
}
