-- Public read-only share links for one workspace page (/s/<token>) and the
-- reports visitors send about them (see schema.prisma). New tables only, so
-- code without sharing keeps working during a deploy. A share is removed with
-- its workspace, a report with its share (ON DELETE CASCADE).

-- CreateTable
CREATE TABLE "PageShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),

    CONSTRAINT "PageShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareReport" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'new',

    CONSTRAINT "ShareReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageShare_token_key" ON "PageShare"("token");

-- CreateIndex
CREATE INDEX "PageShare_userId_idx" ON "PageShare"("userId");

-- CreateIndex
CREATE INDEX "PageShare_workspaceId_pageId_idx" ON "PageShare"("workspaceId", "pageId");

-- CreateIndex
CREATE INDEX "ShareReport_status_createdAt_idx" ON "ShareReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ShareReport_shareId_idx" ON "ShareReport"("shareId");

-- AddForeignKey
ALTER TABLE "PageShare" ADD CONSTRAINT "PageShare_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareReport" ADD CONSTRAINT "ShareReport_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "PageShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
