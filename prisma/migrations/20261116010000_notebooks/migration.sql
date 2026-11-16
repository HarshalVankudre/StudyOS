-- Handwritten notebooks (lib/notebooks): folders, notebooks, pages (with their
-- binary ink) and imported PDF files. New tables only, so the previous
-- release keeps running during a deploy.

-- CreateTable
CREATE TABLE "NotebookFolder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notebook" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "folderId" TEXT,
    "workspaceId" TEXT,
    "title" TEXT NOT NULL,
    "cover" TEXT NOT NULL,
    "paper" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookPage" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "template" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "pdfFileId" TEXT,
    "pdfPage" INTEGER,
    "ink" BYTEA NOT NULL,
    "inkVersion" INTEGER NOT NULL DEFAULT 0,
    "strokeCount" INTEGER NOT NULL DEFAULT 0,
    "pdfText" TEXT NOT NULL DEFAULT '',
    "inkText" TEXT NOT NULL DEFAULT '',
    "inkTextVersion" INTEGER NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookFile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "notebookId" TEXT,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "storageKey" TEXT,
    "data" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotebookFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotebookFolder_ownerId_idx" ON "NotebookFolder"("ownerId");

-- CreateIndex
CREATE INDEX "Notebook_ownerId_deletedAt_idx" ON "Notebook"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "NotebookPage_notebookId_position_idx" ON "NotebookPage"("notebookId", "position");

-- CreateIndex
CREATE INDEX "NotebookPage_ownerId_idx" ON "NotebookPage"("ownerId");

-- CreateIndex
CREATE INDEX "NotebookFile_ownerId_idx" ON "NotebookFile"("ownerId");

-- AddForeignKey
ALTER TABLE "NotebookPage" ADD CONSTRAINT "NotebookPage_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

