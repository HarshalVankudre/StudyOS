import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { createWorkspaceStreamScanner, type WorkspaceStreamEvent } from "./workspace-stream";

function scan(chunks: string[]) {
  const events: WorkspaceStreamEvent[] = [];
  const scanner = createWorkspaceStreamScanner((event) => events.push(event));
  for (const chunk of chunks) scanner.push(chunk);
  return { events, scanner };
}

describe("createWorkspaceStreamScanner", () => {
  it("reports databases, their rows and pages as the JSON streams in, in any chunking", () => {
    const json = JSON.stringify(sampleWorkspace);
    const whole = scan([json]).events;
    // Character by character gives the same result as one chunk.
    expect(scan([...json]).events).toEqual(whole);
    expect(whole.filter((e) => e.type === "database").map((e) => e.type === "database" && e.name)).toEqual([
      "Courses",
      "Assignments",
      "Reading List",
    ]);
    const lastRows = whole.filter((e) => e.type === "rows" && e.database === "Assignments").at(-1);
    expect(lastRows).toEqual({ type: "rows", database: "Assignments", count: 8 });
    expect(whole.filter((e) => e.type === "page").map((e) => e.type === "page" && e.title)).toEqual(
      sampleWorkspace.pages.map((p) => p.title),
    );
  });

  it("is not fooled by names, braces and quotes inside strings", () => {
    const tricky = {
      name: "WS",
      databases: [
        {
          id: "d",
          name: "Labs \"{ }\"",
          properties: [{ id: "name", name: "not a database" }],
          rows: [{ id: "r", cells: { name: "] } {" } }],
          views: [],
        },
      ],
      pages: [{ id: "p", title: "Notes", blocks: [{ id: "b", type: "paragraph", text: "title" }] }],
    };
    const { events, scanner } = scan([JSON.stringify(tricky)]);
    expect(events).toEqual([
      { type: "database", name: 'Labs "{ }"' },
      { type: "rows", database: 'Labs "{ }"', count: 1 },
      { type: "page", title: "Notes" },
    ]);
    expect(scanner.chars).toBe(JSON.stringify(tricky).length);
  });

  it("never throws on broken output", () => {
    expect(() => scan(["]]]}}}", '{"databases":[{"name":', "\\", '"x'])).not.toThrow();
  });
});
