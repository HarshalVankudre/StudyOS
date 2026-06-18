/**
 * Patch operations for the in-workspace AI agent.
 *
 * Instead of re-emitting the entire workspace on every edit (thousands of
 * wasted output tokens, slow, fragile), the editor model returns the SMALLEST
 * list of operations that expresses the change. The server applies them to the
 * saved workspace here, then validates the result with `safeParseWorkspace`
 * before it is ever persisted — so a malformed op can never corrupt data.
 */
import { z } from "zod";
import type { Workspace } from "@/lib/workspace/types";
import {
  blockSchema,
  cellValueSchema,
  databasePropertySchema,
  databaseRowSchema,
  databaseSchema,
  databaseViewSchema,
  pageSchema,
} from "@/lib/workspace/schema";

export const agentOpSchema = z.discriminatedUnion("op", [
  // ---- rows (the common case) ----
  z.object({
    op: z.literal("update_row"),
    databaseId: z.string(),
    rowId: z.string(),
    cells: z.record(z.string(), cellValueSchema),
  }),
  z.object({ op: z.literal("add_row"), databaseId: z.string(), row: databaseRowSchema }),
  z.object({ op: z.literal("delete_row"), databaseId: z.string(), rowId: z.string() }),

  // ---- database meta ----
  z.object({
    op: z.literal("update_database"),
    databaseId: z.string(),
    name: z.string().optional(),
    icon: z.string().optional(),
    description: z.string().optional(),
  }),
  z.object({ op: z.literal("add_database"), database: databaseSchema }),
  z.object({ op: z.literal("delete_database"), databaseId: z.string() }),
  // Escape hatch for large single-database restructuring (still one database,
  // not the whole workspace).
  z.object({ op: z.literal("replace_database"), database: databaseSchema }),

  // ---- properties ----
  z.object({ op: z.literal("add_property"), databaseId: z.string(), property: databasePropertySchema }),
  z.object({ op: z.literal("update_property"), databaseId: z.string(), property: databasePropertySchema }),
  z.object({ op: z.literal("delete_property"), databaseId: z.string(), propertyId: z.string() }),

  // ---- views ----
  z.object({ op: z.literal("add_view"), databaseId: z.string(), view: databaseViewSchema }),
  z.object({ op: z.literal("update_view"), databaseId: z.string(), view: databaseViewSchema }),
  z.object({ op: z.literal("delete_view"), databaseId: z.string(), viewId: z.string() }),

  // ---- pages ----
  z.object({ op: z.literal("add_page"), page: pageSchema }),
  z.object({
    op: z.literal("update_page"),
    pageId: z.string(),
    title: z.string().optional(),
    icon: z.string().optional(),
  }),
  z.object({ op: z.literal("delete_page"), pageId: z.string() }),
  z.object({ op: z.literal("set_page_blocks"), pageId: z.string(), blocks: z.array(blockSchema) }),
  z.object({ op: z.literal("replace_page"), page: pageSchema }),

  // ---- workspace root ----
  z.object({
    op: z.literal("update_workspace"),
    name: z.string().optional(),
    icon: z.string().optional(),
    homePageId: z.string().optional(),
  }),
]);

export type AgentOp = z.infer<typeof agentOpSchema>;

/**
 * Apply patch operations to a copy of the workspace and return the result.
 * Throws a descriptive error if an op references an id that doesn't exist, so
 * the route can report exactly what went wrong instead of silently no-op'ing.
 */
export function applyAgentOps(workspace: Workspace, ops: AgentOp[]): Workspace {
  const next: Workspace = structuredClone(workspace);

  const findDb = (id: string) => {
    const db = next.databases.find((d) => d.id === id);
    if (!db) throw new Error(`operation referenced unknown database "${id}"`);
    return db;
  };
  const findPage = (id: string) => {
    const page = next.pages.find((p) => p.id === id);
    if (!page) throw new Error(`operation referenced unknown page "${id}"`);
    return page;
  };

  for (const op of ops) {
    switch (op.op) {
      case "update_row": {
        const db = findDb(op.databaseId);
        const row = db.rows.find((r) => r.id === op.rowId);
        if (!row)
          throw new Error(`update_row referenced unknown row "${op.rowId}" in "${op.databaseId}"`);
        row.cells = { ...row.cells, ...op.cells };
        break;
      }
      case "add_row":
        findDb(op.databaseId).rows.push(op.row);
        break;
      case "delete_row": {
        const db = findDb(op.databaseId);
        db.rows = db.rows.filter((r) => r.id !== op.rowId);
        break;
      }
      case "update_database": {
        const db = findDb(op.databaseId);
        if (op.name !== undefined) db.name = op.name;
        if (op.icon !== undefined) db.icon = op.icon;
        if (op.description !== undefined) db.description = op.description;
        break;
      }
      case "add_database":
        next.databases.push(op.database);
        break;
      case "delete_database":
        next.databases = next.databases.filter((d) => d.id !== op.databaseId);
        break;
      case "replace_database": {
        const index = next.databases.findIndex((d) => d.id === op.database.id);
        if (index === -1) next.databases.push(op.database);
        else next.databases[index] = op.database;
        break;
      }
      case "add_property":
        findDb(op.databaseId).properties.push(op.property);
        break;
      case "update_property": {
        const db = findDb(op.databaseId);
        const index = db.properties.findIndex((p) => p.id === op.property.id);
        if (index === -1) db.properties.push(op.property);
        else db.properties[index] = op.property;
        break;
      }
      case "delete_property": {
        const db = findDb(op.databaseId);
        db.properties = db.properties.filter((p) => p.id !== op.propertyId);
        break;
      }
      case "add_view":
        findDb(op.databaseId).views.push(op.view);
        break;
      case "update_view": {
        const db = findDb(op.databaseId);
        const index = db.views.findIndex((v) => v.id === op.view.id);
        if (index === -1) db.views.push(op.view);
        else db.views[index] = op.view;
        break;
      }
      case "delete_view": {
        const db = findDb(op.databaseId);
        db.views = db.views.filter((v) => v.id !== op.viewId);
        break;
      }
      case "add_page":
        next.pages.push(op.page);
        break;
      case "update_page": {
        const page = findPage(op.pageId);
        if (op.title !== undefined) page.title = op.title;
        if (op.icon !== undefined) page.icon = op.icon;
        break;
      }
      case "delete_page":
        next.pages = next.pages.filter((p) => p.id !== op.pageId);
        break;
      case "set_page_blocks":
        findPage(op.pageId).blocks = op.blocks;
        break;
      case "replace_page": {
        const index = next.pages.findIndex((p) => p.id === op.page.id);
        if (index === -1) next.pages.push(op.page);
        else next.pages[index] = op.page;
        break;
      }
      case "update_workspace":
        if (op.name !== undefined) next.name = op.name;
        if (op.icon !== undefined) next.icon = op.icon;
        if (op.homePageId !== undefined) next.homePageId = op.homePageId;
        break;
    }
  }

  return next;
}
