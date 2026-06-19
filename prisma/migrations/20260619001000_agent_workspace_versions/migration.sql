ALTER TABLE "public"."Workspace"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "public"."WorkspaceChange" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'agent',
    "beforeData" TEXT NOT NULL,
    "afterData" TEXT NOT NULL,
    "beforeVersion" INTEGER NOT NULL,
    "afterVersion" INTEGER NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceChange_workspaceId_afterVersion_key"
ON "public"."WorkspaceChange"("workspaceId", "afterVersion");

CREATE INDEX "WorkspaceChange_workspaceId_ownerId_createdAt_idx"
ON "public"."WorkspaceChange"("workspaceId", "ownerId", "createdAt");

ALTER TABLE "public"."WorkspaceChange"
ADD CONSTRAINT "WorkspaceChange_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
