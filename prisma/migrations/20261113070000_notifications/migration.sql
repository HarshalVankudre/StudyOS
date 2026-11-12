-- Notifications: Web Push subscriptions, per-student reminder preferences and
-- the sent-log that de-duplicates reminders (see schema.prisma).

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "dailyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyMinute" INTEGER NOT NULL DEFAULT 480,
    "deadlineEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deadlineMinute" INTEGER NOT NULL DEFAULT 1080,
    "deadlineLeads" TEXT NOT NULL DEFAULT '[7,2,1]',
    "examLeads" TEXT NOT NULL DEFAULT '[14,7,2,1]',
    "streakEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietStart" INTEGER NOT NULL DEFAULT 1320,
    "quietEnd" INTEGER NOT NULL DEFAULT 420,
    "nextCheckAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpointHash_key" ON "PushSubscription"("endpointHash");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "NotificationPreference_nextCheckAt_idx" ON "NotificationPreference"("nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_userId_dedupeKey_key" ON "NotificationLog"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_localDate_idx" ON "NotificationLog"("userId", "localDate");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");
