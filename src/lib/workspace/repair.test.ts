import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "./sample";
import {
  InvalidWorkspaceError,
  MAX_WORKSPACE_BYTES,
  WorkspaceTooLargeError,
  prepareWorkspaceForSave,
  repairWorkspace,
} from "./repair";
import { MAX_FLASHCARDS, MAX_FLASHCARD_TEXT, safeParseWorkspace } from "./schema";
import type { Workspace } from "./types";

function base(): Workspace {
  return {
    id: "ws-1",
    name: "Semester",
    pages: [
      {
        id: "p1",
        title: "Biology",
        blocks: [
          { id: "b1", type: "heading", level: 1, text: "Biology" },
          { id: "b2", type: "paragraph", text: "Cells" },
        ],
      },
    ],
    databases: [
      {
        id: "db1",
        name: "Tasks",
        properties: [
          { id: "name", name: "Name", type: "text" },
          { id: "due", name: "Due", type: "date" },
        ],
        rows: [{ id: "r1", cells: { name: "Lab report", due: "2026-11-20" } }],
        views: [{ id: "v1", name: "Table", type: "table" }],
      },
    ],
  };
}

/** Save then load, exactly as the store does. */
function roundTrip(ws: unknown) {
  const { data } = prepareWorkspaceForSave(ws, "ws-1");
  return repairWorkspace(JSON.parse(data), { id: "ws-1" });
}

describe("repairWorkspace", () => {
  it("returns a valid document unchanged", () => {
    const result = repairWorkspace(sampleWorkspace);
    expect(result?.issues).toEqual([]);
    expect(result?.workspace).toEqual(sampleWorkspace);
  });

  it("round-trips a flashcard with an empty side through save and load", () => {
    const ws = base();
    ws.pages[0].blocks.push({
      id: "deck",
      type: "flashcards",
      title: "Deck",
      cards: [
        { id: "c1", front: "", back: "" },
        { id: "c2", front: "ATP?", back: "" },
      ],
    });
    const loaded = roundTrip(ws);
    expect(loaded?.issues).toEqual([]);
    expect(loaded?.workspace).toEqual(ws);
  });

  it("loads a document with one invalid block and keeps everything else", () => {
    const ws = base() as unknown as { pages: { blocks: unknown[] }[] };
    ws.pages[0].blocks.splice(1, 0, {
      id: "bad",
      type: "react_artifact",
      source: "",
    });
    const result = repairWorkspace(ws, { id: "ws-1" });
    expect(result).not.toBeNull();
    expect(result!.workspace.pages[0].blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(result!.workspace.databases).toEqual(base().databases);
    expect(result!.issues.length).toBeGreaterThan(0);
  });

  it("repairs fixable fields instead of dropping the block", () => {
    const ws = base() as unknown as { pages: { blocks: unknown[] }[] };
    ws.pages[0].blocks = [
      { id: "h", type: "heading", level: 7, text: 42 },
      { id: "t", type: "todo", text: "Read ch. 3" },
      { id: "u", type: "mystery_widget", text: "kept words" },
      { id: "x", type: "mystery_widget" },
      "not a block",
    ];
    const result = repairWorkspace(ws)!;
    expect(result.workspace.pages[0].blocks).toEqual([
      { id: "h", type: "heading", level: 2, text: "42" },
      { id: "t", type: "todo", text: "Read ch. 3", checked: false },
      { id: "u", type: "paragraph", text: "kept words" },
    ]);
  });

  it("splits an oversized deck instead of losing cards, and trims overlong text", () => {
    const cards = Array.from({ length: MAX_FLASHCARDS + 5 }, (_, i) => ({
      id: `c${i}`,
      front: i === 0 ? "x".repeat(MAX_FLASHCARD_TEXT + 10) : `Q${i}`,
      back: "A",
    }));
    const ws = base() as unknown as { pages: { blocks: unknown[] }[] };
    ws.pages[0].blocks = [{ id: "deck", type: "flashcards", title: "Big", cards }];
    const result = repairWorkspace(ws)!;
    const decks = result.workspace.pages[0].blocks;
    expect(decks).toHaveLength(2);
    const all = decks.flatMap((d) => (d.type === "flashcards" ? d.cards : []));
    expect(all).toHaveLength(MAX_FLASHCARDS + 5);
    expect(all[0].front).toHaveLength(MAX_FLASHCARD_TEXT);
    expect(decks[0].id).toBe("deck");
  });

  it("drops only the bad cells, properties and views of a database", () => {
    const ws = base() as unknown as { databases: Record<string, unknown>[] };
    ws.databases[0].properties = [
      { id: "name", name: "Name", type: "text" },
      { id: "weird", name: "Weird", type: "formula" },
      { name: "No id", type: "text" },
    ];
    ws.databases[0].rows = [
      { id: "r1", cells: { name: "Lab", due: { nested: true }, tags: ["a", 3] } },
      { cells: { name: "No id row" } },
    ];
    ws.databases[0].views = [
      { id: "v1", name: "Table", type: "spreadsheet", sorts: [{ propertyId: "name", direction: "sideways" }] },
      { name: "no id", type: "table" },
    ];
    const db = repairWorkspace(ws)!.workspace.databases[0];
    expect(db.properties).toEqual([
      { id: "name", name: "Name", type: "text" },
      { id: "weird", name: "Weird", type: "text" },
    ]);
    expect(db.rows[0]).toEqual({ id: "r1", cells: { name: "Lab", tags: ["a"] } });
    expect(db.rows[1].cells).toEqual({ name: "No id row" });
    expect(typeof db.rows[1].id).toBe("string");
    expect(db.views).toEqual([{ id: "v1", name: "Table", type: "table", sorts: [] }]);
  });

  it("drops a dangling homePageId and fills a missing name from the row", () => {
    const ws = { ...base(), homePageId: "gone" } as Record<string, unknown>;
    delete ws.name;
    const result = repairWorkspace(ws, { name: "From row" })!;
    expect(result.workspace.name).toBe("From row");
    expect(result.workspace.homePageId).toBeUndefined();
  });

  it("returns null only for something that is not a workspace", () => {
    expect(repairWorkspace(null)).toBeNull();
    expect(repairWorkspace("text")).toBeNull();
    expect(repairWorkspace([])).toBeNull();
    expect(repairWorkspace({})?.workspace).toMatchObject({ pages: [], databases: [] });
  });
});

describe("prepareWorkspaceForSave", () => {
  it("never writes something the loader would reject", () => {
    const ws = base() as unknown as { pages: { blocks: unknown[] }[] };
    ws.pages[0].blocks.push({ id: "m", type: "media" });
    const { data, repaired } = prepareWorkspaceForSave(ws, "ws-1");
    expect(repaired).toBe(true);
    expect(safeParseWorkspace(JSON.parse(data)).success).toBe(true);
  });

  it("forces the row id onto the document", () => {
    const { workspace } = prepareWorkspaceForSave({ ...base(), id: "other" }, "ws-1");
    expect(workspace.id).toBe("ws-1");
  });

  it("rejects non-workspaces and oversized documents", () => {
    expect(() => prepareWorkspaceForSave("nope", "ws-1")).toThrow(InvalidWorkspaceError);
    const big = base();
    big.pages[0].blocks.push({
      id: "huge",
      type: "paragraph",
      text: "x".repeat(MAX_WORKSPACE_BYTES),
    });
    expect(() => prepareWorkspaceForSave(big, "ws-1")).toThrow(WorkspaceTooLargeError);
  });
});

describe("repair is identity on valid documents and deterministic (finding 13)", () => {
  it("keeps a valid document byte for byte, including key order and unknown fields", () => {
    const ws = {
      name: "W",
      id: "ws-1",
      settings: { theme: "dark" },
      databases: [],
      pages: [{ blocks: [{ text: "hi", type: "paragraph", id: "b1", color: "red" }], title: "P", id: "p1", cover: "c" }],
    };
    const before = JSON.stringify(ws);
    const { data } = prepareWorkspaceForSave(ws, "ws-1");
    expect(data).toBe(before);
    expect(JSON.stringify(roundTrip(ws)!.workspace)).toBe(before);
  });

  it("keeps fields it does not know while repairing something else", () => {
    const ws = {
      ...base(),
      settings: { weekStartsOn: 1 },
      pages: [
        {
          id: "p1",
          title: "Biology",
          cover: "forest",
          blocks: [
            { id: "b1", type: "heading", level: 7, text: "Biology", color: "red" },
            { id: "b2", type: "paragraph", text: "Cells", highlight: true },
          ],
        },
      ],
    };
    const result = repairWorkspace(ws)!;
    expect(result.issues.length).toBeGreaterThan(0);
    const out = result.workspace as unknown as typeof ws;
    expect(out.settings).toEqual({ weekStartsOn: 1 });
    expect(out.pages[0].cover).toBe("forest");
    expect(out.pages[0].blocks[0]).toEqual({ id: "b1", type: "heading", level: 2, text: "Biology", color: "red" });
    expect(out.pages[0].blocks[1]).toMatchObject({ highlight: true });
    // ...and saving keeps them too.
    expect(JSON.parse(prepareWorkspaceForSave(ws, "ws-1").data).settings).toEqual({ weekStartsOn: 1 });
  });

  it("does not bring back a known field it had to remove", () => {
    const ws = base() as unknown as { pages: { blocks: Record<string, unknown>[] }[] };
    ws.pages[0].blocks.push({
      id: "deck",
      type: "flashcards",
      cards: [{ id: "c", front: "a", back: "b", stability: -1 }],
    });
    const deck = repairWorkspace(ws)!.workspace.pages[0].blocks[2] as unknown as {
      cards: Record<string, unknown>[];
    };
    expect(deck.cards[0]).not.toHaveProperty("stability");
  });

  it("gives an oversized deck's parts and an id-less block the same ids on every load", () => {
    const cards = Array.from({ length: MAX_FLASHCARDS + 50 }, (_, i) => ({ id: `c${i}`, front: "f", back: "b" }));
    const ws = {
      id: "ws-1",
      name: "W",
      databases: [],
      pages: [
        {
          id: "p",
          title: "t",
          blocks: [
            { id: "deck", type: "flashcards", cards },
            { type: "paragraph", text: "no id" },
          ],
        },
      ],
    };
    const ids = () => repairWorkspace(structuredClone(ws))!.workspace.pages[0].blocks.map((b) => b.id);
    const first = ids();
    expect(first).toHaveLength(3);
    expect(first[0]).toBe("deck");
    expect(first[1]).toBe("deck-part2");
    expect(ids()).toEqual(first);
    // Repair stays idempotent.
    const once = repairWorkspace(ws)!.workspace;
    expect(repairWorkspace(once)!.workspace).toEqual(once);
  });
});
