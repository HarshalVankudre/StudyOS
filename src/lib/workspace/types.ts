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
  | "flashcards";

interface BaseBlock {
  id: string;
  type: BlockType;
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
}

/** A spaced-repetition flashcard deck embedded in a page. */
export interface FlashcardsBlock extends BaseBlock {
  type: "flashcards";
  title?: string;
  cards: Flashcard[];
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
  | FlashcardsBlock;

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
