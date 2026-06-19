-- CreateTable
CREATE TABLE "Subscription" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'free',
    "currentPeriodEnd" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
