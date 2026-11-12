/**
 * Runtime validation for a Workspace, mirroring the types in `types.ts`.
 *
 * The AI returns free-form JSON; this is the gate that guarantees it actually
 * matches our data model before the renderer ever sees it. Also reusable for
 * validating imported or persisted workspaces later.
 */
import { z } from "zod";
import type { Workspace } from "./types";

/** Max bytes of a react_artifact component source (larger than a text field). */
export const MAX_COMPONENT_SOURCE = 100_000;

/** Bounds for a flashcard deck (agent- and user-authored). */
export const MAX_FLASHCARDS = 200;
export const MAX_FLASHCARD_TEXT = 2_000;

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

const viewSort = z.object({
  propertyId: z.string(),
  direction: z.enum(["asc", "desc"]),
});

const viewFilter = z.object({
  propertyId: z.string(),
  operator: z.enum([
    "contains",
    "not_contains",
    "is",
    "is_not",
    "is_empty",
    "is_not_empty",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "before",
    "after",
    "on_or_before",
    "on_or_after",
    "next_days",
    "past_days",
    "overdue",
  ]),
  value: cellValue.optional(),
});

const databaseView = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["table", "board", "calendar", "list", "gallery"]),
  groupByPropertyId: z.string().optional(),
  datePropertyId: z.string().optional(),
  visiblePropertyIds: z.array(z.string()).optional(),
  sorts: z.array(viewSort).optional(),
  filters: z.array(viewFilter).optional(),
  filterMatch: z.enum(["all", "any"]).optional(),
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

// Blank sides are allowed: a student adds a card and then types into it, and
// autosave runs in between. Study sessions skip cards with an empty side.
const flashcard = z.object({
  id: z.string(),
  front: z.string().max(MAX_FLASHCARD_TEXT),
  back: z.string().max(MAX_FLASHCARD_TEXT),
  ease: z.number().optional(),
  intervalDays: z.number().optional(),
  reps: z.number().int().optional(),
  dueAt: z.string().optional(),
  lastReviewedAt: z.string().optional(),
  // FSRS scheduling state (lib/study/srs.ts); optional so older decks and
  // AI-authored cards stay valid.
  stability: z.number().nonnegative().optional(),
  difficulty: z.number().optional(),
  state: z.enum(["new", "learning", "review", "relearning"]).optional(),
  lapses: z.number().int().nonnegative().optional(),
  learningStep: z.number().int().nonnegative().optional(),
  dueTime: z.string().optional(),
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
    type: z.literal("media"),
    assetId: z.string(),
    mediaKind: z.literal("image"),
    mime: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    caption: z.string().optional(),
    alt: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("database_view"),
    databaseId: z.string(),
    viewId: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("react_artifact"),
    title: z.string().optional(),
    source: z.string().min(1).max(MAX_COMPONENT_SOURCE),
  }),
  z.object({
    id: z.string(),
    type: z.literal("flashcards"),
    title: z.string().optional(),
    cards: z.array(flashcard).max(MAX_FLASHCARDS),
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

// Re-exported piece schemas so the AI agent's patch operations validate their
// payloads against the exact same shapes the renderer expects.
export {
  cellValue as cellValueSchema,
  databaseProperty as databasePropertySchema,
  databaseRow as databaseRowSchema,
  databaseView as databaseViewSchema,
  viewSort as viewSortSchema,
  viewFilter as viewFilterSchema,
  database as databaseSchema,
  block as blockSchema,
  page as pageSchema,
  selectOption as selectOptionSchema,
  flashcard as flashcardSchema,
};
