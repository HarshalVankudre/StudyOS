-- Share links: an operator's "Disable link" now sticks. The column records
-- that an operator turned the link off after a report (/app/admin), so the
-- page cannot simply be shared again and a user with several such links
-- cannot share at all (lib/share/store.ts). Nullable, no default: additive,
-- so code without it keeps working during a deploy.

-- AlterTable
ALTER TABLE "PageShare" ADD COLUMN "disabledByOperatorAt" TIMESTAMP(3);
