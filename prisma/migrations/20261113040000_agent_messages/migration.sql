-- The AI agent's per-workspace conversation (see AgentChatMessage in schema.prisma).
CREATE TABLE "AgentChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "modelContent" TEXT,
    "changeNote" TEXT,
    "changeId" TEXT,
    "meta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentChatMessage_userId_workspaceId_createdAt_idx" ON "AgentChatMessage"("userId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentChatMessage_createdAt_idx" ON "AgentChatMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "AgentChatMessage" ADD CONSTRAINT "AgentChatMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
