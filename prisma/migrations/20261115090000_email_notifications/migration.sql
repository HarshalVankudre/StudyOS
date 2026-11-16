-- Email reminders (see schema.prisma, NotificationPreference, and
-- src/lib/notifications/email-channel.ts). Additive only: two columns, one
-- with a default, so every existing row is opted OUT of email
-- (emailEnabled = false) and code without email keeps working during a deploy.
--
-- emailEnabled   the student turned on "Also send reminders by email".
-- emailBouncedAt the mail server refused the address for good (a permanent
--                5xx rejection of the recipient); nothing is emailed while it
--                is set, and turning email on again clears it.
--
-- The email address itself is NOT stored: it is read from Clerk at send time.

-- AlterTable
ALTER TABLE "NotificationPreference"
    ADD COLUMN "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "emailBouncedAt" TIMESTAMP(3);
