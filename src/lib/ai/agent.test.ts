import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { workspaceAreas } from "./agent";

describe("workspaceAreas", () => {
  it("lists every page, then every database, with its id, label and icon", () => {
    const areas = workspaceAreas(sampleWorkspace);
    expect(areas).toHaveLength(sampleWorkspace.pages.length + sampleWorkspace.databases.length);
    expect(areas[0]).toEqual({
      id: sampleWorkspace.pages[0].id,
      type: "page",
      label: sampleWorkspace.pages[0].title,
      icon: sampleWorkspace.pages[0].icon,
    });
    const firstDb = areas[sampleWorkspace.pages.length];
    expect(firstDb).toMatchObject({
      id: sampleWorkspace.databases[0].id,
      type: "database",
      label: sampleWorkspace.databases[0].name,
    });
  });
});
