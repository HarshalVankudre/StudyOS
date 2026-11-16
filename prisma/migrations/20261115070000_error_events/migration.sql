-- Operator console: the "Errors" panel and the indexes its queries need (see
-- schema.prisma, ErrorEvent, and lib/ops/admin-metrics.ts). Additive only: one
-- new table and new indexes; no existing column or row changes, so code
-- without the panel keeps working during a deploy.
--
-- ErrorEvent holds server errors grouped by kind (one row per fingerprint,
-- with a count). Operational data only: no user ids, emails or content.
--
-- The indexes cover the console's time-window filters:
--   CreditLedger.createdAt   credits spent per window, packs sold, active students
--   BillingEvent.createdAt   billing events of the last 30 days
--   AgentRun(status, startedAt)  recent failed runs (status = 'failed', newest first)
--   CreditAccount.createdAt  new accounts per window
--
-- Prisma runs a migration inside a transaction, so these are plain
-- CREATE INDEX statements, which lock writes to the table while they build.
-- On a large table, CREATE INDEX CONCURRENTLY (run by hand, outside a
-- transaction, before this migration) would be preferable; IF NOT EXISTS lets
-- this migration then skip the indexes that already exist.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ErrorEvent" (
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "route" TEXT,
    "message" TEXT NOT NULL,
    "sample" TEXT,
    "count" INTEGER NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL,
    "release" TEXT,

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ErrorEvent_lastSeen_idx" ON "ErrorEvent"("lastSeen");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditLedger_createdAt_idx" ON "CreditLedger"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillingEvent_createdAt_idx" ON "BillingEvent"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentRun_status_startedAt_idx" ON "AgentRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditAccount_createdAt_idx" ON "CreditAccount"("createdAt");
