-- Daily plan v2: structured, translatable plans.
-- Existing rows keep version 1 (English text) and are rebuilt on first read.
ALTER TABLE "DailyStudyPlan" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DailyStudyPlan" ADD COLUMN "details" TEXT NOT NULL DEFAULT '{}';
