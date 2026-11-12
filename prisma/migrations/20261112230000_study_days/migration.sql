-- CreateTable
CREATE TABLE "StudyDay" (
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "again" INTEGER NOT NULL DEFAULT 0,
    "hard" INTEGER NOT NULL DEFAULT 0,
    "good" INTEGER NOT NULL DEFAULT 0,
    "easy" INTEGER NOT NULL DEFAULT 0,
    "newCards" INTEGER NOT NULL DEFAULT 0,
    "reviewTotal" INTEGER NOT NULL DEFAULT 0,
    "reviewPassed" INTEGER NOT NULL DEFAULT 0,
    "practice" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyDay_pkey" PRIMARY KEY ("userId","workspaceId","localDate")
);

-- CreateIndex
CREATE INDEX "StudyDay_userId_localDate_idx" ON "StudyDay"("userId", "localDate");
