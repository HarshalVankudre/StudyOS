import { describe, expect, it } from "vitest";
import { createToolRegistry, type ToolContext } from "./registry";
import { registerWorkspaceTools } from "./workspace-tools";

const WS = JSON.stringify({
  id: "ws1", name: "My Studies",
  databases: [{ id: "db1", name: "Courses", properties: [], rows: [{ id: "r1", cells: {} }], views: [] }],
  pages: [{ id: "p1", title: "Home", blocks: [] }],
});
const ctx: ToolContext = { taskId: "t1", workspaceJson: WS };

function reg() {
  const r = createToolRegistry();
  registerWorkspaceTools(r);
  return r;
}

describe("workspace tools", () => {
  it("summarize_workspace returns counts", async () => {
    const out = (await reg().run("summarize_workspace", {}, ctx)) as { summary: string };
    expect(out.summary).toContain("1 database");
    expect(out.summary).toContain("1 page");
  });

  it("find_entities matches by label substring", async () => {
    const out = (await reg().run("find_entities", { query: "cours" }, ctx)) as {
      matches: { id: string }[];
    };
    expect(out.matches.some((m) => m.id === "db1")).toBe(true);
  });

  it("read_area returns the page json", async () => {
    const out = (await reg().run("read_area", { id: "p1" }, ctx)) as {
      kind: string; json: string;
    };
    expect(out.kind).toBe("page");
    expect(out.json).toContain("Home");
  });

  it("apply_ops validates a good op and rejects a bad one", async () => {
    const good = (await reg().run(
      "apply_ops",
      { ops: [{ op: "update_page", pageId: "p1", title: "Renamed" }] },
      ctx,
    )) as { ok: boolean; opCount: number };
    expect(good.ok).toBe(true);
    expect(good.opCount).toBe(1);

    const bad = (await reg().run(
      "apply_ops",
      { ops: [{ op: "update_page", pageId: "missing", title: "x" }] },
      ctx,
    )) as { ok: boolean; error?: string };
    expect(bad.ok).toBe(false);
  });
});
