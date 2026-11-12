import { describe, expect, it } from "vitest";
import { applyAgentOps, agentOpsSchema } from "./agent-ops";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { QuizBlock, Workspace } from "@/lib/workspace/types";

/**
 * The AI authors and edits quizzes through the same path as every block: a
 * `set_page_blocks` (or add/replace page) op validated against blockSchema,
 * plus quiz-specific checks in applyAgentOps.
 */
function baseWorkspace(): Workspace {
  return {
    id: "w1",
    name: "WS",
    pages: [
      {
        id: "p1",
        title: "Bio",
        blocks: [
          {
            id: "quiz1",
            type: "quiz",
            title: "Cells",
            questions: [
              {
                id: "q1",
                kind: "mcq",
                prompt: "Powerhouse of the cell?",
                choices: ["Nucleus", "Mitochondria"],
                answerIndex: 1,
                stats: { attempts: 5, correct: 2, lastAnsweredAt: "2026-11-10T09:00:00.000Z" },
              },
              // A student's half-written question.
              { id: "draft", kind: "mcq", prompt: "Which organelle", choices: ["", ""] },
            ],
            attempts: [{ at: "2026-11-10T09:00:00.000Z", mode: "exam", score: 1, total: 1 }],
          },
        ],
      },
    ],
    databases: [],
  };
}

const quiz = (ws: Workspace, pageIndex = 0, blockIndex = 0) => ws.pages[pageIndex].blocks[blockIndex] as QuizBlock;

describe("agent quiz authoring", () => {
  it("creates a quiz block with every question kind", () => {
    const ops = agentOpsSchema.parse([
      {
        op: "add_page",
        page: {
          id: "p2",
          title: "Chem quiz",
          blocks: [
            {
              id: "quiz2",
              type: "quiz",
              title: "Acids",
              questions: [
                { id: "a", kind: "mcq", prompt: "pH of water?", choices: ["5", "7", "9"], answerIndex: 1, explanation: "Neutral." },
                { id: "b", kind: "true_false", prompt: "HCl is a strong acid.", answerBool: true },
                { id: "c", kind: "short", prompt: "Define a buffer.", answerText: "A solution that resists pH change." },
              ],
            },
          ],
        },
      },
    ]);
    const next = applyAgentOps(baseWorkspace(), ops);
    expect(safeParseWorkspace(next).success).toBe(true);
    expect(quiz(next, 1).questions.map((q) => q.kind)).toEqual(["mcq", "true_false", "short"]);
  });

  it("edits a quiz without losing the student's stats, attempts or half-written question", () => {
    const ops = agentOpsSchema.parse([
      {
        op: "set_page_blocks",
        pageId: "p1",
        blocks: [
          {
            id: "quiz1",
            type: "quiz",
            title: "Cells (revised)",
            questions: [
              { id: "q1", kind: "mcq", prompt: "Which organelle makes ATP?", choices: ["Nucleus", "Mitochondria", "Ribosome"], answerIndex: 1 },
              { id: "draft", kind: "mcq", prompt: "Which organelle", choices: ["", ""] },
              { id: "q3", kind: "true_false", prompt: "Plant cells have walls.", answerBool: true },
            ],
          },
        ],
      },
    ]);
    const next = applyAgentOps(baseWorkspace(), ops);
    const q = quiz(next);
    expect(q.title).toBe("Cells (revised)");
    expect(q.questions[0].stats).toEqual({ attempts: 5, correct: 2, lastAnsweredAt: "2026-11-10T09:00:00.000Z" });
    expect(q.attempts).toHaveLength(1);
    expect(q.questions[1].id).toBe("draft");
    expect(safeParseWorkspace(next).success).toBe(true);
  });

  it("refuses a question the agent wrote with a wrong answer index, with an error it can fix", () => {
    const ops = agentOpsSchema.parse([
      {
        op: "set_page_blocks",
        pageId: "p1",
        blocks: [
          {
            id: "quiz9",
            type: "quiz",
            questions: [{ id: "x", kind: "mcq", prompt: "2+2?", choices: ["3", "4"], answerIndex: 2 }],
          },
        ],
      },
    ]);
    expect(() => applyAgentOps(baseWorkspace(), ops)).toThrow(/quiz "quiz9" question "x".*answerIndex/);
  });

  it("rejects malformed quiz payloads at the schema", () => {
    expect(() =>
      agentOpsSchema.parse([
        {
          op: "set_page_blocks",
          pageId: "p1",
          blocks: [{ id: "q", type: "quiz", questions: [{ id: "x", kind: "essay", prompt: "?" }] }],
        },
      ]),
    ).toThrow();
    expect(() =>
      agentOpsSchema.parse([
        {
          op: "set_page_blocks",
          pageId: "p1",
          blocks: [{ id: "q", type: "quiz", questions: [{ id: "x", kind: "mcq", prompt: "?", choices: ["1", "2", "3", "4", "5", "6", "7"] }] }],
        },
      ]),
    ).toThrow();
  });
});
