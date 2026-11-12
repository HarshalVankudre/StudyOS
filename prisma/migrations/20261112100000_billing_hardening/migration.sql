-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "allowancePeriodStart" TIMESTAMP(3),
ADD COLUMN "allowancePeriodEnd" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "stripeObjectId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "amountCents" INTEGER,
    "credits" INTEGER,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_kind_stripeObjectId_key" ON "BillingEvent"("kind", "stripeObjectId");

-- CreateIndex
CREATE INDEX "BillingEvent_paymentIntentId_idx" ON "BillingEvent"("paymentIntentId");

-- CreateIndex
CREATE INDEX "BillingEvent_userId_idx" ON "BillingEvent"("userId");

-- CreateTable
CREATE TABLE "DeletedAccount" (
    "userId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedAccount_pkey" PRIMARY KEY ("userId")
);
