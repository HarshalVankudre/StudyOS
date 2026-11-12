-- CreateTable
CREATE TABLE "StudyMaterial" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pages" TEXT NOT NULL,
    "pageChars" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "charCount" INTEGER NOT NULL,
    "sourcePages" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL,
    "sourcePageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyMaterial_ownerId_idx" ON "StudyMaterial"("ownerId");

-- CreateIndex
CREATE INDEX "StudyMaterial_workspaceId_ownerId_createdAt_idx" ON "StudyMaterial"("workspaceId", "ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
