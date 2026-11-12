import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { blockSchema } from "@/lib/workspace/schema";
import type { Block } from "@/lib/workspace/types";
import {
  buildInsertItems,
  continuationKind,
  convertTextBlock,
  duplicateBlock,
  filterInsertItems,
  listNumbers,
  makeTextBlock,
  matchMarkdownShortcut,
  moveBlock,
  moveBlockTo,
  studyKitSlashItems,
  TEXT_KINDS,
  type TextBlock,
} from "./blockOps";

const p = (id: string, text = ""): Block => ({ id, type: "paragraph", text });
const n = (id: string): Block => ({ id, type: "numbered_list_item", text: id });
const ids = (bs: Block[]) => bs.map((b) => b.id);

describe("listNumbers", () => {
  it("counts each run of numbered items and restarts after any other block", () => {
    const blocks = [n("a"), n("b"), n("c"), p("x"), n("d"), n("e"), { id: "h", type: "divider" } as Block, n("f")];
    expect(listNumbers(blocks)).toEqual([1, 2, 3, undefined, 1, 2, undefined, 1]);
  });
});

describe("matchMarkdownShortcut", () => {
  it.each([
    ["# ", "heading1"],
    ["## ", "heading2"],
    ["### ", "heading3"],
    ["- ", "bulleted_list_item"],
    ["* ", "bulleted_list_item"],
    ["1. ", "numbered_list_item"],
    ["[] ", "todo"],
    ["[ ] ", "todo"],
    ["> ", "quote"],
  ])("%j converts to %s and strips the prefix", (prefix, kind) => {
    const text = `${prefix}rest`;
    expect(matchMarkdownShortcut(text, prefix.length)).toEqual(
      expect.objectContaining({ kind, rest: "rest" }),
    );
  });

  it("starts a [x] to-do checked", () => {
    expect(matchMarkdownShortcut("[x] ", 4)).toEqual({ kind: "todo", rest: "", checked: true });
  });

  it("only fires when the caret is right after the prefix", () => {
    expect(matchMarkdownShortcut("- milk", 6)).toBeNull();
    expect(matchMarkdownShortcut("a - b", 4)).toBeNull();
    expect(matchMarkdownShortcut("#hashtag", 1)).toBeNull();
  });
});

describe("conversions", () => {
  it("keeps id and text, and carries shared fields across", () => {
    const todo: TextBlock = { id: "t", type: "todo", text: "Read ch. 3", checked: true };
    const heading = convertTextBlock(todo, "heading2");
    expect(heading).toEqual({ id: "t", type: "heading", level: 2, text: "Read ch. 3" });
    expect(convertTextBlock(todo, "todo")).toEqual(todo);
    const callout = convertTextBlock({ id: "c", type: "callout", text: "x", emoji: "🔥" }, "callout");
    expect(callout).toMatchObject({ emoji: "🔥" });
  });

  it("every kind produces a block the workspace schema accepts", () => {
    for (const kind of TEXT_KINDS) {
      expect(blockSchema.safeParse(makeTextBlock(kind, "hi")).success).toBe(true);
    }
  });

  it("lists continue on Enter; everything else continues as text", () => {
    expect(continuationKind(makeTextBlock("bulleted_list_item"))).toBe("bulleted_list_item");
    expect(continuationKind(makeTextBlock("todo"))).toBe("todo");
    expect(continuationKind(makeTextBlock("numbered_list_item"))).toBe("numbered_list_item");
    expect(continuationKind(makeTextBlock("heading1"))).toBe("paragraph");
    expect(continuationKind(makeTextBlock("quote"))).toBe("paragraph");
  });
});

describe("moving blocks", () => {
  it("moves one step and refuses to leave the page", () => {
    const bs = [p("a"), p("b"), p("c")];
    expect(moveBlock(bs, "b", -1)).toBe(true);
    expect(ids(bs)).toEqual(["b", "a", "c"]);
    expect(moveBlock(bs, "b", -1)).toBe(false);
    expect(moveBlock(bs, "c", 1)).toBe(false);
  });

  it("drops a block before a target index", () => {
    const bs = [p("a"), p("b"), p("c"), p("d")];
    expect(moveBlockTo(bs, "a", 3)).toBe(true);
    expect(ids(bs)).toEqual(["b", "c", "a", "d"]);
    expect(moveBlockTo(bs, "d", 0)).toBe(true);
    expect(ids(bs)).toEqual(["d", "b", "c", "a"]);
    expect(moveBlockTo(bs, "b", 1)).toBe(false); // already there
    expect(moveBlockTo(bs, "b", 2)).toBe(false);
    expect(moveBlockTo(bs, "b", 99)).toBe(true);
    expect(ids(bs)).toEqual(["d", "c", "a", "b"]);
  });
});

describe("duplicateBlock", () => {
  it("copies content under a new id; decks get new card ids and no schedule", () => {
    const deck: Block = {
      id: "d",
      type: "flashcards",
      title: "Bio",
      cards: [{ id: "c1", front: "Q", back: "A", reps: 3, dueAt: "2026-01-01" }],
    };
    const copy = duplicateBlock(deck, "d2");
    expect(copy).toMatchObject({ id: "d2", type: "flashcards", title: "Bio" });
    if (copy.type !== "flashcards") throw new Error("type");
    expect(copy.cards[0]).toEqual({ id: expect.any(String), front: "Q", back: "A" });
    expect(copy.cards[0].id).not.toBe("c1");
    expect(deck.type === "flashcards" && deck.cards[0].reps).toBe(3);
  });
});

describe("insert menu catalogue", () => {
  const items = buildInsertItems(en, fmt, [
    { id: "db1", name: "Assignments", views: [{ id: "v1", name: "Table", type: "table" }] },
  ]);

  it("offers every text kind plus divider, table, flashcards and linked views", () => {
    expect(items.map((i) => i.id)).toEqual([
      ...TEXT_KINDS,
      "divider",
      "database",
      "flashcards",
      "quiz",
      "grades",
      "linked:db1",
    ]);
    expect(items.at(-1)?.label).toBe("Linked view: Assignments");
  });

  it("searches labels and aliases, best matches first", () => {
    expect(filterInsertItems(items, "head").map((i) => i.id)).toEqual([
      "heading1",
      "heading2",
      "heading3",
    ]);
    expect(filterInsertItems(items, "h2")[0].id).toBe("heading2");
    expect(filterInsertItems(items, "todo")[0].id).toBe("todo");
    expect(filterInsertItems(items, "assign")[0].id).toBe("linked:db1");
    expect(filterInsertItems(items, "zzz")).toEqual([]);
    expect(filterInsertItems(items, "")).toHaveLength(items.length);
  });

  it("matches queries of several words, word by word", () => {
    const all = [...items, ...studyKitSlashItems(en, true)];
    expect(filterInsertItems(all, "study kit")[0].id).toBe("study-kit:material");
    expect(filterInsertItems(all, "study  kit ")[0].id).toBe("study-kit:material");
    expect(filterInsertItems(all, "quiz page").map((i) => i.id)).toEqual(["study-kit:page-quiz"]);
    expect(filterInsertItems(all, "linked assign").map((i) => i.id)).toEqual(["linked:db1"]);
    expect(filterInsertItems(all, "heading zzz")).toEqual([]);
  });
});
