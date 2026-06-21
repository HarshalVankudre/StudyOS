CREATE TABLE "public"."Asset" (
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
CREATE INDEX "Asset_ownerId_idx" ON "public"."Asset"("ownerId");
