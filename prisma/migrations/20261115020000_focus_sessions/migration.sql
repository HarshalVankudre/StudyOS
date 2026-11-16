-- Focus timer: one row per focus block a student ran (see schema.prisma).
-- A new table only, so code without the focus timer keeps working during a
-- deploy. (userId, clientId) is unique: a retried save never counts twice.

-- CreateTable
CREATE TABLE "FocusSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "itemKey" TEXT,
    "label" TEXT,
    "clientId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FocusSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FocusSession_userId_clientId_key" ON "FocusSession"("userId", "clientId");

-- CreateIndex
CREATE INDEX "FocusSession_userId_localDate_idx" ON "FocusSession"("userId", "localDate");
