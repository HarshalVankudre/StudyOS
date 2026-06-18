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

export interface DatabaseView {
  id: string;
  name: string;
  type: ViewType;
  /** For "board": the select/status property to group columns by. */
  groupByPropertyId?: string;
  /** For "calendar": the date property to place rows on. */
  datePropertyId?: string;
  /** Optional ordered subset of properties to show; omit to show all. */
  visiblePropertyIds?: string[];
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
  | "database_view";

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

/** Embeds a specific saved view of a workspace database into a page. */
export interface DatabaseViewBlock extends BaseBlock {
  type: "database_view";
  databaseId: string;
  viewId: string;
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
  | DatabaseViewBlock;

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
