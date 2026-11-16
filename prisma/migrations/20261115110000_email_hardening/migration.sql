-- Email reminders, hardening (see schema.prisma, NotificationPreference, and
-- src/lib/notifications/email-channel.ts). Additive only: one nullable column,
-- so code from before keeps working during a deploy.
--
-- emailBouncedHash  a keyed hash (HMAC-SHA256, lib/email/bounce.ts) of the
--                   address the mail server refused, set together with
--                   emailBouncedAt. The stop then applies to that address
--                   only: once the student's primary address in Clerk is a
--                   different one, the flag is ignored and cleared. The
--                   address itself is still never stored.
--
-- Rows refused before this column existed keep emailBouncedHash = NULL: their
-- stop applies to whatever address the student has (as before), until they
-- turn email on again.

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN "emailBouncedHash" TEXT;
