import { describe, expect, it } from "vitest";
import { ReviewBuffer, countsForStudyEvent } from "./recorder";
import { zeroCounts } from "./stats";

describe("study events", () => {
  it("counts quiz answers (and the right ones) next to flashcard reviews", () => {
    expect(countsForStudyEvent({ quiz: true, correct: true })).toEqual({ ...zeroCounts(), quizAnswers: 1, quizCorrect: 1 });
    expect(countsForStudyEvent({ quiz: true, correct: false })).toEqual({ ...zeroCounts(), quizAnswers: 1 });
    expect(countsForStudyEvent({ grade: "good", prevState: "new", practice: false })).toMatchObject({
      reviews: 1,
      good: 1,
      newCards: 1,
      quizAnswers: 0,
    });
  });

  it("batches quiz answers and card reviews into the same day", () => {
    const buffer = new ReviewBuffer();
    buffer.add("w1", "2026-11-12", { quiz: true, correct: true });
    buffer.add("w1", "2026-11-12", { quiz: true, correct: false });
    buffer.add("w1", "2026-11-12", { grade: "again", prevState: "review", practice: false });
    const [batch] = buffer.drain();
    expect(batch.counts).toMatchObject({ quizAnswers: 2, quizCorrect: 1, reviews: 1, again: 1 });
  });
});
