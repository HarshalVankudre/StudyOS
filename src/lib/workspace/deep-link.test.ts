import { describe, expect, it } from "vitest";
import { readDeepLinkParams, resolveDeepLink, workspaceHref } from "./deep-link";
import type { Workspace } from "./types";

const ws: Workspace = {
  id: "ws",
  name: "HQ",
  homePageId: "home",
  pages: [
    { id: "home", title: "Home", blocks: [{ id: "intro", type: "paragraph", text: "hi" }] },
    {
      id: "notes",
      title: "Notes",
      blocks: [
        { id: "todo-1", type: "todo", text: "Read", checked: false },
        { id: "view", type: "database_view", databaseId: "tasks", viewId: "v" },
      ],
    },
  ],
  databases: [
    {
      id: "tasks",
      name: "Tasks",
      properties: [{ id: "t", name: "Name", type: "text" }],
      rows: [{ id: "row-1", cells: { t: "Essay" } }],
      views: [{ id: "v", name: "Table", type: "table" }],
    },
  ],
};

const params = (query: string) => readDeepLinkParams(new URLSearchParams(query));

describe("workspace deep links", () => {
  it("builds the shared URL contract", () => {
    expect(workspaceHref({ workspaceId: "ws" })).toBe("/app/ws");
    expect(workspaceHref({ workspaceId: "ws", pageId: "notes" })).toBe("/app/ws?page=notes");
    expect(workspaceHref({ workspaceId: "ws", pageId: "notes", blockId: "todo-1" })).toBe(
      "/app/ws?page=notes&block=todo-1",
    );
    expect(
      workspaceHref({ workspaceId: "ws", pageId: "notes", databaseId: "tasks", rowId: "row-1" }),
    ).toBe("/app/ws?page=notes&db=tasks&row=row-1");
    expect(workspaceHref({ workspaceId: "a b", pageId: "p&q" })).toBe("/app/a%20b?page=p%26q");
  });

  it("opens the named page and the block on it", () => {
    expect(resolveDeepLink(ws, params("page=notes&block=todo-1"))).toEqual({
      pageId: "notes",
      pageFound: true,
      focus: { kind: "block", blockId: "todo-1" },
    });
  });

  it("opens a row on the page that shows its database", () => {
    expect(resolveDeepLink(ws, params("page=notes&db=tasks&row=row-1")).focus).toEqual({
      kind: "row",
      databaseId: "tasks",
      rowId: "row-1",
    });
    // Without (or with a wrong) page, the database's page is found.
    expect(resolveDeepLink(ws, params("db=tasks&row=row-1")).pageId).toBe("notes");
    expect(resolveDeepLink(ws, params("page=home&db=tasks&row=row-1")).pageId).toBe("notes");
  });

  it("finds a block whose page id is stale", () => {
    expect(resolveDeepLink(ws, params("page=deleted&block=todo-1"))).toMatchObject({
      pageId: "notes",
      focus: { kind: "block" },
    });
  });

  it("falls back to the home page for unknown targets", () => {
    expect(resolveDeepLink(ws, params(""))).toEqual({ pageId: "home", pageFound: false, focus: null });
    expect(resolveDeepLink(ws, params("page=nope"))).toEqual({ pageId: "home", pageFound: false, focus: null });
    expect(resolveDeepLink(ws, params("page=notes&block=nope"))).toEqual({
      pageId: "notes",
      pageFound: true,
      focus: null,
    });
    expect(resolveDeepLink(ws, params("page=notes&db=tasks&row=gone")).focus).toBeNull();
    // A row link needs both halves.
    expect(params("page=notes&row=row-1")).toEqual({ page: "notes" });
  });
});
