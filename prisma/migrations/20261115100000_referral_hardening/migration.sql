-- Invite program hardening (lib/referral, see schema.prisma). Additive only,
-- so the code before it keeps working during a deploy:
--
-- Referral.refereeId  nullable: when the invited FRIEND deletes their account
--                     their row is anonymised (refereeId cleared) instead of
--                     erased, so the operator console keeps the evidence about
--                     the inviter. The unique index stays: Postgres never
--                     counts NULLs as duplicates, so it still allows one row
--                     per friend and any number of anonymised rows.
-- Referral.lastTriedAt the maintenance job's last attempt; it retries the
--                     least recently tried first, so a referral that keeps
--                     waiting can no longer starve the others.
-- ReferralMailbox     the pseudonymous mailbox register: an HMAC of the
--                     mailbox each invite credit went to and the side it was
--                     for, no user id and no address. It survives account
--                     erasure on purpose (one mailbox earns the friend bonus
--                     once ever; the inviter's caps count per mailbox).

-- AlterTable
ALTER TABLE "Referral" ALTER COLUMN "refereeId" DROP NOT NULL;
ALTER TABLE "Referral" ADD COLUMN "lastTriedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReferralMailbox" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralMailbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralMailbox_hash_role_createdAt_idx" ON "ReferralMailbox"("hash", "role", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralMailbox_role_createdAt_idx" ON "ReferralMailbox"("role", "createdAt");
