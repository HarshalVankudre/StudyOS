/**
 * What a visitor of a shared page (/s/<token>) is sent: the page's CURRENT
 * content, reduced to plain data for a read-only view. Pure (no database, no
 * React), so every rule below is unit-tested.
 *
 *  - Text blocks keep their Markdown; links and images in it are scoped when
 *    rendered (rehype-share.ts).
 *  - A database view becomes a plain table of what that view shows (its
 *    filters, sort and columns), at most PUBLIC_ROW_CAP rows.
 *  - Flashcards keep only front and back; quizzes only the question, its
 *    choices and answer, explanation and topic. Scheduling, review history,
 *    scores, attempts and source citations (which point into the student's
 *    own material) are never sent.
 *  - Images are served through the share's own asset route, which serves
 *    only the assets this view shows (publicAssetIds).
 *  - Grade calculators are left out without a trace (grades are private);
 *    an interactive component becomes a neutral placeholder. A heading
 *    whose whole section was left out goes too ("Grades" above a grade
 *    calculator).
 *  - No id of the workspace's own (block, card, question, row, database,
 *    view) is sent; a deep link into StudyOS a student pasted (/app/<id>?
 *    page=...) is replaced by "…" and the workspace id is removed from every
 *    text, so neither its workspaces nor its other pages can be named.
 */
import { cellText, visibleProperties } from "@/lib/export/cells";
import { safeImageSrc } from "@/lib/markdown-images";
import { applyView } from "@/lib/workspace/view-logic";
import type {
  Block,
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  Page,
  QuizQuestion,
  Workspace,
} from "@/lib/workspace/types";
import { PUBLIC_ROW_CAP, shareAssetPath } from "./config";
import { isAssetIdShape } from "./token";

export type PublicTextKind =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "todo"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "quote"
  | "callout";

export interface PublicCard {
  front: string;
  back: string;
}

interface QuestionBase {
  prompt: string;
  explanation?: string;
  topic?: string;
}

export type PublicQuestion =
  | (QuestionBase & { kind: "mcq"; choices: string[]; answerIndex: number })
  | (QuestionBase & { kind: "true_false"; answer: boolean })
  | (QuestionBase & { kind: "short"; answer: string });

export type PublicBlock =
  | { type: "text"; kind: PublicTextKind; text: string; checked?: boolean; number?: number; emoji?: string }
  | { type: "divider" }
  | { type: "image"; src: string; alt: string; caption?: string }
  | {
      type: "table";
      name: string;
      icon?: string;
      viewName?: string;
      columns: string[];
      rows: string[][];
      /** Rows the view shows beyond PUBLIC_ROW_CAP. */
      more: number;
    }
  | { type: "flashcards"; title?: string; cards: PublicCard[] }
  | { type: "quiz"; title?: string; questions: PublicQuestion[] }
  /** An interactive component: not run on a shared page. */
  | { type: "hidden" };

export interface PublicPage {
  title: string;
  icon?: string;
  blocks: PublicBlock[];
}

export interface PublicViewOptions {
  /** The share's token (image URLs go through its asset route). */
  token: string;
  /** The day database views are evaluated on (YYYY-MM-DD): the sharer's, in their time zone. */
  today: string;
}

// ---- Databases ----------------------------------------------------------------

/** The view a database_view block shows (the first view when its own is gone). */
export function resolveView(db: Database, viewId: string): DatabaseView | undefined {
  return db.views.find((v) => v.id === viewId) ?? db.views[0];
}

/** The rows a view shows, in its order (all rows, as stored, without a view). */
export function rowsShown(db: Database, view: DatabaseView | undefined, today: string): DatabaseRow[] {
  return view ? applyView(db, view, { today }) : db.rows;
}

/**
 * Exactly what a database_view block shows a visitor: the resolved view, its
 * columns in its order, its rows (filters, then sort) cut at PUBLIC_ROW_CAP,
 * and how many it shows in all. The shared table and "Save a copy" both
 * read this, so a copy never holds a row or a column the page did not show.
 */
export interface ViewProjection {
  view: DatabaseView | undefined;
  properties: DatabaseProperty[];
  rows: DatabaseRow[];
  total: number;
}

export function viewProjection(db: Database, viewId: string, today: string): ViewProjection {
  const view = resolveView(db, viewId);
  const all = rowsShown(db, view, today);
  return {
    view,
    properties: visibleProperties(db, view?.visiblePropertyIds),
    rows: all.slice(0, PUBLIC_ROW_CAP),
    total: all.length,
  };
}

function tableBlock(db: Database, viewId: string, ws: Pick<Workspace, "databases">, today: string): PublicBlock {
  const { view, properties, rows, total } = viewProjection(db, viewId, today);
  return {
    type: "table",
    name: db.name,
    ...(db.icon ? { icon: db.icon } : {}),
    ...(view?.name ? { viewName: view.name } : {}),
    columns: properties.map((p) => p.name),
    rows: rows.map((row) =>
      properties.map((p) => {
        const value = row.cells[p.id];
        // A tick reads better than TRUE/FALSE in a table people look at.
        if (p.type === "checkbox") return value === true ? "✓" : "";
        return cellText(ws, p, value);
      }),
    ),
    more: Math.max(0, total - rows.length),
  };
}

// ---- Study blocks -------------------------------------------------------------

const filled = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

/** A question as practised on a shared page, or null when it has no usable answer key. */
export function publicQuestion(q: QuizQuestion): PublicQuestion | null {
  const prompt = filled(q.prompt);
  if (!prompt) return null;
  const explanation = filled(q.explanation);
  const topic = filled(q.topic);
  const base: QuestionBase = { prompt, ...(explanation ? { explanation } : {}), ...(topic ? { topic } : {}) };
  if (q.kind === "mcq") {
    const choices = (q.choices ?? []).filter((c): c is string => typeof c === "string");
    const index = q.answerIndex;
    if (choices.length < 2 || typeof index !== "number" || index < 0 || index >= choices.length) return null;
    return { ...base, kind: "mcq", choices, answerIndex: index };
  }
  if (q.kind === "true_false") {
    return typeof q.answerBool === "boolean" ? { ...base, kind: "true_false", answer: q.answerBool } : null;
  }
  const answer = filled(q.answerText);
  return answer ? { ...base, kind: "short", answer } : null;
}

// ---- Blocks -------------------------------------------------------------------

const headingLevel = (level: unknown): 1 | 2 | 3 =>
  (typeof level === "number" ? Math.min(3, Math.max(1, Math.floor(level))) : 1) as 1 | 2 | 3;

function textBlock(block: Block, number: number): PublicBlock | null {
  switch (block.type) {
    case "heading":
      return { type: "text", kind: `heading${headingLevel(block.level)}`, text: block.text };
    case "paragraph":
    case "bulleted_list_item":
    case "quote":
      return { type: "text", kind: block.type, text: block.text };
    case "numbered_list_item":
      return { type: "text", kind: "numbered_list_item", text: block.text, number };
    case "todo":
      return { type: "text", kind: "todo", text: block.text, checked: block.checked === true };
    case "callout":
      return { type: "text", kind: "callout", text: block.text, ...(block.emoji ? { emoji: block.emoji } : {}) };
    default:
      return null;
  }
}

function publicBlock(
  block: Block,
  number: number,
  ws: Pick<Workspace, "databases">,
  o: PublicViewOptions,
): PublicBlock | null {
  const text = textBlock(block, number);
  if (text) return text;
  switch (block.type) {
    case "divider":
      return { type: "divider" };
    case "media": {
      if (block.mediaKind !== "image" || !isAssetIdShape(block.assetId)) return null;
      return {
        type: "image",
        src: shareAssetPath(o.token, block.assetId),
        alt: block.alt ?? block.caption ?? "",
        ...(block.caption ? { caption: block.caption } : {}),
      };
    }
    case "database_view": {
      const db = ws.databases.find((d) => d.id === block.databaseId);
      return db ? tableBlock(db, block.viewId, ws, o.today) : null;
    }
    case "flashcards": {
      const cards = (block.cards ?? [])
        .filter((c) => typeof c.front === "string" && typeof c.back === "string" && c.front.trim() && c.back.trim())
        .map((c) => ({ front: c.front, back: c.back }));
      if (cards.length === 0) return null;
      return { type: "flashcards", ...(block.title?.trim() ? { title: block.title } : {}), cards };
    }
    case "quiz": {
      const questions = (block.questions ?? []).map(publicQuestion).filter((q): q is PublicQuestion => q !== null);
      if (questions.length === 0) return null;
      return { type: "quiz", ...(block.title?.trim() ? { title: block.title } : {}), questions };
    }
    case "react_artifact":
      return { type: "hidden" };
    case "grades":
      // A grade calculator reads the student's grades: never shown, not even as a placeholder.
      return null;
    default:
      // A block type newer than this view: left out rather than shown wrongly.
      return null;
  }
}

/** Remove `secret` from every string in `value` (JSON-safe data only). */
export function scrubString<T>(value: T, secret: string | undefined, replacement = "…"): T {
  // Very short ids could match ordinary text; real workspace ids are UUIDs.
  if (!secret || secret.length < 8) return value;
  const json = JSON.stringify(value);
  if (!json.includes(secret)) return value;
  return JSON.parse(json.split(secret).join(replacement)) as T;
}

/**
 * A deep link into a StudyOS workspace (/app/<workspace uuid>, with any
 * ?page=, &block=, &db=, &row= ids), on any host or as a path. It names the
 * sharer's workspaces and pages, so it is replaced by "…" before anything is
 * sent. Never crosses a quote or backslash: it runs over JSON text.
 */
const DEEP_LINK =
  /(?:https?:\/\/[^\s/"'<>()[\]\\]+)?\/app\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[/?#][^\s"'<>()[\]\\]*)?/gi;

/** `value` without StudyOS deep links and without the workspace id anywhere in its text. */
export function scrubPrivate<T>(value: T, workspaceId: string | undefined): T {
  const json = JSON.stringify(value);
  const cleaned = json.replace(DEEP_LINK, "…");
  return scrubString(cleaned === json ? value : (JSON.parse(cleaned) as T), workspaceId);
}

/** A heading whose section is still being read (until a heading of the same or a higher level). */
interface OpenSection {
  /** Its index in the output. */
  at: number;
  level: number;
  /** The section held any block in the page. */
  content: boolean;
  /** Something in the section is shown to the visitor. */
  shown: boolean;
}

/** The read-only view of `page` sent to visitors. */
export function toPublicPage(page: Page, ws: Pick<Workspace, "id" | "databases">, o: PublicViewOptions): PublicPage {
  const out: (PublicBlock | null)[] = [];
  const open: OpenSection[] = [];
  // A heading goes when its section had blocks and every one was left out
  // (a "Grades" heading above a grade calculator); a heading with nothing
  // under it in the page itself stays, as the student wrote it.
  const closeSection = () => {
    const section = open.pop();
    if (!section) return;
    if (section.content && !section.shown) out[section.at] = null;
    else for (const parent of open) parent.shown = true;
  };

  let prev: Block | null = null;
  let number = 0;
  for (const block of page.blocks) {
    number = block.type === "numbered_list_item" ? (prev?.type === "numbered_list_item" ? number + 1 : 1) : 0;
    prev = block;
    const result = publicBlock(block, number, ws, o);
    if (block.type === "heading") {
      const level = headingLevel(block.level);
      while (open.length > 0 && open[open.length - 1].level >= level) closeSection();
      for (const parent of open) parent.content = true;
      out.push(result);
      open.push({ at: out.length - 1, level, content: false, shown: false });
      continue;
    }
    for (const section of open) {
      section.content = true;
      if (result) section.shown = true;
    }
    out.push(result);
  }
  while (open.length > 0) closeSection();

  const view: PublicPage = {
    title: page.title,
    ...(page.icon ? { icon: page.icon } : {}),
    blocks: out.filter((b): b is PublicBlock => b !== null),
  };
  return scrubPrivate(view, ws.id);
}

// ---- Assets -------------------------------------------------------------------

/** Every string of a public view that is rendered as Markdown (ShareRichText). */
export function renderedMarkdown(view: PublicPage): string[] {
  const out: string[] = [];
  for (const block of view.blocks) {
    if (block.type === "text") out.push(block.text);
    else if (block.type === "flashcards") for (const c of block.cards) out.push(c.front, c.back);
    else if (block.type === "quiz") {
      for (const q of block.questions) {
        out.push(q.prompt);
        if (q.explanation) out.push(q.explanation);
        if (q.kind === "mcq") out.push(...q.choices);
        if (q.kind === "short") out.push(q.answer);
      }
    }
  }
  return out;
}

const ASSET_ROUTE = /^\/api\/asset\/([A-Za-z0-9_-]{1,128})$/;
const SHARED_ASSET_SRC = /\/asset\/([A-Za-z0-9_-]{1,128})$/;
// Markdown image syntax: inline ![alt](url "title"), reference definitions
// [label]: url, reference images ![alt][label] / ![label][] / ![label], and
// raw HTML <img src> (Streamdown renders sanitized HTML).
const INLINE_IMAGE = /!\[(?:[^\]\\]|\\.)*\]\(\s*(?:<([^>\n]*)>|([^\s)]+))/g;
const REFERENCE_DEFINITION = /^ {0,3}\[((?:[^\]\\\n]|\\.)+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))/gm;
const REFERENCE_IMAGE = /!\[((?:[^\]\\]|\\.)*)\](?:\[((?:[^\]\\]|\\.)*)\])?(?!\()/g;
const HTML_IMAGE = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

const referenceLabel = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();

/** The uploaded asset an image `src` loads on a shared page (absolute links to the route included), or null. */
function assetIdOfImageSrc(raw: string | undefined): string | null {
  const src = raw ? safeImageSrc(raw) : null;
  const match = src ? ASSET_ROUTE.exec(src) : null;
  return match ? match[1] : null;
}

/** The uploaded assets that Markdown shows as images (links to an asset are not images). */
export function markdownImageAssetIds(text: string): string[] {
  const ids: string[] = [];
  const add = (src: string | undefined) => {
    const id = assetIdOfImageSrc(src);
    if (id) ids.push(id);
  };
  for (const m of text.matchAll(INLINE_IMAGE)) add(m[1] ?? m[2]);
  for (const m of text.matchAll(HTML_IMAGE)) add(m[1] ?? m[2] ?? m[3]);
  if (text.includes("]:")) {
    const definitions = new Map<string, string>();
    for (const m of text.matchAll(REFERENCE_DEFINITION)) {
      const label = referenceLabel(m[1]);
      // The first definition of a label wins, as in CommonMark.
      if (!definitions.has(label)) definitions.set(label, m[2] ?? m[3]);
    }
    for (const m of text.matchAll(REFERENCE_IMAGE)) {
      const label = referenceLabel(m[2] ? m[2] : m[1]);
      add(definitions.get(label));
    }
  }
  return ids;
}

/**
 * The asset ids a shared page may serve: exactly the images its public view
 * renders, i.e. its image blocks (mediaKind "image") and the uploaded images
 * that the Markdown it shows embeds as images. An asset named anywhere else
 * (a caption, a link, a hidden block, a question that is not shown) and
 * every other asset of the owner stays private, even with a valid link.
 */
export function publicAssetIds(view: PublicPage): Set<string> {
  const ids = new Set<string>();
  for (const block of view.blocks) {
    if (block.type !== "image") continue;
    const match = SHARED_ASSET_SRC.exec(block.src);
    if (match) ids.add(match[1]);
  }
  for (const text of renderedMarkdown(view)) {
    for (const id of markdownImageAssetIds(text)) ids.add(id);
  }
  return ids;
}
