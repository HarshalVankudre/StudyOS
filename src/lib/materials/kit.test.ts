import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { plural } from "@/lib/i18n/plural";
import { buildKitPage } from "./kit";
import type { KitResult } from "./types";

function result(cards: number, questions: number): KitResult {
  return {
    title: "phys201-lecture14",
    from: 1,
    to: 6,
    notes: [],
    cards: Array.from({ length: cards }, (_, i) => ({ id: `c${i}`, front: "Q", back: "A" })),
    questions: Array.from({ length: questions }, (_, i) => ({
      id: `q${i}`,
      kind: "multiple_choice",
      prompt: "Q",
      choices: ["a", "b"],
      answerIndex: 0,
    })),
  } as unknown as KitResult;
}

function summaryFor(locale: (typeof LOCALES)[number]["code"], cards: number, questions: number): string {
  const M = getDictionary(locale).materials;
  const page = buildKitPage(result(cards, questions), {
    pageTitle: M.kitPageTitle,
    summary: M.kitSummary,
    summaryNotesOnly: M.kitSummaryNotesOnly,
    pagesRange: M.kitPages,
    notesHeading: M.kitNotes,
    flashcardsHeading: M.kitFlashcards,
    quizHeading: M.kitQuiz,
    cardsCount: getDictionary(locale).counts.flashcards,
    questionsCount: getDictionary(locale).counts.practiceQuestions,
    locale,
  }, () => "id");
  const callout = page.blocks[0];
  return callout.type === "callout" ? callout.text : "";
}

describe("study-kit page header", () => {
  it("names what was made with its nouns (English)", () => {
    expect(summaryFor("en", 10, 5)).toContain("pages 1–6: 10 flashcards and 5 practice questions.");
    expect(summaryFor("en", 1, 1)).toContain("1 flashcard and 1 practice question.");
  });

  it("never leaves a bare number in any of the ten languages", () => {
    for (const { code } of LOCALES) {
      const text = summaryFor(code, 10, 5);
      const counts = getDictionary(code).counts;
      const cards = plural(code, counts.flashcards, 10);
      const questions = plural(code, counts.practiceQuestions, 5);
      // The noun is really there, not just the number.
      expect(cards.replace(/[\d٠-٩\s]/g, "").length, code).toBeGreaterThan(0);
      expect(text, code).toContain(cards);
      expect(text, code).toContain(questions);
      expect(text, code).not.toMatch(/\{\w+\}/);
    }
  });
});
