import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/workspace/types";
import { describeValue } from "./mergeDetails";

const workspace: Workspace = {
  id: "w",
  name: "W",
  pages: [
    {
      id: "p1",
      title: "Biology",
      blocks: [{ id: "t1", type: "todo", text: "Read chapter three", checked: false }],
    },
  ],
  databases: [
    {
      id: "d1",
      name: "Assignments",
      properties: [
        { id: "n", name: "Name", type: "text" },
        { id: "due", name: "Due", type: "date" },
        {
          id: "st",
          name: "Status",
          type: "select",
          options: [
            { id: "o1", label: "To do", color: "gray" },
            { id: "o2", label: "Done", color: "green" },
          ],
        },
      ],
      rows: [{ id: "r1", cells: { n: "Essay 2", due: "2026-11-20", st: "o1" } }],
      views: [{ id: "v1", name: "All", type: "table" }],
    },
  ],
} as Workspace;

const cell = (prop: string) => ["databases", { id: "d1" }, "rows", { id: "r1" }, "cells", prop];

describe("naming a value for the merge banner", () => {
  it("names a cell by its row and column, with the values as a person reads them", () => {
    expect(describeValue(workspace, { path: cell("due"), mine: "2026-11-20", theirs: "2026-12-12" })).toEqual({
      where: "Essay 2 · Due",
      mine: "2026-11-20",
      theirs: "2026-12-12",
    });
    // A choice shows its label, not its id; nothing shows as a dash.
    expect(describeValue(workspace, { path: cell("st"), mine: "o2", theirs: undefined })).toEqual({
      where: "Essay 2 · Status",
      mine: "Done",
      theirs: "—",
    });
  });

  it("names a value in a block by the block's text, else the page", () => {
    const path = ["pages", { id: "p1" }, "blocks", { id: "t1" }, "checked"];
    expect(describeValue(workspace, { path, mine: true, theirs: false })).toEqual({
      where: "Read chapter three",
      mine: "true",
      theirs: "false",
    });
    const gone = ["pages", { id: "p1" }, "blocks", { id: "nope" }, "checked"];
    expect(describeValue(workspace, { path: gone, mine: true, theirs: false }).where).toBe("Biology");
  });

  it("has no name for what a student would not recognise, and clips long values", () => {
    expect(describeValue(workspace, { path: ["name"], mine: "A", theirs: "B" }).where).toBeNull();
    const long = "x".repeat(200);
    expect(describeValue(workspace, { path: cell("n"), mine: long, theirs: "short" }).mine.length).toBeLessThanOrEqual(60);
    expect(describeValue(workspace, { path: cell("gone"), mine: { a: 1 }, theirs: 2 })).toMatchObject({ mine: "…", theirs: "2" });
  });
});
