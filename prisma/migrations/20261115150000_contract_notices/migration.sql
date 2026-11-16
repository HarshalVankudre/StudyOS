-- Withdrawals and cancellations declared with the statutory online functions
-- (/withdraw, /cancel; lib/contract-notices). Additive: a new table only (see
-- the model's comment in schema.prisma). Rows are legal records: kept, with
-- "userId" cleared, when the account is deleted, and removed three years
-- after receipt by the maintenance job.

-- CreateTable
CREATE TABLE "ContractNotice" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contractKind" TEXT NOT NULL,
    "contractRef" TEXT,
    "details" TEXT,
    "cancelType" TEXT,
    "reason" TEXT,
    "requestedEnd" TEXT,
    "locale" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'open',
    "handledAt" TIMESTAMP(3),
    "ackStatus" TEXT NOT NULL DEFAULT 'pending',
    "operatorNotified" BOOLEAN NOT NULL DEFAULT false,
    "stripeOutcome" TEXT,
    "proEndsAt" TIMESTAMP(3),

    CONSTRAINT "ContractNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractNotice_status_receivedAt_idx" ON "ContractNotice"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "ContractNotice_userId_idx" ON "ContractNotice"("userId");

-- CreateIndex
CREATE INDEX "ContractNotice_receivedAt_idx" ON "ContractNotice"("receivedAt");
