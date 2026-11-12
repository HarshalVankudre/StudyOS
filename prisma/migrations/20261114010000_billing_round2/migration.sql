-- Billing round 2 (see lib/billing.ts and lib/credits.ts).
--
-- Only nullable columns are added and nothing is backfilled, so the code
-- still serving while this migration runs (it applies before the new
-- revision takes traffic) keeps working: it never reads or writes them.
-- Rows that code wrote are re-read from Stripe by the maintenance job
-- (reconcileUnsyncedSubscriptions: every row whose stripeSyncedAt is null).

-- AlterTable: a subscription this code saw ended (guard against stale live
-- reads), the maintenance re-read bookkeeping, and the allowance payment's
-- amount (a refund "in full" is measured against it).
ALTER TABLE "Subscription" ADD COLUMN "endedSubscriptionId" TEXT,
ADD COLUMN "endedAt" TIMESTAMP(3),
ADD COLUMN "stripeCheckedAt" TIMESTAMP(3),
ADD COLUMN "allowancePaymentCents" INTEGER;

-- AlterTable: when a refund or dispute happened on Stripe.
ALTER TABLE "BillingEvent" ADD COLUMN "occurredAt" TIMESTAMP(3);

-- AlterTable: the charge a settle intended, recorded before it runs.
ALTER TABLE "CreditHold" ADD COLUMN "pendingCharge" INTEGER;
