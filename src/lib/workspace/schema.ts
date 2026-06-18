/**
 * Runtime validation for a Workspace, mirroring the types in `types.ts`.
 *
 * The AI returns free-form JSON; this is the gate that guarantees it actually
 * matches our data model before the renderer ever sees it. Also reusable for
 * validating imported or persisted workspaces later.
 */
import { z } from "zod";
import type { Workspace } from "./types";

const selectOption = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string().optional(),
});

const databaseProperty = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum([
    "text",
    "number",
    "checkbox",
    "date",
    "select",
    "multi_select",
    "status",
    "url",
    "relation",
  ]),
  options: z.array(selectOption).optional(),
  relationDatabaseId: z.string().optional(),
});

const cellValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

const databaseRow = z.object({
  id: z.string(),
  cells: z.record(z.string(), cellValue),
});

const databaseView = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["table", "board", "calendar", "list", "gallery"]),
  groupByPropertyId: z.string().optional(),
  datePropertyId: z.string().optional(),
  visiblePropertyIds: z.array(z.string()).optional(),
});

const database = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
  properties: z.array(databaseProperty),
  rows: z.array(databaseRow),
  views: z.array(databaseView),
});

const block = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("heading"),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string(),
  }),
  z.object({ id: z.string(), type: z.literal("paragraph"), text: z.string() }),
  z.object({
    id: z.string(),
    type: z.literal("todo"),
    text: z.string(),
    checked: z.boolean(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("bulleted_list_item"),
    text: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("numbered_list_item"),
    text: z.string(),
  }),
  z.object({ id: z.string(), type: z.literal("quote"), text: z.string() }),
  z.object({
    id: z.string(),
    type: z.literal("callout"),
    text: z.string(),
    emoji: z.string().optional(),
  }),
  z.object({ id: z.string(), type: z.literal("divider") }),
  z.object({
    id: z.string(),
    type: z.literal("database_view"),
    databaseId: z.string(),
    viewId: z.string(),
  }),
]);

const page = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().optional(),
  blocks: z.array(block),
});

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  pages: z.array(page),
  databases: z.array(database),
  homePageId: z.string().optional(),
});

/** Validate unknown data and return it as a typed Workspace ({ success, ... }). */
export function safeParseWorkspace(data: unknown) {
  return workspaceSchema.safeParse(data) as
    | { success: true; data: Workspace }
    | { success: false; error: z.ZodError };
}
