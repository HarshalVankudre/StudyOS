/**
 * Why students leave: the optional question in the delete-account
 * confirmation. Stored WITHOUT any link to the account (no user id, the
 * account's age only as a bucket) in AccountDeletionReason, after the account
 * is erased, so the answer never blocks the deletion and is not tied to the
 * account afterwards. The operator console counts the answers
 * (deletionReasonCounts). The reasons themselves, client-safe, are in
 * ./deletion-answer.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { DELETION_REASONS, tenureOf, type DeletionAnswer, type DeletionReason } from "./deletion-answer";

const DAY_MS = 24 * 60 * 60 * 1000;

export {
  DELETION_NOTE_MAX,
  DELETION_REASONS,
  parseDeletionAnswer,
  tenureOf,
  TENURES,
  type DeletionAnswer,
  type DeletionReason,
  type Tenure,
} from "./deletion-answer";

/** Store one answer (anonymous). */
export async function recordDeletionReason(
  answer: DeletionAnswer,
  context: { pro: boolean; createdAt: Date | null },
  now: Date = new Date(),
): Promise<void> {
  await prisma.accountDeletionReason.create({
    data: {
      reason: answer.reason,
      note: answer.note,
      plan: context.pro ? "pro" : "free",
      tenure: tenureOf(context.createdAt, now),
    },
  });
}

export interface DeletionReasonSummary {
  /** Answers in the window. */
  total: number;
  /** Per reason, every offered reason listed (0 when none), most first. */
  byReason: { reason: DeletionReason; count: number }[];
  /** The newest notes, newest first. */
  notes: { note: string; reason: DeletionReason; plan: string; tenure: string; createdAt: Date }[];
}

/** The answers of the last `days` days, for the operator console. */
export async function deletionReasonCounts(days = 90, now: Date = new Date(), notes = 10): Promise<DeletionReasonSummary> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const [groups, recent] = await Promise.all([
    prisma.accountDeletionReason.groupBy({ by: ["reason"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.accountDeletionReason.findMany({
      where: { createdAt: { gte: since }, note: { not: null } },
      orderBy: { createdAt: "desc" },
      take: notes,
      select: { note: true, reason: true, plan: true, tenure: true, createdAt: true },
    }),
  ]);
  const counts = new Map(groups.map((g) => [g.reason, g._count._all]));
  const byReason = DELETION_REASONS.map((reason) => ({ reason, count: counts.get(reason) ?? 0 })).sort(
    (a, b) => b.count - a.count,
  );
  return {
    total: byReason.reduce((sum, r) => sum + r.count, 0),
    byReason,
    notes: recent.map((row) => ({
      note: row.note ?? "",
      reason: (DELETION_REASONS as readonly string[]).includes(row.reason) ? (row.reason as DeletionReason) : "other",
      plan: row.plan,
      tenure: row.tenure,
      createdAt: row.createdAt,
    })),
  };
}
