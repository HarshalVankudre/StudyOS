import { describe, expect, it } from "vitest";
import { repairWorkspace } from "./repair";
import {
  MAX_QUIZ_ATTEMPTS,
  MAX_QUIZ_CHOICES,
  MAX_QUIZ_QUESTIONS,
  MAX_QUIZ_TEXT,
  safeParseWorkspace,
} from "./schema";
import type { QuizBlock, Workspace } from "./types";

function withBlocks(blocks: unknown[]): unknown {
  return { id: "w", name: "W", databases: [], pages: [{ id: "p1", title: "P", blocks }] };
}
const quizOf = (ws: Workspace, i = 0) => ws.pages[0].blocks[i] as QuizBlock;

describe("quiz block schema", () => {
  it("accepts a full quiz with sources, stats and attempts", () => {
    const parsed = safeParseWorkspace(
      withBlocks([
        {
          id: "q",
          type: "quiz",
          title: "Cells",
          questions: [
            {
              id: "1",
              kind: "mcq",
              prompt: "Powerhouse?",
              choices: ["Nucleus", "Mitochondria"],
              answerIndex: 1,
              explanation: "ATP",
              topic: "Organelles",
              source: { materialId: "m1", page: 4, quote: "the powerhouse", label: "Lecture 2" },
              stats: { attempts: 2, correct: 1, lastAnsweredAt: "2026-11-12T10:00:00Z" },
            },
            { id: "2", kind: "true_false", prompt: "DNA is in the nucleus", answerBool: true },
            { id: "3", kind: "short", prompt: "Define osmosis", answerText: "Diffusion of water" },
          ],
          attempts: [{ at: "2026-11-12T10:00:00Z", mode: "exam", score: 2, total: 3 }],
        },
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it("allows half-written questions (students fill them in with autosave in between)", () => {
    const parsed = safeParseWorkspace(
      withBlocks([
        {
          id: "q",
          type: "quiz",
          questions: [
            { id: "1", kind: "mcq", prompt: "", choices: ["", ""] },
            { id: "2", kind: "true_false", prompt: "" },
          ],
        },
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it("keeps flashcards valid with or without a source", () => {
    const parsed = safeParseWorkspace(
      withBlocks([
        {
          id: "d",
          type: "flashcards",
          cards: [
            { id: "c1", front: "Q", back: "A" },
            { id: "c2", front: "Q", back: "A", source: { page: 3, label: "Notes" } },
          ],
        },
      ]),
    );
    expect(parsed.success).toBe(true);
    expect(safeParseWorkspace(withBlocks([{ id: "d", type: "flashcards", cards: [{ id: "c", front: "Q", back: "A", source: { page: 0 } }] }])).success).toBe(false);
  });
});

describe("quiz block repair", () => {
  it("repairs a damaged quiz without losing the rest of the document", () => {
    const result = repairWorkspace(
      withBlocks([
        { id: "before", type: "paragraph", text: "keep me" },
        {
          id: "q",
          type: "quiz",
          title: "Cells",
          questions: [
            // Unknown kind with choices: inferred as MCQ; too many choices cut;
            // the answer pointed past the kept choices so it is cleared.
            {
              id: "1",
              kind: "multiple",
              prompt: "Pick",
              choices: ["a", "b", "c", "d", "e", "f", "g", "h"],
              answerIndex: 7,
            },
            // Damaged optional fields are removed; the question is kept.
            { id: "2", kind: "true_false", prompt: "T?", answerBool: "true", stats: { attempts: -1 }, source: { page: "x" } },
            // Overlong text is trimmed; numeric prompt becomes text.
            { id: "3", kind: "short", prompt: 42, answerText: "x".repeat(MAX_QUIZ_TEXT + 50) },
            // Not an object: dropped on its own.
            "garbage",
            // Missing id gets one.
            { kind: "true_false", prompt: "No id", answerBool: false },
          ],
          attempts: [
            { at: "t1", mode: "practice", score: 1, total: 2 },
            { at: "bad", mode: "nope", score: 1, total: 2 },
            ...Array.from({ length: MAX_QUIZ_ATTEMPTS + 3 }, (_, i) => ({ at: `n${i}`, mode: "exam", score: i, total: 30 })),
          ],
        },
        { id: "after", type: "paragraph", text: "and me" },
      ]),
    );
    expect(result).not.toBeNull();
    const ws = result!.workspace;
    expect(ws.pages[0].blocks.map((b) => b.id)).toEqual(["before", "q", "after"]);
    const q = quizOf(ws, 1);
    expect(q.questions).toHaveLength(4);
    const [mcq, tf, short, noId] = q.questions;
    expect(mcq.kind).toBe("mcq");
    expect(mcq.choices).toHaveLength(MAX_QUIZ_CHOICES);
    expect(mcq.answerIndex).toBeUndefined();
    expect(tf).toEqual({ id: "2", kind: "true_false", prompt: "T?", answerBool: true });
    expect(short.prompt).toBe("42");
    expect(short.answerText).toHaveLength(MAX_QUIZ_TEXT);
    expect(typeof noId.id).toBe("string");
    expect(q.attempts).toHaveLength(MAX_QUIZ_ATTEMPTS);
    expect(q.attempts!.at(-1)!.at).toBe(`n${MAX_QUIZ_ATTEMPTS + 2}`);
    expect(safeParseWorkspace(ws).success).toBe(true);
  });

  it("splits an oversized quiz into several, keeping every question", () => {
    const questions = Array.from({ length: MAX_QUIZ_QUESTIONS + 10 }, (_, i) => ({
      id: `q${i}`,
      kind: "true_false",
      prompt: `Q${i}`,
      answerBool: true,
    }));
    const result = repairWorkspace(
      withBlocks([{ id: "big", type: "quiz", questions, attempts: [{ at: "t", mode: "exam", score: 1, total: 1 }] }]),
    );
    const blocks = result!.workspace.pages[0].blocks as QuizBlock[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).toBe("big");
    expect(blocks[0].questions).toHaveLength(MAX_QUIZ_QUESTIONS);
    expect(blocks[1].questions).toHaveLength(10);
    expect(blocks[0].attempts).toHaveLength(1);
    expect(blocks[1].attempts).toBeUndefined();
  });

  it("drops a quiz with no usable questions array only down to an empty quiz", () => {
    const result = repairWorkspace(withBlocks([{ id: "q", type: "quiz", questions: "nope" }]));
    expect(quizOf(result!.workspace).questions).toEqual([]);
  });
});
