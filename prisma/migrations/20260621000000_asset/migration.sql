-- prisma/migrations/20260621000000_asset/migration.sql
CREATE TABLE "Asset" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "workspaceId" TEXT,
  "mime" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sourceRunId" TEXT,
  "checksum" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Asset_ownerId_idx" ON "Asset"("ownerId");
