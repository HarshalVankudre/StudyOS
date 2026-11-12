/**
 * Tolerant loading for stored workspaces.
 *
 * `safeParseWorkspace` is all-or-nothing: one bad block makes the whole
 * document invalid. That is the right gate for untrusted AI output, but the
 * wrong behaviour for a student's saved workspace, where a single imperfect
 * piece used to make the entire workspace unloadable (a 404).
 *
 * `repairWorkspace` recovers as much as it can instead: every piece (page,
 * block, card, database, property, row, cell, view) is validated against the
 * exact same schema pieces, and an invalid piece is repaired when there is an
 * obvious safe fix (missing text -> "", unknown column type -> text, an
 * oversized deck -> split into several decks) or dropped on its own, keeping
 * everything around it. Unknown optional fields that fail validation are
 * removed rather than failing their parent, so fields added to the schema later
 * (for example new view settings) keep working.
 *
 * A document that already passes the strict schema is returned unchanged, so
 * repair can never make a loadable document worse.
 */
import type { z } from "zod";
import {
  MAX_COMPONENT_SOURCE,
  MAX_FLASHCARDS,
  MAX_FLASHCARD_TEXT,
  blockSchema,
  cellValueSchema,
  databasePropertySchema,
  databaseRowSchema,
  databaseSchema,
  databaseViewSchema,
  flashcardSchema,
  pageSchema,
  safeParseWorkspace,
  selectOptionSchema,
  workspaceSchema,
} from "./schema";
import type { Block, CellValue, Workspace } from "./types";

/** Hard cap on the serialized size of one workspace (matches the agent's cap). */
export const MAX_WORKSPACE_BYTES = 2_000_000;

export interface RepairResult {
  workspace: Workspace;
  /** Human-readable notes on what had to be repaired or dropped (for logs). */
  issues: string[];
}

export interface RepairOptions {
  /** Used when the stored document has no usable id (the row id). */
  id?: string;
  /** Used when the stored document has no usable name (the row name). */
  name?: string;
}

type Obj = Record<string, unknown>;

/** Returned by a field fixer to say "this piece cannot be saved; drop it". */
const DROP = Symbol("drop");
type Fixer = (value: unknown) => unknown;

const TEXT_BLOCKS = new Set([
  "heading",
  "paragraph",
  "todo",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "callout",
]);

const PROPERTY_TYPES = new Set([
  "text",
  "number",
  "checkbox",
  "date",
  "select",
  "multi_select",
  "status",
  "url",
  "relation",
]);

const VIEW_TYPES = new Set(["table", "board", "calendar", "list", "gallery"]);

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

const keepIdOrNew: Fixer = (v) => (typeof v === "string" && v ? v : newId());
const requireString: Fixer = (v) => (typeof v === "string" && v ? v : DROP);

/** Bytes of a serialized workspace (what is actually stored). */
export function workspaceBytes(ws: unknown): number {
  return new TextEncoder().encode(JSON.stringify(ws)).length;
}

class Repairer {
  issues: string[] = [];

  note(message: string) {
    if (this.issues.length < 50) this.issues.push(message);
  }

  /**
   * Make `raw` satisfy `schema`, touching only the fields that fail.
   *
   * Each round parses; for every failing top-level key it runs that key's
   * fixer (which may return DROP to reject the whole piece). A failing key
   * without a fixer is optional by construction: if the failure is inside one
   * element of an array, only that element is removed; otherwise the key is
   * removed. Bounded so a pathological input cannot loop.
   */
  coerce<T>(
    raw: unknown,
    schema: z.ZodType<T>,
    fixers: Record<string, Fixer>,
    label: string,
  ): T | null {
    if (!isObj(raw)) {
      this.note(`dropped ${label}: not an object`);
      return null;
    }
    const first = schema.safeParse(raw);
    if (first.success) return first.data;

    const obj: Obj = { ...raw };
    for (let round = 0; round < 6; round += 1) {
      const result = schema.safeParse(obj);
      if (result.success) {
        this.note(`repaired ${label}`);
        return result.data;
      }
      const elementDrops = new Map<string, Set<number>>();
      const keys = new Set<string>();
      for (const issue of result.error.issues) {
        const [key, index] = issue.path;
        if (typeof key !== "string") continue;
        if (
          !(key in fixers) &&
          typeof index === "number" &&
          Array.isArray(obj[key])
        ) {
          const set = elementDrops.get(key) ?? new Set<number>();
          set.add(index);
          elementDrops.set(key, set);
        } else {
          keys.add(key);
        }
      }
      if (keys.size === 0 && elementDrops.size === 0) break;
      for (const [key, indexes] of elementDrops) {
        obj[key] = (obj[key] as unknown[]).filter((_, i) => !indexes.has(i));
      }
      for (const key of keys) {
        const fixer = fixers[key];
        if (fixer) {
          const fixed = fixer(obj[key]);
          if (fixed === DROP) {
            this.note(`dropped ${label}: invalid ${key}`);
            return null;
          }
          obj[key] = fixed;
        } else {
          delete obj[key];
        }
      }
    }
    this.note(`dropped ${label}: could not be repaired`);
    return null;
  }

  list<T>(value: unknown, each: (item: unknown, i: number) => T | T[] | null): T[] {
    if (!Array.isArray(value)) return [];
    const out: T[] = [];
    value.forEach((item, i) => {
      const fixed = each(item, i);
      if (fixed === null) return;
      if (Array.isArray(fixed)) out.push(...fixed);
      else out.push(fixed);
    });
    return out;
  }

  // ---- pages & blocks --------------------------------------------------

  page(raw: unknown, i: number) {
    return this.coerce(
      raw,
      pageSchema,
      {
        id: keepIdOrNew,
        title: toText,
        blocks: (v) => this.list(v, (b, j) => this.block(b, `page ${i} block ${j}`)),
      },
      `page ${i}`,
    );
  }

  block(raw: unknown, label: string): Block[] | null {
    if (!isObj(raw)) {
      this.note(`dropped ${label}: not an object`);
      return null;
    }
    const strict = blockSchema.safeParse(raw);
    if (strict.success) return [strict.data as Block];

    const type = raw.type;
    // An unknown block type that still carries text keeps its words as a
    // paragraph rather than vanishing.
    if (typeof type !== "string" || !isKnownBlockType(type)) {
      const text = toText(raw.text);
      if (!text) {
        this.note(`dropped ${label}: unknown type`);
        return null;
      }
      this.note(`converted ${label} to a paragraph`);
      return [{ id: keepIdOrNew(raw.id) as string, type: "paragraph", text }];
    }

    // A deck over the card limit is split into several decks, keeping every card.
    if (type === "flashcards" && Array.isArray(raw.cards) && raw.cards.length > MAX_FLASHCARDS) {
      const decks: Block[] = [];
      for (let start = 0; start < raw.cards.length; start += MAX_FLASHCARDS) {
        const part = this.block(
          {
            ...raw,
            id: start === 0 ? raw.id : newId(),
            cards: raw.cards.slice(start, start + MAX_FLASHCARDS),
          },
          `${label} part ${start / MAX_FLASHCARDS + 1}`,
        );
        if (part) decks.push(...part);
      }
      this.note(`split ${label} into ${decks.length} decks`);
      return decks;
    }

    const fixers: Record<string, Fixer> = { id: keepIdOrNew };
    if (TEXT_BLOCKS.has(type)) fixers.text = toText;
    if (type === "heading") {
      fixers.level = (v) => {
        const n = Math.round(Number(v));
        return n === 1 || n === 2 || n === 3 ? n : 2;
      };
    }
    if (type === "todo") fixers.checked = (v) => v === true || v === "true";
    if (type === "media") {
      fixers.assetId = requireString;
      fixers.mime = (v) => (typeof v === "string" && v ? v : "image/png");
      fixers.mediaKind = () => "image";
    }
    if (type === "database_view") {
      fixers.databaseId = requireString;
      fixers.viewId = requireString;
    }
    if (type === "react_artifact") {
      // Component source is code: truncating it would break it, so a missing,
      // empty or oversized source drops just this block.
      fixers.source = (v) =>
        typeof v === "string" && v.trim() && v.length <= MAX_COMPONENT_SOURCE ? v : DROP;
    }
    if (type === "flashcards") {
      fixers.cards = (v) =>
        this.list(v, (card, j) => this.card(card, `${label} card ${j}`));
    }
    const fixed = this.coerce(raw, blockSchema, fixers, label);
    return fixed ? [fixed as Block] : null;
  }

  card(raw: unknown, label: string) {
    const side = (v: unknown) => toText(v).slice(0, MAX_FLASHCARD_TEXT);
    return this.coerce(
      raw,
      flashcardSchema,
      { id: keepIdOrNew, front: side, back: side },
      label,
    );
  }

  // ---- databases -------------------------------------------------------

  database(raw: unknown, i: number) {
    const label = `database ${i}`;
    return this.coerce(
      raw,
      databaseSchema,
      {
        id: requireString,
        name: toText,
        properties: (v) =>
          this.list(v, (p, j) => this.property(p, `${label} property ${j}`)),
        rows: (v) => this.list(v, (r, j) => this.row(r, `${label} row ${j}`)),
        views: (v) => this.list(v, (w, j) => this.view(w, `${label} view ${j}`)),
      },
      label,
    );
  }

  property(raw: unknown, label: string) {
    return this.coerce(
      raw,
      databasePropertySchema,
      {
        // Cells are keyed by property id, so a property without one is unusable.
        id: requireString,
        name: toText,
        type: (v) => (typeof v === "string" && PROPERTY_TYPES.has(v) ? v : "text"),
        options: (v) =>
          this.list(v, (o, j) =>
            this.coerce(
              o,
              selectOptionSchema,
              { id: requireString, label: toText },
              `${label} option ${j}`,
            ),
          ),
      },
      label,
    );
  }

  row(raw: unknown, label: string) {
    return this.coerce(
      raw,
      databaseRowSchema,
      {
        id: keepIdOrNew,
        cells: (v) => {
          if (!isObj(v)) return {};
          const cells: Record<string, CellValue> = {};
          for (const [key, value] of Object.entries(v)) {
            const cell = repairCell(value);
            if (cell !== undefined) cells[key] = cell;
            else this.note(`dropped ${label} cell ${key}`);
          }
          return cells;
        },
      },
      label,
    );
  }

  view(raw: unknown, label: string) {
    return this.coerce(
      raw,
      databaseViewSchema,
      {
        id: requireString,
        name: toText,
        type: (v) => (typeof v === "string" && VIEW_TYPES.has(v) ? v : "table"),
      },
      label,
    );
  }
}

function isKnownBlockType(type: string): boolean {
  return (
    TEXT_BLOCKS.has(type) ||
    type === "divider" ||
    type === "media" ||
    type === "database_view" ||
    type === "react_artifact" ||
    type === "flashcards"
  );
}

/** A valid cell value, or undefined when it cannot be kept. */
function repairCell(value: unknown): CellValue | undefined {
  if (cellValueSchema.safeParse(value).success) return value as CellValue;
  if (value === undefined) return undefined;
  if (typeof value === "number") return null; // NaN / Infinity
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return undefined;
}

/**
 * Recover a workspace from stored JSON. Returns null only when the input is
 * not a workspace at all (not an object). The result always passes the strict
 * schema.
 */
export function repairWorkspace(
  input: unknown,
  options: RepairOptions = {},
): RepairResult | null {
  const strict = safeParseWorkspace(input);
  if (strict.success) return { workspace: strict.data, issues: [] };
  if (!isObj(input)) return null;

  const r = new Repairer();
  const repaired = r.coerce(
    input,
    workspaceSchema,
    {
      id: (v) => (typeof v === "string" && v ? v : (options.id ?? newId())),
      name: (v) => (typeof v === "string" ? v : (options.name ?? "")),
      pages: (v) => r.list(v, (p, i) => r.page(p, i)),
      databases: (v) => r.list(v, (d, i) => r.database(d, i)),
    },
    "workspace",
  );
  if (!repaired) return null;
  const workspace = repaired as Workspace;
  if (
    workspace.homePageId &&
    !workspace.pages.some((p) => p.id === workspace.homePageId)
  ) {
    delete workspace.homePageId;
    r.note("dropped homePageId: page no longer exists");
  }
  const final = safeParseWorkspace(workspace);
  if (!final.success) return null;
  return { workspace: final.data, issues: r.issues };
}

export class InvalidWorkspaceError extends Error {}
export class WorkspaceTooLargeError extends Error {}

/**
 * The single gate every write goes through: returns the exact document that
 * will be stored, guaranteed to load again. Repairs what it can (so a student's
 * save is never refused over one imperfect piece) and throws only when there is
 * no workspace to save or it is over the size cap.
 */
export function prepareWorkspaceForSave(
  input: unknown,
  id: string,
): { workspace: Workspace; data: string; repaired: boolean } {
  const result = repairWorkspace(input, { id });
  if (!result) throw new InvalidWorkspaceError("Workspace is invalid");
  const workspace = { ...result.workspace, id };
  const data = JSON.stringify(workspace);
  if (new TextEncoder().encode(data).length > MAX_WORKSPACE_BYTES) {
    throw new WorkspaceTooLargeError("Workspace is too large");
  }
  return { workspace, data, repaired: result.issues.length > 0 };
}
