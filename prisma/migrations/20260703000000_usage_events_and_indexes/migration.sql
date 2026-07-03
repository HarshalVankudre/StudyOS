-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageEvent_userId_kind_createdAt_idx" ON "UsageEvent"("userId", "kind", "createdAt");

-- CreateIndex (declared in schema but absent from the db-push-era database)
CREATE INDEX IF NOT EXISTS "AgentTask_userId_workspaceId_idx" ON "AgentTask"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "Subscription_stripeSubscriptionId_idx" ON "Subscription"("stripeSubscriptionId");
