/**
 * StudyOS — Workspace data model ("the spec")
 * --------------------------------------------
 * This is the single source of truth for what a workspace looks like.
 *
 * In plain terms:
 *   - A WORKSPACE is the whole thing a student gets (e.g. "Study HQ").
 *   - It holds PAGES (documents) and DATABASES (smart tables).
 *   - A PAGE is made of BLOCKS (headings, text, to-dos, callouts...).
 *     A page can also embed a view of a database via a `database_view` block,
 *     which is how a "dashboard" shows trackers without duplicating data.
 *   - A DATABASE has PROPERTIES (columns), ROWS, and VIEWS (table/board/calendar).
 *
 * Three things all speak this language:
 *   1. The AI generator  — outputs a Workspace from a sentence.
 *   2. The renderer/editor — displays and edits a Workspace.
 *   3. The database (Prisma) — persists a Workspace per user.
 *
 * Keeping them on one shared model is what makes the whole product compose.
 */

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

/** The kind of data a database column holds. */
export type PropertyType =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "select" // single choice from `options`
  | "multi_select" // many choices from `options`
  | "status" // single choice from `options`, rendered as a status pill
  | "url"
  | "relation"; // links to rows in another database

/** A choice for select / multi_select / status properties. */
export interface SelectOption {
  id: string;
  label: string;
  /** Design-token color name, e.g. "indigo", "green", "amber". */
  color?: string;
}

/** A column definition. */
export interface DatabaseProperty {
  id: string;
  name: string;
  type: PropertyType;
  /** Present for select / multi_select / status. */
  options?: SelectOption[];
  /** Present for relation: the id of the Database this column points to. */
  relationDatabaseId?: string;
}

/**
 * A cell's value. Its concrete shape depends on the property's type:
 *   text | url            -> string
 *   number               -> number
 *   checkbox             -> boolean
 *   date                 -> string (ISO 8601, e.g. "2026-09-14")
 *   select | status      -> string (a SelectOption id)
 *   multi_select         -> string[] (SelectOption ids)
 *   relation             -> string[] (DatabaseRow ids in the related database)
 */
export type CellValue = string | number | boolean | string[] | null;

/** A single record in a database. `cells` is keyed by DatabaseProperty.id. */
export interface DatabaseRow {
  id: string;
  cells: Record<string, CellValue>;
  /** Set on rows imported from a calendar (lib/feeds); absent on rows a student made. */
  source?: RowSource;
}

/**
 * Where an imported row came from, so a re-sync updates it instead of adding a
 * duplicate. Never holds the feed link itself (that secret lives server-side
 * in the CalendarFeed table); `feed` is only that record's opaque id.
 */
export interface RowSource {
  kind: "ical";
  /** CalendarFeed id of a connected feed, or "file" for a one-off .ics upload. */
  feed: string;
  /** The event's UID, plus "#<original start>" for one occurrence of a repeating event. */
  key: string;
  /**
   * What the last import wrote into each mapped field (cell values as text).
   * A cell that no longer matches was edited by the student and is never
   * overwritten; a field missing here was never written by an import.
   */
  synced?: { title?: string; due?: string; link?: string; course?: string };
  /** Local day the event was first missing from its feed. The row is kept and flagged, never deleted. */
  missingSince?: string;
}

/** How a database is displayed. */
export type ViewType = "table" | "board" | "calendar" | "list" | "gallery";

/** One key of a view's sort. Earlier keys win; empty values always sort last. */
export interface ViewSort {
  propertyId: string;
  direction: "asc" | "desc";
}

/**
 * A view filter condition. Which operators apply depends on the property type
 * (an operator that does not fit the type is ignored, as is an incomplete one):
 *   text | url       contains, not_contains, is, is_not, is_empty, is_not_empty
 *   number           eq, neq, gt, gte, lt, lte, is_empty, is_not_empty
 *   checkbox         is (value: boolean)
 *   date             is, before, after, on_or_before, on_or_after
 *                      (value: "YYYY-MM-DD", or "today" / "tomorrow" / "yesterday"),
 *                    next_days, past_days (value: number of days; today included),
 *                    overdue (before today and the row is not complete),
 *                    is_empty, is_not_empty
 *   select | status  is, is_not (value: option id, or an array = any of),
 *                    is_empty, is_not_empty
 *   multi_select     contains, not_contains (value: option id or ids, any of),
 *                    is_empty, is_not_empty
 *   relation         contains, not_contains (value: row id or ids),
 *                    is_empty, is_not_empty
 * Date values are local calendar days; "today" is the viewer's local day.
 */
export type FilterOperator =
  | "contains"
  | "not_contains"
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after"
  | "on_or_before"
  | "on_or_after"
  | "next_days"
  | "past_days"
  | "overdue";

export interface ViewFilter {
  propertyId: string;
  operator: FilterOperator;
  value?: CellValue;
}

export interface DatabaseView {
  id: string;
  name: string;
  type: ViewType;
  /** For "board": the select/status property to group columns by. */
  groupByPropertyId?: string;
  /**
   * For "calendar": the date property to place rows on. For "list" and
   * "gallery": the date shown as each item's deadline (defaults to the first
   * date property).
   */
  datePropertyId?: string;
  /** Optional ordered subset of properties to show; omit to show all. */
  visiblePropertyIds?: string[];
  /** Multi-key sort, applied in order. Omit for the stored row order. */
  sorts?: ViewSort[];
  /** Filter conditions; omit to show every row. */
  filters?: ViewFilter[];
  /** How `filters` combine: every condition (default) or any of them. */
  filterMatch?: "all" | "any";
}

export interface Database {
  id: string;
  name: string;
  /** Emoji, e.g. "📚". */
  icon?: string;
  description?: string;
  properties: DatabaseProperty[];
  rows: DatabaseRow[];
  views: DatabaseView[];
  /**
   * How the courses in this list of graded work are graded, when part of a
   * grade is shared by many items ("Problem sets 20%"). Read by every grades
   * block over this database; see src/lib/grades.
   */
  grading?: GradingScheme;
}

/**
 * A weighted part of a course grade that many items share ("Problem sets
 * 20%", "Weekly homework 30%, lowest two dropped"). Its items are ordinary
 * rows without a weight of their own; the category's score is the average of
 * its scored items.
 */
export interface GradeCategory {
  id: string;
  /**
   * The course it belongs to, as the grades block keys courses: a select
   * option id or related row id of the course column, "text:<name>" for a
   * text column, "*" when the list has no course column, "" for rows with no
   * course.
   */
  course: string;
  name: string;
  /** Percent of the course grade. */
  weight: number;
  /** The lowest N scores in the category do not count. */
  dropLowest?: number;
  /** How many items the category will have in all, when known; absent = the items listed. */
  expectedCount?: number;
}

export interface GradingScheme {
  categories: GradeCategory[];
  /**
   * Rows placed by hand (row id -> category id), overriding the automatic
   * match by type and title; "" = the row counts in no category.
   */
  assign?: Record<string, string>;
  /** Weighted rows that look like categories but the student kept as rows. */
  keptRows?: string[];
}

// ---------------------------------------------------------------------------
// Pages & blocks
// ---------------------------------------------------------------------------

export type BlockType =
  | "heading"
  | "paragraph"
  | "todo"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "quote"
  | "callout"
  | "divider"
  | "database_view"
  | "media"
  | "react_artifact"
  | "flashcards"
  | "quiz"
  | "grades";

interface BaseBlock {
  id: string;
  type: BlockType;
  /**
   * Text blocks only: set when the sync engine kept this block as the second
   * version of the block with this id (that paragraph was changed in two
   * places at once). The editor marks it and offers to use it or discard it.
   */
  keptFrom?: string;
}

export interface HeadingBlock extends BaseBlock {
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
}

export interface ParagraphBlock extends BaseBlock {
  type: "paragraph";
  text: string;
}

export interface TodoBlock extends BaseBlock {
  type: "todo";
  text: string;
  checked: boolean;
}

export interface BulletedListItemBlock extends BaseBlock {
  type: "bulleted_list_item";
  text: string;
}

export interface NumberedListItemBlock extends BaseBlock {
  type: "numbered_list_item";
  text: string;
}

export interface QuoteBlock extends BaseBlock {
  type: "quote";
  text: string;
}

export interface CalloutBlock extends BaseBlock {
  type: "callout";
  text: string;
  emoji?: string;
}

export interface DividerBlock extends BaseBlock {
  type: "divider";
}

/** A rendered image artifact (e.g. a sandbox-produced LaTeX/diagram render). */
export interface MediaBlock extends BaseBlock {
  type: "media";
  /** FK into the Asset table; never a raw or permanent URL. */
  assetId: string;
  mediaKind: "image"; // "pdf" later
  /** Cached for render: image/png | image/svg+xml. */
  mime: string;
  width?: number;
  height?: number;
  caption?: string;
  alt?: string;
}

/** Embeds a specific saved view of a workspace database into a page. */
export interface DatabaseViewBlock extends BaseBlock {
  type: "database_view";
  databaseId: string;
  viewId: string;
}

/** A live, interactive React component rendered in a sandboxed iframe. */
export interface ReactArtifactBlock extends BaseBlock {
  type: "react_artifact";
  title?: string;
  /** Self-contained JSX source defining a top-level `App` component. */
  source: string;
}

/**
 * One flashcard. `front`/`back` are the content (Markdown + $math$); the
 * remaining fields are the spaced-repetition scheduling state, all optional so
 * an AI or a user can author a card with just front+back (absent state = a
 * brand-new card). The review UI fills them in over time — see
 * lib/study/srs.ts (FSRS). Cards reviewed before FSRS carry only the SM-2
 * fields (`ease`, `intervalDays`, `reps`, `dueAt`); they are converted to FSRS
 * memory state on their next review, keeping their due day.
 */
export interface Flashcard {
  id: string;
  front: string;
  back: string;
  /** Legacy SM-2 ease factor (≥1.3). Read once when converting to FSRS. */
  ease?: number;
  /** Current interval in days between reviews (0 while in a learning step). */
  intervalDays?: number;
  /** Number of reviews (SM-2 era: consecutive successful reviews). */
  reps?: number;
  /** Local day (YYYY-MM-DD) this card is next due for review. */
  dueAt?: string;
  /** ISO datetime of the last review. */
  lastReviewedAt?: string;
  /** FSRS memory stability in days (the interval at which recall is ~90%). */
  stability?: number;
  /** FSRS difficulty, 1 (easy) to 10 (hard). */
  difficulty?: number;
  /** FSRS card state. Absent on cards never reviewed under FSRS. */
  state?: "new" | "learning" | "review" | "relearning";
  /** Times the card was forgotten after it had been learned. */
  lapses?: number;
  /** Position in the (re)learning steps while `state` is learning/relearning. */
  learningStep?: number;
  /** Exact ISO datetime the card is due (minutes-precise for learning steps). */
  dueTime?: string;
  /**
   * The card's most recent reviews, oldest first; `id` is the ISO datetime of
   * the answer. With `reviewBase` this makes recording a review independent
   * of the order devices sync in (lib/study/review-log.ts).
   */
  reviews?: { id: string; grade: "again" | "hard" | "good" | "easy" }[];
  /** The scheduling fields as they were before the oldest entry of `reviews`. */
  reviewBase?: Pick<
    Flashcard,
    | "ease"
    | "intervalDays"
    | "reps"
    | "dueAt"
    | "lastReviewedAt"
    | "stability"
    | "difficulty"
    | "state"
    | "lapses"
    | "learningStep"
    | "dueTime"
  >;
  /** Where this card came from in the student's own material. */
  source?: SourceRef;
}

/** Where a card or question came from in the student's own material. */
export interface SourceRef {
  /** Id of a stored study material, when the item was generated from one. */
  materialId?: string;
  /** 1-based page number in that material. */
  page?: number;
  /** Short verbatim excerpt that supports the item. */
  quote?: string;
  /** Human label, e.g. the material's title. */
  label?: string;
}

export type QuizQuestionKind = "mcq" | "true_false" | "short";

export interface QuizQuestion {
  id: string;
  kind: QuizQuestionKind;
  prompt: string;
  /** mcq: 2 to 6 answer choices. */
  choices?: string[];
  /** mcq: index into `choices` of the correct one. */
  answerIndex?: number;
  /** true_false: the correct value. */
  answerBool?: boolean;
  /** short: a model answer the student compares against. */
  answerText?: string;
  explanation?: string;
  topic?: string;
  source?: SourceRef;
  /** Running record of how the student has done on this question. */
  stats?: {
    attempts: number;
    correct: number;
    lastAnsweredAt?: string;
    /** Moments (ISO) of the most recent answers counted, so each counts once. */
    recent?: string[];
  };
}

export interface QuizAttempt {
  at: string; // ISO datetime
  mode: "practice" | "exam";
  score: number;
  total: number;
}

/** A practice quiz embedded in a page (practice and exam modes). */
export interface QuizBlock extends BaseBlock {
  type: "quiz";
  title?: string;
  questions: QuizQuestion[];
  /** Most recent attempts, newest last, capped. */
  attempts?: QuizAttempt[];
}

/** A spaced-repetition flashcard deck embedded in a page. */
export interface FlashcardsBlock extends BaseBlock {
  type: "flashcards";
  title?: string;
  cards: Flashcard[];
}

/**
 * Which columns of the grades database hold what (property ids). A missing
 * key is detected automatically; `null` means "this database has none" (the
 * student said so in setup), so detection never re-adds it.
 */
export interface GradesColumns {
  /** select, relation or text: which course a row belongs to. */
  course?: string | null;
  /** number: the score received. */
  score?: string | null;
  /** number: what the score is out of. Without it a score is a percentage. */
  maxScore?: string | null;
  /** number: percent of the course grade. */
  weight?: string | null;
  /** date: when the work is due. */
  due?: string | null;
}

export type GradeScalePreset = "percent" | "us_letter" | "us_gpa" | "uk_degree" | "de_grade";

/** One step of a grading scale: from `min` percent up, the grade is `label`. */
export interface GradeBand {
  min: number;
  label: string;
  /** Grade points (US GPA, German 1.0-5.0) when the scale has them. */
  points?: number;
}

/**
 * A live grade calculator over a database of graded work (one list of
 * assignments, not a second copy). Scores, weights and courses are read from
 * the rows at render time; the block itself only stores settings. The math
 * lives in src/lib/grades.
 */
export interface GradesBlock extends BaseBlock {
  type: "grades";
  title?: string;
  /** The database whose rows are graded work. Absent until set up. */
  databaseId?: string;
  columns?: GradesColumns;
  /** Defaults to "percent". */
  scale?: GradeScalePreset;
  /** Thresholds the student edited, best first; absent = the preset's. */
  bands?: GradeBand[];
  /** Target percentage per course key (select option id, related row id or course name). */
  targets?: Record<string, number>;
  /** Target percentage for courses without their own. */
  defaultTarget?: number;
}

/** Discriminated union of every block kind (switch on `block.type`). */
export type Block =
  | HeadingBlock
  | ParagraphBlock
  | TodoBlock
  | BulletedListItemBlock
  | NumberedListItemBlock
  | QuoteBlock
  | CalloutBlock
  | DividerBlock
  | MediaBlock
  | DatabaseViewBlock
  | ReactArtifactBlock
  | FlashcardsBlock
  | QuizBlock
  | GradesBlock;

export interface Page {
  id: string;
  title: string;
  /** Emoji, e.g. "🏠". */
  icon?: string;
  blocks: Block[];
}

// ---------------------------------------------------------------------------
// Workspace (the root)
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  name: string;
  /** Emoji, e.g. "🎓". */
  icon?: string;
  pages: Page[];
  databases: Database[];
  /** The page shown first when the workspace opens (the "dashboard"/home). */
  homePageId?: string;
}
