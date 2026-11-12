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

/** Bounds for a quiz block (agent- and user-authored). */
export const MAX_QUIZ_QUESTIONS = 200;
export const MAX_QUIZ_TEXT = 2_000;
export const MAX_QUIZ_CHOICES = 6;
/** Attempt history kept per quiz block (newest last). */
export const MAX_QUIZ_ATTEMPTS = 20;

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

/** Link from an imported row to its calendar event (types.ts RowSource). */
const rowSource = z.object({
  kind: z.literal("ical"),
  feed: z.string().min(1).max(100),
  key: z.string().min(1).max(500),
  synced: z
    .object({
      title: z.string().max(1_000).optional(),
      due: z.string().max(40).optional(),
      link: z.string().max(2_000).optional(),
      course: z.string().max(2_000).optional(),
    })
    .optional(),
  missingSince: z.string().max(40).optional(),
});

const databaseRow = z.object({
  id: z.string(),
  cells: z.record(z.string(), cellValue),
  source: rowSource.optional(),
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

/** Bounds for a grading scheme (types.ts GradingScheme). */
export const MAX_GRADE_CATEGORIES = 100;
export const MAX_GRADE_ASSIGNMENTS = 2_000;

const gradeCategory = z.object({
  id: z.string().min(1).max(100),
  course: z.string().max(200),
  name: z.string().max(200),
  weight: z.number().min(0).max(1000),
  dropLowest: z.number().int().min(0).max(50).optional(),
  expectedCount: z.number().int().min(1).max(200).optional(),
});

const gradingScheme = z.object({
  categories: z.array(gradeCategory).max(MAX_GRADE_CATEGORIES),
  assign: z
    .record(z.string(), z.string().max(100))
    .refine((a) => Object.keys(a).length <= MAX_GRADE_ASSIGNMENTS, "too many assignments")
    .optional(),
  keptRows: z.array(z.string().max(200)).max(MAX_GRADE_ASSIGNMENTS).optional(),
});

const database = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
  properties: z.array(databaseProperty),
  rows: z.array(databaseRow),
  views: z.array(databaseView),
  grading: gradingScheme.optional(),
});

/** Where a card or question came from in the student's own material. */
const sourceRef = z.object({
  materialId: z.string().max(200).optional(),
  page: z.number().int().positive().optional(),
  quote: z.string().max(MAX_FLASHCARD_TEXT).optional(),
  label: z.string().max(300).optional(),
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
  source: sourceRef.optional(),
});

// Incomplete questions are allowed (a student adds one and then fills it in,
// with autosave in between); taking a quiz skips questions that are not
// playable (lib/study/quiz.ts `isPlayableQuestion`).
const quizQuestion = z.object({
  id: z.string(),
  kind: z.enum(["mcq", "true_false", "short"]),
  prompt: z.string().max(MAX_QUIZ_TEXT),
  choices: z.array(z.string().max(MAX_QUIZ_TEXT)).max(MAX_QUIZ_CHOICES).optional(),
  answerIndex: z.number().int().nonnegative().optional(),
  answerBool: z.boolean().optional(),
  answerText: z.string().max(MAX_QUIZ_TEXT).optional(),
  explanation: z.string().max(MAX_QUIZ_TEXT).optional(),
  topic: z.string().max(200).optional(),
  source: sourceRef.optional(),
  stats: z
    .object({
      attempts: z.number().int().nonnegative(),
      correct: z.number().int().nonnegative(),
      lastAnsweredAt: z.string().optional(),
    })
    .optional(),
});

const quizAttempt = z.object({
  at: z.string(),
  mode: z.enum(["practice", "exam"]),
  score: z.number().nonnegative(),
  total: z.number().int().nonnegative(),
});

/** Bounds for a grades block (settings only; the grades live in a database). */
export const MAX_GRADE_BANDS = 20;
export const MAX_GRADE_TARGETS = 100;

const gradesColumns = z.object({
  course: z.string().nullable().optional(),
  score: z.string().nullable().optional(),
  maxScore: z.string().nullable().optional(),
  weight: z.string().nullable().optional(),
  due: z.string().nullable().optional(),
});

const gradeBand = z.object({
  min: z.number().min(-1000).max(1000),
  label: z.string().max(40),
  points: z.number().min(-100).max(100).optional(),
});

const gradesBlock = z.object({
  id: z.string(),
  type: z.literal("grades"),
  title: z.string().max(200).optional(),
  databaseId: z.string().optional(),
  columns: gradesColumns.optional(),
  scale: z.enum(["percent", "us_letter", "us_gpa", "uk_degree", "de_grade"]).optional(),
  bands: z.array(gradeBand).max(MAX_GRADE_BANDS).optional(),
  targets: z
    .record(z.string(), z.number().min(-1000).max(1000))
    .refine((t) => Object.keys(t).length <= MAX_GRADE_TARGETS, "too many targets")
    .optional(),
  defaultTarget: z.number().min(-1000).max(1000).optional(),
});

/**
 * On a text block the sync engine kept as a second version: the id of the
 * block it was kept next to (that paragraph was changed in two places at
 * once). The editor marks it and offers to use it or discard it.
 */
const keptFrom = z.string().max(200).optional();

const block = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("heading"),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string(),
    keptFrom,
  }),
  z.object({ id: z.string(), type: z.literal("paragraph"), text: z.string(), keptFrom }),
  z.object({
    id: z.string(),
    type: z.literal("todo"),
    text: z.string(),
    checked: z.boolean(),
    keptFrom,
  }),
  z.object({
    id: z.string(),
    type: z.literal("bulleted_list_item"),
    text: z.string(),
    keptFrom,
  }),
  z.object({
    id: z.string(),
    type: z.literal("numbered_list_item"),
    text: z.string(),
    keptFrom,
  }),
  z.object({ id: z.string(), type: z.literal("quote"), text: z.string(), keptFrom }),
  z.object({
    id: z.string(),
    type: z.literal("callout"),
    text: z.string(),
    emoji: z.string().optional(),
    keptFrom,
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
  z.object({
    id: z.string(),
    type: z.literal("quiz"),
    title: z.string().optional(),
    questions: z.array(quizQuestion).max(MAX_QUIZ_QUESTIONS),
    attempts: z.array(quizAttempt).max(MAX_QUIZ_ATTEMPTS).optional(),
  }),
  gradesBlock,
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
  rowSource as rowSourceSchema,
  databaseView as databaseViewSchema,
  viewSort as viewSortSchema,
  viewFilter as viewFilterSchema,
  database as databaseSchema,
  block as blockSchema,
  page as pageSchema,
  selectOption as selectOptionSchema,
  flashcard as flashcardSchema,
  sourceRef as sourceRefSchema,
  quizQuestion as quizQuestionSchema,
  quizAttempt as quizAttemptSchema,
  gradesBlock as gradesBlockSchema,
  gradesColumns as gradesColumnsSchema,
  gradeBand as gradeBandSchema,
  gradeCategory as gradeCategorySchema,
  gradingScheme as gradingSchemeSchema,
};
