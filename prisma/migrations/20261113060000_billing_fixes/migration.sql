-- Billing fixes: conditional subscription writes, an allowance tied to its
-- subscription and payment, dispute holds, durable billing jobs and credit
-- holds (see lib/billing.ts and lib/credits.ts).

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "stripeSyncedAt" TIMESTAMP(3),
ADD COLUMN "allowanceSubscriptionId" TEXT,
ADD COLUMN "allowancePaymentIntentId" TEXT,
ADD COLUMN "allowanceYearly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "allowanceStopAt" TIMESTAMP(3),
ADD COLUMN "disputeId" TEXT,
ADD COLUMN "disputedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BillingIntent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BillingIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'held',
    "charged" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "CreditHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingIntent_kind_key_key" ON "BillingIntent"("kind", "key");

-- CreateIndex
CREATE INDEX "BillingIntent_state_updatedAt_idx" ON "BillingIntent"("state", "updatedAt");

-- CreateIndex
CREATE INDEX "CreditHold_userId_state_idx" ON "CreditHold"("userId", "state");

-- CreateIndex
CREATE INDEX "CreditHold_state_expiresAt_idx" ON "CreditHold"("state", "expiresAt");
