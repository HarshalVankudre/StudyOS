-- Quiz answers count as studying: per-day totals next to the flashcard counts.
-- AlterTable
ALTER TABLE "StudyDay" ADD COLUMN     "quizAnswers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quizCorrect" INTEGER NOT NULL DEFAULT 0;
