import { describe, expect, it } from "vitest";
import {
  blockSchema,
  MAX_FLASHCARDS,
  MAX_FLASHCARD_TEXT,
} from "@/lib/workspace/schema";

describe("flashcards block", () => {
  const valid = {
    id: "b1",
    type: "flashcards",
    title: "Bio midterm",
    cards: [
      { id: "c1", front: "What is ATP?", back: "The cell's energy currency." },
      {
        id: "c2",
        front: "Mitochondria?",
        back: "The powerhouse of the cell.",
        ease: 2.5,
        intervalDays: 3,
        reps: 2,
        dueAt: "2026-07-10",
        lastReviewedAt: "2026-07-03T10:00:00.000Z",
      },
    ],
  };

  it("accepts a valid deck (new + scheduled cards)", () => {
    expect(blockSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an empty deck", () => {
    expect(
      blockSchema.safeParse({ id: "b1", type: "flashcards", cards: [] }).success,
    ).toBe(true);
  });

  it("requires non-empty front and back", () => {
    expect(
      blockSchema.safeParse({
        id: "b1",
        type: "flashcards",
        cards: [{ id: "c1", front: "", back: "A" }],
      }).success,
    ).toBe(false);
  });

  it("rejects oversized card text", () => {
    expect(
      blockSchema.safeParse({
        id: "b1",
        type: "flashcards",
        cards: [{ id: "c1", front: "x".repeat(MAX_FLASHCARD_TEXT + 1), back: "A" }],
      }).success,
    ).toBe(false);
  });

  it("caps the number of cards", () => {
    const cards = Array.from({ length: MAX_FLASHCARDS + 1 }, (_, i) => ({
      id: `c${i}`,
      front: "Q",
      back: "A",
    }));
    expect(
      blockSchema.safeParse({ id: "b1", type: "flashcards", cards }).success,
    ).toBe(false);
  });

  it("strips unknown keys on a card", () => {
    const parsed = blockSchema.parse({
      id: "b1",
      type: "flashcards",
      cards: [{ id: "c1", front: "Q", back: "A", evil: "x" }],
    });
    const card = (parsed as { cards: Record<string, unknown>[] }).cards[0];
    expect("evil" in card).toBe(false);
  });
});
