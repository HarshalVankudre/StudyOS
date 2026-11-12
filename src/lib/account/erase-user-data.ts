/**
 * Erase every StudyOS row a user owns, plus best-effort removal of their asset
 * bytes in object storage. Shared by the in-app "Delete account" action and the
 * Clerk `user.deleted` webhook. Idempotent: running it twice is harmless.
 *
 * Kept on purpose: the DeletedAccount tombstone (written by the caller BEFORE
 * this, so nothing can be granted or recreated while it runs), BillingEvent
 * rows (the audit trail of money movements) and BillingIntent rows (the
 * queued cancellation of the account's billing, retried until it succeeds).
 *
 * Asset rows whose bytes could not be deleted from storage (an outage, or
 * storage not configured) are KEPT, so the files are never orphaned: the
 * daily maintenance job (retryOrphanedAssetDeletes in lib/ops/retention)
 * retries them for every tombstoned account and removes each row once its
 * file is gone. The rows hold no content (key, type, size).
 *
 * Billing is NOT handled here. Callers must stop the Stripe subscription first
 * (see deleteAccountAction and the Clerk webhook), because this deletes the
 * Subscription row that maps a user to their Stripe subscription.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { gcsAssetStore } from "@/lib/assets/storage";
import { reportError } from "@/lib/ops/report-error";

/**
 * Models eraseUserData keeps on purpose (see above). Every other model in
 * prisma/schema.prisma that holds a user's rows is erased; a test checks this.
 */
export const ERASURE_KEPT_MODELS = ["DeletedAccount", "BillingEvent", "BillingIntent"] as const;

/**
 * Delete the stored bytes of `assets`. Returns the ids whose file is gone
 * (deleted now, or already missing) and how many failed. When storage is not
 * configured nothing can be deleted, so every asset counts as failed.
 */
export async function deleteAssetFiles(
  assets: readonly { id: string; storageKey: string }[],
): Promise<{ deletedIds: string[]; failed: number }> {
  if (assets.length === 0) return { deletedIds: [], failed: 0 };
  let store: ReturnType<typeof gcsAssetStore>;
  try {
    store = gcsAssetStore();
  } catch {
    return { deletedIds: [], failed: assets.length };
  }
  const results = await Promise.allSettled(assets.map((a) => store.delete(a.storageKey)));
  const deletedIds = assets.filter((_, i) => results[i].status === "fulfilled").map((a) => a.id);
  return { deletedIds, failed: assets.length - deletedIds.length };
}

/** Erase the user's data; returns how many asset files are left for the retry job. */
export async function eraseUserData(userId: string): Promise<{ assetsPending: number }> {
  // Asset bytes live in object storage; collect keys before rows disappear.
  const assets = await prisma.asset.findMany({
    where: { ownerId: userId },
    select: { id: true, storageKey: true },
  });
  const { deletedIds, failed } = await deleteAssetFiles(assets);
  if (failed > 0) {
    reportError(new Error(`${failed} asset file(s) could not be deleted; kept for retry`), {
      source: "eraseUserData",
      userId,
    });
  }

  await prisma.$transaction([
    prisma.workspace.deleteMany({ where: { ownerId: userId } }),
    // Uploaded course material (also removed with each workspace by cascade).
    prisma.studyMaterial.deleteMany({ where: { ownerId: userId } }),
    prisma.workspaceChange.deleteMany({ where: { ownerId: userId } }),
    prisma.agentTask.deleteMany({ where: { userId } }),
    prisma.agentChatMessage.deleteMany({ where: { userId } }),
    prisma.dailyStudyPlan.deleteMany({ where: { userId } }),
    prisma.agentRun.deleteMany({ where: { userId } }),
    prisma.dailyStudyAgentConfig.deleteMany({ where: { userId } }),
    // Only rows whose file is gone; the rest stay for the retry job.
    prisma.asset.deleteMany({ where: { ownerId: userId, id: { in: deletedIds } } }),
    prisma.creditLedger.deleteMany({ where: { userId } }),
    prisma.creditAccount.deleteMany({ where: { userId } }),
    prisma.creditHold.deleteMany({ where: { userId } }),
    prisma.usageEvent.deleteMany({ where: { userId } }),
    prisma.studyDay.deleteMany({ where: { userId } }),
    prisma.calendarToken.deleteMany({ where: { userId } }),
    // Connected calendar feed links (credentials to the student's calendar).
    prisma.calendarFeed.deleteMany({ where: { userId } }),
    // Notifications: device subscriptions (capability URLs), choices, sent-log.
    prisma.pushSubscription.deleteMany({ where: { userId } }),
    prisma.notificationPreference.deleteMany({ where: { userId } }),
    prisma.notificationLog.deleteMany({ where: { userId } }),
    prisma.subscription.deleteMany({ where: { userId } }),
  ]);
  return { assetsPending: failed };
}

/** Asset files retried per maintenance run (keeps one run short). */
export const ORPHAN_ASSET_RETRY_BATCH = 200;

/**
 * Retry deleting the files of assets that belong to deleted accounts (rows
 * kept by eraseUserData because their file could not be deleted). Run daily
 * by the maintenance job. Removes each row once its file is gone; a row whose
 * file still cannot be deleted stays for the next run.
 */
export async function retryOrphanedAssetDeletes(
  limit = ORPHAN_ASSET_RETRY_BATCH,
): Promise<{ retried: number; deleted: number }> {
  const rows = await prisma.$queryRaw<{ id: string; storageKey: string }[]>`
    SELECT a."id", a."storageKey"
    FROM "Asset" a
    JOIN "DeletedAccount" d ON d."userId" = a."ownerId"
    ORDER BY a."createdAt" ASC
    LIMIT ${limit}`;
  if (rows.length === 0) return { retried: 0, deleted: 0 };
  const { deletedIds } = await deleteAssetFiles(rows);
  if (deletedIds.length > 0) {
    await prisma.asset.deleteMany({ where: { id: { in: deletedIds } } });
  }
  return { retried: rows.length, deleted: deletedIds.length };
}
