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
 * repair can never make a loadable document worse. Fields this version of the
 * schema does not know are kept (they may come from a newer version), and ids
 * repair has to invent are deterministic.
 */
import { z } from "zod";
import {
  MAX_COMPONENT_SOURCE,
  MAX_FLASHCARDS,
  MAX_FLASHCARD_TEXT,
  MAX_GRADE_TARGETS,
  MAX_QUIZ_ATTEMPTS,
  MAX_QUIZ_CHOICES,
  MAX_QUIZ_QUESTIONS,
  MAX_QUIZ_TEXT,
  quizAttemptSchema,
  quizQuestionSchema,
  blockSchema,
  cellValueSchema,
  databasePropertySchema,
  databaseRowSchema,
  rowSourceSchema,
  databaseSchema,
  databaseViewSchema,
  flashcardSchema,
  pageSchema,
  safeParseWorkspace,
  selectOptionSchema,
  workspaceSchema,
} from "./schema";
import type { Block, CellValue, RowSource, Workspace } from "./types";

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

/** 53-bit string hash (cyrb53), as base36. */
function hash53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The id of a piece stored without a usable one. Derived from where the
 * piece sits and what it holds, never random: every load of the same stored
 * data (any tab, any server) must give it the same id, or tabs disagree about
 * ids and id-addressed edits miss their target.
 */
function derivedId(label: string, raw: unknown): string {
  let content = "";
  try {
    content = JSON.stringify(raw) ?? "";
  } catch {
    content = "";
  }
  const text = `${label}\u0000${content}`;
  return `r-${hash53(text, 1)}${hash53(text, 2)}`;
}

/** The id of part `n` (0-based) of a piece split in several (an oversized deck). */
function partId(id: unknown, n: number, label: string, raw: unknown): unknown {
  if (n === 0) return id;
  return typeof id === "string" && id ? `${id}-part${n + 1}` : derivedId(`${label} part ${n + 1}`, raw);
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Keep a usable id; otherwise derive one deterministically (see derivedId). */
const keepIdOr =
  (label: string, raw: unknown): Fixer =>
  (v) =>
    typeof v === "string" && v ? v : derivedId(label, raw);
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
        id: keepIdOr(`page ${i}`, raw),
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
      return [{ id: keepIdOr(label, raw)(raw.id) as string, type: "paragraph", text }];
    }

    // A deck over the card limit is split into several decks, keeping every card.
    if (type === "flashcards" && Array.isArray(raw.cards) && raw.cards.length > MAX_FLASHCARDS) {
      const decks: Block[] = [];
      for (let start = 0; start < raw.cards.length; start += MAX_FLASHCARDS) {
        const part = this.block(
          {
            ...raw,
            id: partId(raw.id, start / MAX_FLASHCARDS, label, raw),
            cards: raw.cards.slice(start, start + MAX_FLASHCARDS),
          },
          `${label} part ${start / MAX_FLASHCARDS + 1}`,
        );
        if (part) decks.push(...part);
      }
      this.note(`split ${label} into ${decks.length} decks`);
      return decks;
    }

    // A quiz over the question limit is split into several quizzes, keeping
    // every question (the attempt history stays with the first part).
    if (type === "quiz" && Array.isArray(raw.questions) && raw.questions.length > MAX_QUIZ_QUESTIONS) {
      const quizzes: Block[] = [];
      for (let start = 0; start < raw.questions.length; start += MAX_QUIZ_QUESTIONS) {
        const part = this.block(
          {
            ...raw,
            id: partId(raw.id, start / MAX_QUIZ_QUESTIONS, label, raw),
            questions: raw.questions.slice(start, start + MAX_QUIZ_QUESTIONS),
            attempts: start === 0 ? raw.attempts : undefined,
          },
          `${label} part ${start / MAX_QUIZ_QUESTIONS + 1}`,
        );
        if (part) quizzes.push(...part);
      }
      this.note(`split ${label} into ${quizzes.length} quizzes`);
      return quizzes;
    }

    const fixers: Record<string, Fixer> = { id: keepIdOr(label, raw) };
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
    if (type === "quiz") {
      fixers.questions = (v) =>
        this.list(v, (q, j) => this.question(q, `${label} question ${j}`));
      // Keep the newest valid attempts; drop damaged ones.
      fixers.attempts = (v) =>
        this.list(v, (a) => {
          const parsed = quizAttemptSchema.safeParse(a);
          return parsed.success ? parsed.data : null;
        }).slice(-MAX_QUIZ_ATTEMPTS);
    }
    if (type === "grades") {
      // Settings only (the grades live in a database): keep every usable
      // piece; a broken threshold is dropped on its own by `coerce`.
      fixers.title = (v) => toText(v).slice(0, 200);
      fixers.columns = (v) =>
        isObj(v)
          ? Object.fromEntries(
              Object.entries(v).filter(([, id]) => id === null || typeof id === "string"),
            )
          : {};
      fixers.targets = (v) =>
        isObj(v)
          ? Object.fromEntries(
              Object.entries(v)
                .filter(([, n]) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000)
                .slice(0, MAX_GRADE_TARGETS),
            )
          : {};
    }
    const fixed = this.coerce(raw, blockSchema, fixers, label);
    return fixed ? [fixed as Block] : null;
  }

  card(raw: unknown, label: string) {
    const side = (v: unknown) => toText(v).slice(0, MAX_FLASHCARD_TEXT);
    return this.coerce(
      raw,
      flashcardSchema,
      { id: keepIdOr(label, raw), front: side, back: side },
      label,
    );
  }

  /**
   * A quiz question. Text is trimmed to the limit, an unknown kind is inferred
   * from the answer it carries, extra choices are cut to the maximum and an
   * answer that no longer points at a choice is cleared (the question is then
   * just incomplete: kept for editing, skipped when taking the quiz). Damaged
   * optional fields (stats, source, explanation…) are removed.
   */
  question(raw: unknown, label: string) {
    const text = (v: unknown) => toText(v).slice(0, MAX_QUIZ_TEXT);
    const optionalText = (v: unknown) => (v === undefined ? undefined : text(v));
    const obj = isObj(raw) ? raw : null;
    const fixed = this.coerceQuestion(raw, obj, label, text, optionalText);
    if (fixed && typeof fixed.answerIndex === "number" && fixed.answerIndex >= (fixed.choices?.length ?? 0)) {
      delete fixed.answerIndex;
      this.note(`cleared ${label} answer: no such choice`);
    }
    return fixed;
  }

  private coerceQuestion(
    raw: unknown,
    obj: Obj | null,
    label: string,
    text: (v: unknown) => string,
    optionalText: (v: unknown) => string | undefined,
  ) {
    return this.coerce(
      raw,
      quizQuestionSchema,
      {
        id: keepIdOr(label, raw),
        kind: (v) => {
          if (v === "mcq" || v === "true_false" || v === "short") return v;
          if (Array.isArray(obj?.choices)) return "mcq";
          if (typeof obj?.answerBool === "boolean") return "true_false";
          return "short";
        },
        prompt: text,
        choices: (v) =>
          Array.isArray(v) ? v.slice(0, MAX_QUIZ_CHOICES).map(text) : undefined,
        answerIndex: (v) => {
          const n = Number(v);
          const max = Array.isArray(obj?.choices) ? Math.min(obj.choices.length, MAX_QUIZ_CHOICES) : 0;
          return Number.isInteger(n) && n >= 0 && n < max ? n : undefined;
        },
        answerBool: (v) => (v === "true" ? true : v === "false" ? false : undefined),
        answerText: optionalText,
        explanation: optionalText,
      },
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
        id: keepIdOr(label, raw),
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
        source: (v) => repairRowSource(v),
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
    type === "flashcards" ||
    type === "quiz" ||
    type === "grades"
  );
}

/**
 * A calendar-import link on a row (lib/feeds). The feed and key are what keep
 * a re-sync from duplicating the row, so they are kept whenever they are
 * usable; a damaged `synced` record or flag is dropped (the import then treats
 * the row's cells as the student's own), and a link without a usable feed or
 * key is removed, leaving the row itself untouched.
 */
function repairRowSource(value: unknown): RowSource | undefined {
  const strict = rowSourceSchema.safeParse(value);
  if (strict.success) return strict.data;
  if (!isObj(value)) return undefined;
  const { feed, key } = value;
  if (typeof feed !== "string" || typeof key !== "string") return undefined;
  const minimal = rowSourceSchema.safeParse({ kind: "ical", feed, key });
  if (!minimal.success) return undefined;
  const missing = rowSourceSchema.safeParse({ ...minimal.data, missingSince: value.missingSince });
  return missing.success ? missing.data : minimal.data;
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
 * Put back the fields the schema does not know (written by a newer version of
 * the app, during a rolling deploy or after a rollback). Parsing drops unknown
 * keys, and dropping them on load would delete them for good on the next
 * save. Only keys the schema does not define are copied back; a known field
 * that was invalid stays repaired or removed.
 */
function restoreUnknownKeys(schema: z.ZodType, raw: unknown, out: unknown): void {
  let s: z.ZodType = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodNullable) s = s.unwrap() as z.ZodType;
  if (s instanceof z.ZodObject) {
    if (!isObj(raw) || !isObj(out)) return;
    const shape = s.shape as Record<string, z.ZodType>;
    for (const key of Object.keys(raw)) {
      if (key in shape) {
        if (key in out) restoreUnknownKeys(shape[key], raw[key], out[key]);
      } else if (!(key in out) && key !== "__proto__") {
        out[key] = raw[key];
      }
    }
  } else if (s instanceof z.ZodDiscriminatedUnion || s instanceof z.ZodUnion) {
    // Blocks: only when the piece kept its type (not converted).
    if (!isObj(raw) || !isObj(out) || raw.type !== out.type) return;
    const option = (s.options as z.ZodType[]).find((o) => o.safeParse(out).success);
    if (option) restoreUnknownKeys(option, raw, out);
  } else if (s instanceof z.ZodArray) {
    if (!Array.isArray(raw) || !Array.isArray(out)) return;
    const element = s.element as z.ZodType;
    const byId = new Map<string, unknown>();
    for (const item of raw) if (isObj(item) && typeof item.id === "string") byId.set(item.id, item);
    out.forEach((item, i) => {
      const match =
        isObj(item) && typeof item.id === "string"
          ? byId.get(item.id)
          : raw.length === out.length
            ? raw[i]
            : undefined;
      if (match !== undefined) restoreUnknownKeys(element, match, item);
    });
  }
}

/**
 * Recover a workspace from stored JSON. Returns null only when the input is
 * not a workspace at all (not an object). The result always passes the strict
 * schema.
 *
 * A document that already passes is returned as it is (same object, same key
 * order, fields this version does not know kept), so loading and saving a
 * valid workspace never changes it. A repaired document keeps unknown fields
 * too, and any id it has to invent is derived from the stored data, so every
 * load agrees on it.
 */
export function repairWorkspace(
  input: unknown,
  options: RepairOptions = {},
): RepairResult | null {
  const strict = safeParseWorkspace(input);
  if (strict.success) return { workspace: input as Workspace, issues: [] };
  if (!isObj(input)) return null;

  const r = new Repairer();
  const repaired = r.coerce(
    input,
    workspaceSchema,
    {
      id: (v) => (typeof v === "string" && v ? v : (options.id ?? derivedId("workspace", input))),
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
  restoreUnknownKeys(workspaceSchema, input, final.data);
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
