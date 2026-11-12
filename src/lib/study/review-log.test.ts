import { describe, expect, it } from "vitest";
import type { Flashcard } from "@/lib/workspace/types";
import { REVIEW_LOG_SIZE, recordReview, scheduleOf } from "./review-log";
import { reviewCard, type Grade } from "./srs";

const learned = (): Flashcard => ({
  id: "c1",
  front: "Krebs cycle input",
  back: "acetyl-CoA",
  reps: 4,
  lapses: 0,
  stability: 12,
  difficulty: 5,
  state: "review",
  dueAt: "2026-11-12",
  lastReviewedAt: "2026-10-31T09:00:00.000Z",
});
const at = (iso: string) => new Date(iso);
const morning = at("2026-11-12T07:40:00Z");
const evening = at("2026-11-12T19:10:00Z");

function apply(card: Flashcard, reviews: Array<[Grade, Date]>): Flashcard {
  for (const [grade, when] of reviews) recordReview(card, grade, when);
  return card;
}

describe("recording flashcard reviews (third review, finding 8)", () => {
  it("gives the schedule of reviewing in time order, whichever review is recorded first", () => {
    const inOrder = apply(learned(), [["again", morning], ["good", evening]]);
    const reversed = apply(learned(), [["good", evening], ["again", morning]]);
    expect(reversed).toEqual(inOrder);
    // The morning's lapse is there (the old rule dropped it: due in 39 days, no lapse).
    expect(inOrder.lapses).toBe(1);
    expect(inOrder.reviews?.map((r) => r.grade)).toEqual(["again", "good"]);
    // And it is what the scheduler itself gives for the two reviews in order.
    const direct = reviewCard(reviewCard(learned(), "again", morning), "good", evening);
    expect(scheduleOf(inOrder)).toEqual(scheduleOf(direct));
  });

  it("is idempotent: the same review run again changes nothing", () => {
    const card = apply(learned(), [["again", morning], ["good", evening]]);
    const before = structuredClone(card);
    apply(card, [["again", morning], ["good", evening], ["again", morning]]);
    expect(card).toEqual(before);
  });

  it("a card reviewed before reviews were logged: its last review is not applied twice", () => {
    const card = reviewCard(learned(), "good", evening); // as an older build stored it
    const before = structuredClone(card);
    recordReview(card, "good", evening);
    expect(card).toEqual(before);
  });

  it("keeps a bounded log and folds older reviews into the checkpoint without changing the schedule", () => {
    const reviews: Array<[Grade, Date]> = Array.from({ length: REVIEW_LOG_SIZE + 5 }, (_, i) => [
      (["good", "hard", "again", "easy"] as const)[i % 4],
      new Date(Date.UTC(2026, 10, 12 + i * 3, 9)),
    ]);
    const card = apply(learned(), reviews);
    expect(card.reviews).toHaveLength(REVIEW_LOG_SIZE);
    let direct = learned();
    for (const [grade, when] of reviews) direct = reviewCard(direct, grade, when);
    expect(scheduleOf(card)).toEqual(scheduleOf(direct));
    expect(card.reps).toBe(4 + reviews.length);
  });

  it("a review older than everything the log still holds is counted, not dropped", () => {
    const reviews: Array<[Grade, Date]> = Array.from({ length: REVIEW_LOG_SIZE + 2 }, (_, i) => [
      "good",
      new Date(Date.UTC(2026, 10, 20 + i * 4, 9)),
    ]);
    const card = apply(learned(), reviews);
    const reps = card.reps ?? 0;
    recordReview(card, "again", morning); // from a phone that was offline for weeks
    expect(card.reps).toBe(reps + 1);
    expect(card.reviews).toHaveLength(REVIEW_LOG_SIZE);
  });

  it("a brand-new card: two devices each give its first review", () => {
    const fresh = (): Flashcard => ({ id: "c1", front: "q", back: "a" });
    const a = apply(fresh(), [["good", morning], ["good", evening]]);
    const b = apply(fresh(), [["good", evening], ["good", morning]]);
    expect(b).toEqual(a);
    expect(a.reviewBase).toBeUndefined(); // nothing before the first review
    expect(a.reps).toBe(2);
  });
});
