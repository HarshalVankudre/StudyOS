import { describe, expect, it } from "vitest";
import { applyAgentOps, agentOpSchema } from "./agent-ops";
import type { Workspace } from "@/lib/workspace/types";
import { safeParseWorkspace } from "@/lib/workspace/schema";

function ws(): Workspace {
  return {
    id: "w",
    name: "W",
    pages: [{ id: "p", title: "Home", blocks: [] }],
    databases: [
      {
        id: "db",
        name: "Assignments",
        properties: [
          { id: "title", name: "Title", type: "text" },
          { id: "due", name: "Due", type: "date" },
          {
            id: "status",
            name: "Status",
            type: "status",
            options: [
              { id: "todo", label: "Not started" },
              { id: "done", label: "Done" },
            ],
          },
        ],
        rows: [],
        views: [
          {
            id: "v",
            name: "All",
            type: "table",
            sorts: [{ propertyId: "title", direction: "asc" }],
            filters: [{ propertyId: "status", operator: "is", value: "todo" }],
            filterMatch: "any",
            visiblePropertyIds: ["title", "due"],
          },
        ],
      },
    ],
  };
}

const view = (w: Workspace) => w.databases[0].views[0];

describe("update_view merges instead of replacing", () => {
  it("a rename keeps the saved sorts, filters and columns", () => {
    const next = applyAgentOps(ws(), [
      agentOpSchema.parse({ op: "update_view", databaseId: "db", view: { id: "v", name: "Mine" } }),
    ]);
    expect(view(next)).toEqual({ ...view(ws()), name: "Mine" });
  });

  it("an old-style full view without the new fields keeps the saved filters and sorts", () => {
    const next = applyAgentOps(ws(), [
      agentOpSchema.parse({
        op: "update_view",
        databaseId: "db",
        view: { id: "v", name: "All", type: "board", groupByPropertyId: "status" },
      }),
    ]);
    expect(view(next).type).toBe("board");
    expect(view(next).sorts).toEqual(view(ws()).sorts);
    expect(view(next).filters).toEqual(view(ws()).filters);
  });

  it('"sort by due date" replaces only the sort', () => {
    const next = applyAgentOps(ws(), [
      agentOpSchema.parse({
        op: "update_view",
        databaseId: "db",
        view: { id: "v", sorts: [{ propertyId: "due", direction: "asc" }] },
      }),
    ]);
    expect(view(next).sorts).toEqual([{ propertyId: "due", direction: "asc" }]);
    expect(view(next).filters).toEqual(view(ws()).filters);
    expect(safeParseWorkspace(next).success).toBe(true);
  });

  it("null removes a field and [] clears a list", () => {
    const next = applyAgentOps(ws(), [
      agentOpSchema.parse({
        op: "update_view",
        databaseId: "db",
        view: { id: "v", visiblePropertyIds: null, filters: [], filterMatch: null },
      }),
    ]);
    expect(view(next)).not.toHaveProperty("visiblePropertyIds");
    expect(view(next)).not.toHaveProperty("filterMatch");
    expect(view(next).filters).toEqual([]);
    expect(view(next).sorts).toEqual(view(ws()).sorts);
  });

  it('"show me only what\'s due this week" (upcoming preset) builds the saved filter', () => {
    const next = applyAgentOps(ws(), [
      agentOpSchema.parse({
        op: "update_view",
        databaseId: "db",
        view: { id: "v", name: "This week" },
        preset: { kind: "upcoming", days: 7 },
      }),
    ]);
    expect(view(next)).toMatchObject({
      name: "This week",
      datePropertyId: "due",
      filterMatch: "all",
      filters: [
        { propertyId: "due", operator: "next_days", value: 7 },
        { propertyId: "status", operator: "is_not", value: ["done"] },
      ],
      sorts: [{ propertyId: "due", direction: "asc" }],
      visiblePropertyIds: ["title", "due"],
    });
    expect(safeParseWorkspace(next).success).toBe(true);
  });

  it("add_view with a preset; explicit fields win over the preset", () => {
    const next = applyAgentOps(ws(), [
      agentOpSchema.parse({
        op: "add_view",
        databaseId: "db",
        view: { id: "v2", name: "Soon", type: "list", sorts: [{ propertyId: "title", direction: "desc" }] },
        preset: { kind: "upcoming", days: 3 },
      }),
    ]);
    const added = next.databases[0].views[1];
    expect(added.filters?.[0]).toEqual({ propertyId: "due", operator: "next_days", value: 3 });
    expect(added.sorts).toEqual([{ propertyId: "title", direction: "desc" }]);
  });

  it("a preset on a database without a date column is refused with a clear error", () => {
    const w = ws();
    w.databases[0].properties = w.databases[0].properties.filter((p) => p.type !== "date");
    expect(() =>
      applyAgentOps(w, [
        agentOpSchema.parse({ op: "update_view", databaseId: "db", view: { id: "v" }, preset: { kind: "upcoming" } }),
      ]),
    ).toThrow(/date property/);
  });

  it("rejects an unknown filter operator at the schema boundary", () => {
    expect(
      agentOpSchema.safeParse({
        op: "update_view",
        databaseId: "db",
        view: { id: "v", filters: [{ propertyId: "due", operator: "this_week" }] },
      }).success,
    ).toBe(false);
  });
});
