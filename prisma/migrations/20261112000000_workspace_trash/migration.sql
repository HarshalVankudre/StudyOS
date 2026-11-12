-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Workspace_ownerId_deletedAt_idx" ON "Workspace"("ownerId", "deletedAt");
