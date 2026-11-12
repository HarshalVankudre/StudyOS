/**
 * Per-key Postgres advisory locks for check-then-insert limits (server-only).
 *
 * A count followed by an insert lets parallel requests all pass the count
 * before any of them inserts (twelve parallel agent requests ran nine loops
 * against a cap of three). `withKeyLock` runs the check and the insert in one
 * transaction that first takes `pg_advisory_xact_lock` on the key, so requests
 * for the same key run one after another and each sees the others' rows.
 *
 * Transaction-scoped on purpose: the lock is released at commit or rollback
 * and never outlives the transaction, so it works through a transaction-
 * pooling proxy (PgBouncer) where a session lock could stay on a pooled
 * connection. The same mechanism as the credit lock in lib/credits.ts, with
 * its own key namespace so limits never wait on money moves.
 */
import "server-only";

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";

export type LockedTx = Prisma.TransactionClient;

/** Take the transaction-scoped advisory lock for `key` (held until commit/rollback). */
export async function lockKey(tx: LockedTx, key: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Run `fn` in a transaction holding the advisory lock for `key`. */
export async function withKeyLock<T>(key: string, fn: (tx: LockedTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await lockKey(tx, key);
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
}

/** Lock key for one user's limit of one kind ("usage", "agent-tasks", "materials", ...). */
export function userLockKey(scope: string, userId: string): string {
  return `studyos:limit:${scope}:${userId}`;
}
