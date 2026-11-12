/**
 * Erase every StudyOS row a user owns, plus best-effort removal of their asset
 * bytes in object storage. Shared by the in-app "Delete account" action and the
 * Clerk `user.deleted` webhook. Idempotent: running it twice is harmless.
 *
 * Kept on purpose: the DeletedAccount tombstone (written by the caller after
 * this) and BillingEvent rows, the audit trail of money movements.
 *
 * Billing is NOT handled here. Callers must stop the Stripe subscription first
 * (see deleteAccountAction and the Clerk webhook), because this deletes the
 * Subscription row that maps a user to their Stripe subscription.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { gcsAssetStore } from "@/lib/assets/storage";

export async function eraseUserData(userId: string): Promise<void> {
  // Asset bytes live in object storage; collect keys before rows disappear.
  const assets = await prisma.asset.findMany({
    where: { ownerId: userId },
    select: { storageKey: true },
  });
  if (assets.length > 0) {
    try {
      const store = gcsAssetStore();
      await Promise.allSettled(assets.map((a) => store.delete(a.storageKey)));
    } catch {
      // Storage not configured (e.g. local dev) — rows still go.
    }
  }

  await prisma.$transaction([
    prisma.workspace.deleteMany({ where: { ownerId: userId } }),
    prisma.workspaceChange.deleteMany({ where: { ownerId: userId } }),
    prisma.agentTask.deleteMany({ where: { userId } }),
    prisma.dailyStudyPlan.deleteMany({ where: { userId } }),
    prisma.agentRun.deleteMany({ where: { userId } }),
    prisma.dailyStudyAgentConfig.deleteMany({ where: { userId } }),
    prisma.asset.deleteMany({ where: { ownerId: userId } }),
    prisma.creditLedger.deleteMany({ where: { userId } }),
    prisma.creditAccount.deleteMany({ where: { userId } }),
    prisma.usageEvent.deleteMany({ where: { userId } }),
    prisma.studyDay.deleteMany({ where: { userId } }),
    prisma.calendarToken.deleteMany({ where: { userId } }),
    prisma.subscription.deleteMany({ where: { userId } }),
  ]);
}
