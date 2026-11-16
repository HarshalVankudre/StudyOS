-- Why students delete their accounts (anonymous: no user id). See the model's
-- comment in schema.prisma.
CREATE TABLE "AccountDeletionReason" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "plan" TEXT NOT NULL,
    "tenure" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionReason_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountDeletionReason_createdAt_idx" ON "AccountDeletionReason"("createdAt");
