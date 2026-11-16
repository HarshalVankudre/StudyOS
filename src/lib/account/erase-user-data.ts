/**
 * Erase every StudyOS row a user owns, plus best-effort removal of their asset
 * bytes in object storage. Shared by the in-app "Delete account" action and the
 * Clerk `user.deleted` webhook. Idempotent: running it twice is harmless.
 *
 * Kept on purpose: the DeletedAccount tombstone (written by the caller BEFORE
 * this, so nothing can be granted or recreated while it runs), BillingEvent
 * rows (the audit trail of money movements) and BillingIntent rows (the
 * queued cancellation of the account's billing, retried until it succeeds).
 * ErrorEvent rows (the operator console's error counts) hold no user id, so
 * there is nothing of the user's in them to erase; they age out after 30 days.
 * ReferralMailbox rows (lib/referral/mailbox.ts) hold no user id and no
 * address either, only a keyed HMAC of a mailbox an invite credit went to and
 * which side it was for: kept on purpose, so deleting an account and signing
 * up again with the same mailbox can never earn the invite bonus twice. The
 * invite the user came through is anonymised, not erased (see below).
 * AccountDeletionReason rows (lib/account/deletion-reason.ts) hold no user id:
 * the optional "why are you leaving?" answer, written after this runs.
 * ContractNotice rows (withdrawals and cancellations the user declared with
 * /withdraw or /cancel, lib/contract-notices) are legal records the operator
 * needs to prove receipt and to refund or end the contract: they are kept
 * with their link to the account (userId) cleared, and deleted three years
 * after receipt (lib/ops/retention.ts).
 *
 * Asset rows whose bytes could not be deleted from storage (an outage, or
 * storage not configured) are KEPT, so the files are never orphaned: the
 * daily maintenance job (retryOrphanedAssetDeletes in lib/ops/retention)
 * retries them for every tombstoned account and removes each row once its
 * file is gone. The rows hold no content (key, type, size). PDFs imported
 * into notebooks are handled the same way: their stored objects are deleted
 * best-effort, a NotebookFile row whose object could not be deleted is kept
 * (name and size; the bytes are in object storage) and retried by
 * retryOrphanedNotebookFiles (lib/notebooks/server/store.ts).
 *
 * Billing is NOT handled here. Callers must stop the Stripe subscription first
 * (see deleteAccountAction and the Clerk webhook), because this deletes the
 * Subscription row that maps a user to their Stripe subscription.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { gcsAssetStore } from "@/lib/assets/storage";
import { deletePdfObjects } from "@/lib/notebooks/server/file-store";
import { reportError } from "@/lib/ops/report-error";

/**
 * Models eraseUserData keeps on purpose (see above). Every other model in
 * prisma/schema.prisma that holds a user's rows is erased; a test checks this.
 */
export const ERASURE_KEPT_MODELS = [
  "DeletedAccount",
  "BillingEvent",
  "BillingIntent",
  "ErrorEvent",
  "ReferralMailbox",
  "AccountDeletionReason",
  "ContractNotice",
] as const;

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

/**
 * Erase the user's data; returns how many stored files (rendered assets and
 * imported notebook PDFs) are left for the retry jobs.
 */
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

  // Imported notebook PDFs: rows without a stored object (bytes in the row)
  // and rows whose object is gone now are deleted; the rest stay for retry.
  const pdfFiles = await prisma.notebookFile.findMany({
    where: { ownerId: userId },
    select: { id: true, storageKey: true },
  });
  const pdfKeys = pdfFiles.flatMap((f) => (f.storageKey ? [f.storageKey] : []));
  const { deleted: pdfKeysGone, failed: pdfFailed } = await deletePdfObjects(pdfKeys);
  const gone = new Set(pdfKeysGone);
  const pdfFileIds = pdfFiles.filter((f) => !f.storageKey || gone.has(f.storageKey)).map((f) => f.id);
  if (pdfFailed > 0) {
    reportError(new Error(`${pdfFailed} notebook PDF file(s) could not be deleted; kept for retry`), {
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
    // Focus timer sessions (minutes focused per day).
    prisma.focusSession.deleteMany({ where: { userId } }),
    prisma.calendarToken.deleteMany({ where: { userId } }),
    // Connected calendar feed links (credentials to the student's calendar).
    prisma.calendarFeed.deleteMany({ where: { userId } }),
    // Notifications: device subscriptions (capability URLs), choices (the
    // email switch and bounce record included), sent-log.
    prisma.pushSubscription.deleteMany({ where: { userId } }),
    prisma.notificationPreference.deleteMany({ where: { userId } }),
    prisma.notificationLog.deleteMany({ where: { userId } }),
    // Messages sent with "Send feedback".
    prisma.feedback.deleteMany({ where: { userId } }),
    // Public page links and the reports visitors sent about them (reports
    // first; they also go with their share by cascade).
    prisma.shareReport.deleteMany({ where: { share: { userId } } }),
    prisma.pageShare.deleteMany({ where: { userId } }),
    // The invite link and the invites the student made. The invite the
    // student came through, as the invited friend, is anonymised instead:
    // its link to them (refereeId) goes, its status, outcome and dates stay,
    // the operator console's evidence about the inviter. Credits the other
    // side already got stay theirs; the inviter's caps count from their own
    // ledger and the mailbox register (ReferralMailbox, kept: see above).
    prisma.referralCode.deleteMany({ where: { userId } }),
    prisma.referral.deleteMany({ where: { referrerId: userId } }),
    prisma.referral.updateMany({ where: { refereeId: userId }, data: { refereeId: null } }),
    // Withdrawal and cancellation notices: kept as legal records, unlinked
    // from the account (see the header).
    prisma.contractNotice.updateMany({ where: { userId }, data: { userId: null } }),
    // Handwritten notebooks: pages (also removed by cascade), notebooks,
    // folders, and imported PDF rows whose bytes are gone.
    prisma.notebookPage.deleteMany({ where: { ownerId: userId } }),
    prisma.notebook.deleteMany({ where: { ownerId: userId } }),
    prisma.notebookFolder.deleteMany({ where: { ownerId: userId } }),
    prisma.notebookFile.deleteMany({ where: { ownerId: userId, id: { in: pdfFileIds } } }),
    prisma.subscription.deleteMany({ where: { userId } }),
  ]);
  return { assetsPending: failed + pdfFailed };
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
