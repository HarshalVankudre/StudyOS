import { describe, expect, it } from "vitest";
import { clipText, normalizeGenQuestions, oneEmoji, QUESTION_LIMITS } from "./onboarding";

describe("clipText", () => {
  it("keeps short text and trims long text at a word, with an ellipsis", () => {
    expect(clipText("  Short   text ", 20)).toBe("Short text");
    const clipped = clipText("Which of your four courses has the most weekly reading assignments?", 40);
    expect(clipped.length).toBeLessThanOrEqual(40);
    expect(clipped).toBe("Which of your four courses has the most…");
  });
});

describe("oneEmoji", () => {
  it("keeps one emoji, including joined ones, and rejects letters", () => {
    expect(oneEmoji("🧪")).toBe("🧪");
    expect(oneEmoji("👩‍⚕️ nurse")).toBe("👩‍⚕️");
    expect(oneEmoji("🧪📚")).toBe("🧪");
    expect(oneEmoji("A")).toBe("");
    expect(oneEmoji(undefined)).toBe("");
  });
});

describe("normalizeGenQuestions", () => {
  it("repairs a reply instead of rejecting it", () => {
    const longQuestion = `How do you usually plan ${"your study week ".repeat(20)}?`;
    const questions = normalizeGenQuestions({
      questions: [
        {
          // No id, an unknown type, a very long question, string options,
          // a duplicate and an empty option.
          question: longQuestion,
          type: "checkbox",
          options: ["Calendar", "Weekly list", "calendar", "", { label: "Board", emoji: "📋📋" }],
        },
        {
          id: "Load!",
          question: "Course load?",
          type: "multi",
          options: [
            { id: "a", label: "Three courses and a lab section that meets on most Fridays", emoji: "🌿" },
            { id: "a", label: "Five", emoji: "x" },
          ],
        },
        { question: "Only one option", options: ["Yes"] },
        "not a question",
      ],
    });
    expect(questions).toHaveLength(2);
    const [first, second] = questions;
    expect(first.id).toBe("q1");
    expect(first.type).toBe("single");
    expect(first.question.length).toBeLessThanOrEqual(QUESTION_LIMITS.questionChars);
    expect(first.options.map((o) => o.label)).toEqual(["Calendar", "Weekly list", "Board"]);
    expect(first.options[2].emoji).toBe("📋");
    expect(second.id).toBe("load");
    expect(second.type).toBe("multi");
    expect(second.options[0].label.length).toBeLessThanOrEqual(QUESTION_LIMITS.labelChars);
    expect(second.options.map((o) => o.id)).toEqual(["a", "a-2"]);
    expect(second.options[1]).not.toHaveProperty("emoji");
  });

  it("keeps at most four questions of six options", () => {
    const options = Array.from({ length: 9 }, (_, i) => ({ label: `Option ${i}` }));
    const questions = normalizeGenQuestions({
      questions: Array.from({ length: 7 }, (_, i) => ({ question: `Q${i}?`, options })),
    });
    expect(questions).toHaveLength(QUESTION_LIMITS.questions);
    expect(questions.every((q) => q.options.length === QUESTION_LIMITS.options)).toBe(true);
  });

  it("returns nothing for output that has no usable question", () => {
    expect(normalizeGenQuestions(null)).toEqual([]);
    expect(normalizeGenQuestions({ questions: [] })).toEqual([]);
    expect(normalizeGenQuestions({ text: "Sorry" })).toEqual([]);
  });
});
