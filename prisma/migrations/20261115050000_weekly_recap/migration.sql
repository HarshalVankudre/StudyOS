-- Weekly recap notification (see schema.prisma, NotificationPreference).
-- Additive only: three columns with defaults, so every existing row is opted
-- OUT (weeklyEnabled = false) and code without the recap keeps working during
-- a deploy. weeklyDay: 0 = Sunday … 6 = Saturday; weeklyMinute: minutes after
-- local midnight (1080 = 18:00).

-- AlterTable
ALTER TABLE "NotificationPreference"
    ADD COLUMN "weeklyEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "weeklyDay" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "weeklyMinute" INTEGER NOT NULL DEFAULT 1080;
