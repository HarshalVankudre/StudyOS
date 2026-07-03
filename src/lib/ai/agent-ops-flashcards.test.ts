import { describe, expect, it } from "vitest";
import { applyAgentOps, agentOpsSchema } from "./agent-ops";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Workspace } from "@/lib/workspace/types";

/**
 * The AI generates flashcard decks through the SAME path as any other block:
 * a `set_page_blocks` op whose blocks validate against blockSchema. This is the
 * end-to-end contract that makes "make me a deck" work — no bespoke tool.
 */
function baseWorkspace(): Workspace {
  return {
    id: "w1",
    name: "WS",
    icon: "🎓",
    pages: [{ id: "p1", title: "Notes", blocks: [] }],
    databases: [],
  };
}

describe("agent flashcards generation via set_page_blocks", () => {
  it("accepts and applies a valid flashcards block op", () => {
    const ops = agentOpsSchema.parse([
      {
        op: "set_page_blocks",
        pageId: "p1",
        blocks: [
          {
            id: "deck1",
            type: "flashcards",
            title: "Photosynthesis",
            cards: [
              { id: "c1", front: "What do plants convert?", back: "Light into chemical energy." },
              { id: "c2", front: "Where does it occur?", back: "In the chloroplasts." },
            ],
          },
        ],
      },
    ]);
    const next = applyAgentOps(baseWorkspace(), ops);
    const parsed = safeParseWorkspace(next);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const block = parsed.data.pages[0].blocks[0];
      expect(block.type).toBe("flashcards");
      expect(block.type === "flashcards" && block.cards).toHaveLength(2);
    }
  });

  it("rejects a deck whose card is missing an answer", () => {
    expect(() =>
      agentOpsSchema.parse([
        {
          op: "set_page_blocks",
          pageId: "p1",
          blocks: [
            {
              id: "deck1",
              type: "flashcards",
              cards: [{ id: "c1", front: "Q", back: "" }],
            },
          ],
        },
      ]),
    ).toThrow();
  });
});
