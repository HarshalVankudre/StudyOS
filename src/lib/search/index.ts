/**
 * Workspace search (pure; no database, no React).
 *
 * `buildSearchEntries` flattens one workspace into searchable entries: the
 * workspace itself, its pages, the text of its blocks, database rows,
 * flashcards and quiz questions. `searchEntries` ranks entries against a
 * query and groups the hits for the command palette. Every hit carries the
 * deep link that opens the exact place:
 *
 *   /app/<workspaceId>?page=<pageId>[&block=<blockId> | &db=<databaseId>&row=<rowId>]
 *
 * Scale: designed for a student with a dozen workspaces of up to a few
 * thousand blocks each. Matching is a linear scan over pre-folded strings,
 * which is well under a millisecond per thousand entries; the server keeps
 * built entries cached per workspace version (see ./server.ts), so a query
 * does not re-parse documents that have not changed.
 */
import { titleProperty } from "@/lib/workspace/helpers";
import type { Block, Database, DatabaseRow, Workspace } from "@/lib/workspace/types";
import { fold, plainText, queryWords, snippetAround } from "./text";

export type SearchKind = "workspace" | "page" | "row" | "block" | "card" | "question";

/** Display order of result groups in the palette. */
export const SEARCH_KIND_ORDER: readonly SearchKind[] = [
  "workspace",
  "page",
  "row",
  "block",
  "card",
  "question",
];

export interface SearchEntry {
  kind: SearchKind;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon?: string;
  pageId?: string;
  blockId?: string;
  databaseId?: string;
  rowId?: string;
  /** What the hit is called: a page title, a row's title cell, a card's front. */
  title: string;
  /** Further searchable text: a card's back, a row's other cells. */
  body: string;
  /** Where it lives, for recognition: "📚 Assignments", "🧮 Calculus notes". */
  context: string;
  icon?: string;
  /** Position inside the workspace (stable tiebreak: document order). */
  order: number;
  fTitle: string;
  fBody: string;
}

export interface SearchHit {
  kind: SearchKind;
  href: string;
  title: string;
  snippet: string;
  context: string;
  icon?: string;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon?: string;
  score: number;
}

export interface SearchGroup {
  kind: SearchKind;
  hits: SearchHit[];
}

export interface SearchResults {
  query: string;
  groups: SearchGroup[];
  /** Matches found before per-group caps were applied. */
  total: number;
}

/** Longest query the server accepts (characters). */
export const MAX_QUERY_LENGTH = 200;

/** Hits shown per group. */
export const GROUP_LIMIT: Record<SearchKind, number> = {
  workspace: 5,
  page: 6,
  row: 6,
  block: 6,
  card: 5,
  question: 5,
};

const KIND_WEIGHT: Record<SearchKind, number> = {
  workspace: 60,
  page: 50,
  row: 40,
  question: 30,
  card: 30,
  block: 20,
};

const TEXT_BLOCKS = new Set<Block["type"]>([
  "heading",
  "paragraph",
  "todo",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "callout",
]);

const enc = encodeURIComponent;

/** The deep link for an entry (see the URL contract above). */
export function entryHref(e: Pick<SearchEntry, "kind" | "workspaceId" | "pageId" | "blockId" | "databaseId" | "rowId">): string {
  const base = `/app/${enc(e.workspaceId)}`;
  if (e.kind === "workspace") return base;
  const params: string[] = [];
  if (e.pageId) params.push(`page=${enc(e.pageId)}`);
  if (e.kind === "row" && e.databaseId && e.rowId) {
    params.push(`db=${enc(e.databaseId)}`, `row=${enc(e.rowId)}`);
  } else if (e.blockId && (e.kind === "block" || e.kind === "card" || e.kind === "question")) {
    params.push(`block=${enc(e.blockId)}`);
  }
  return params.length ? `${base}?${params.join("&")}` : base;
}

/** The page that shows a database: the first page embedding one of its views. */
export function hostPageId(ws: Workspace, databaseId: string): string | undefined {
  for (const page of ws.pages) {
    if (page.blocks.some((b) => b.type === "database_view" && b.databaseId === databaseId)) {
      return page.id;
    }
  }
  return ws.homePageId ?? ws.pages[0]?.id;
}

function cellText(db: Database, row: DatabaseRow, skipId: string | undefined, ws: Workspace): string {
  const parts: string[] = [];
  for (const prop of db.properties) {
    if (prop.id === skipId) continue;
    const value = row.cells[prop.id];
    if (value === null || value === undefined || value === "") continue;
    switch (prop.type) {
      case "select":
      case "status":
      case "multi_select": {
        const ids = Array.isArray(value) ? value : [value];
        for (const id of ids) {
          const label = prop.options?.find((o) => o.id === id)?.label;
          if (label) parts.push(label);
        }
        break;
      }
      case "relation": {
        const target = ws.databases.find((d) => d.id === prop.relationDatabaseId);
        if (!target || !Array.isArray(value)) break;
        const tp = titleProperty(target);
        for (const id of value) {
          const r = target.rows.find((x) => x.id === id);
          const label = r && tp ? r.cells[tp.id] : undefined;
          if (typeof label === "string" && label) parts.push(label);
        }
        break;
      }
      case "checkbox":
        if (value === true) parts.push(prop.name);
        break;
      default:
        parts.push(String(value));
    }
  }
  return parts.join(" · ");
}

function label(icon: string | undefined, name: string): string {
  return icon ? `${icon} ${name}` : name;
}

/** Flatten one workspace into search entries, in document order. */
export function buildSearchEntries(ws: Workspace): SearchEntry[] {
  const out: SearchEntry[] = [];
  let order = 0;
  const base = {
    workspaceId: ws.id,
    workspaceName: ws.name,
    workspaceIcon: ws.icon || undefined,
  };
  const push = (e: Omit<SearchEntry, "fTitle" | "fBody" | "order" | keyof typeof base>) => {
    if (!e.title && !e.body) return;
    out.push({ ...base, ...e, order: order++, fTitle: fold(e.title), fBody: fold(e.body) });
  };

  push({ kind: "workspace", title: ws.name, body: "", context: "", icon: ws.icon || undefined });

  for (const page of ws.pages) {
    const pageLabel = label(page.icon, page.title);
    push({
      kind: "page",
      pageId: page.id,
      title: page.title,
      body: "",
      context: label(ws.icon, ws.name),
      icon: page.icon || undefined,
    });
    for (const block of page.blocks) {
      const at = { pageId: page.id, blockId: block.id, context: pageLabel };
      if (TEXT_BLOCKS.has(block.type) && "text" in block) {
        push({ kind: "block", ...at, title: plainText(block.text), body: "" });
      } else if (block.type === "media") {
        push({ kind: "block", ...at, title: plainText(block.caption ?? block.alt ?? ""), body: "" });
      } else if (block.type === "react_artifact" || block.type === "grades") {
        push({ kind: "block", ...at, title: block.title ?? "", body: "" });
      } else if (block.type === "flashcards") {
        const deck = block.title ? `${pageLabel} · ${block.title}` : pageLabel;
        for (const card of block.cards) {
          push({
            kind: "card",
            ...at,
            context: deck,
            title: plainText(card.front),
            body: plainText(card.back),
          });
        }
      } else if (block.type === "quiz") {
        const quiz = block.title ? `${pageLabel} · ${block.title}` : pageLabel;
        for (const q of block.questions ?? []) {
          const extra = [...(q.choices ?? []), q.answerText ?? "", q.explanation ?? "", q.topic ?? ""];
          push({
            kind: "question",
            ...at,
            context: quiz,
            title: plainText(q.prompt),
            body: plainText(extra.filter(Boolean).join(" · ")),
          });
        }
      }
    }
  }

  for (const db of ws.databases) {
    const tp = titleProperty(db);
    const pageId = hostPageId(ws, db.id);
    const dbLabel = label(db.icon, db.name);
    for (const row of db.rows) {
      const raw = tp ? row.cells[tp.id] : undefined;
      const title = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
      push({
        kind: "row",
        pageId,
        databaseId: db.id,
        rowId: row.id,
        title,
        body: cellText(db, row, tp?.id, ws),
        context: dbLabel,
        icon: db.icon || undefined,
      });
    }
  }
  return out;
}

/** True when `word` starts a word inside `text` (both folded). */
function atWordStart(text: string, word: string): boolean {
  let i = text.indexOf(word);
  while (i >= 0) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1])) return true;
    i = text.indexOf(word, i + 1);
  }
  return false;
}

/**
 * Score an entry, or null when it does not match. Every query word must
 * appear in the title or the body. Title matches outrank body matches; an
 * exact or prefix title match outranks everything else of its kind.
 */
export function scoreEntry(e: SearchEntry, words: string[], phrase: string): number | null {
  if (words.length === 0) return null;
  let inTitle = 0;
  let wordStarts = 0;
  for (const w of words) {
    const t = e.fTitle.includes(w);
    if (!t && !e.fBody.includes(w)) return null;
    if (t) {
      inTitle++;
      if (atWordStart(e.fTitle, w)) wordStarts++;
    }
  }
  let score = KIND_WEIGHT[e.kind];
  const title = e.fTitle.trim();
  if (title === phrase) score += 100;
  else if (title.startsWith(phrase)) score += 60;
  else if (title.includes(phrase)) score += 35;
  score += inTitle * 10 + wordStarts * 8;
  if (inTitle === 0) score -= 15;
  // Short, focused titles read as better matches than long paragraphs.
  score += Math.max(0, 10 - Math.floor(title.length / 25));
  return score;
}

function toHit(e: SearchEntry, score: number, words: string[]): SearchHit {
  const titleHit = words.some((w) => e.fTitle.includes(w));
  const bodyHit = words.some((w) => e.fBody.includes(w));
  const snippet = e.body && (bodyHit || !titleHit) ? snippetAround(e.body, words, 110) : "";
  return {
    kind: e.kind,
    href: entryHref(e),
    title: snippetAround(e.title || e.body, words, 100),
    snippet: e.title ? snippet : "",
    context: e.context,
    icon: e.icon,
    workspaceId: e.workspaceId,
    workspaceName: e.workspaceName,
    workspaceIcon: e.workspaceIcon,
    score,
  };
}

/**
 * Rank `entries` (from any number of workspaces, most recently used first)
 * against `query`, grouped by kind in palette order. An empty query returns
 * the workspaces themselves, in the given order, as a jump list.
 */
export function searchEntries(entries: readonly SearchEntry[], query: string): SearchResults {
  const q = query.trim().slice(0, MAX_QUERY_LENGTH);
  const words = queryWords(q);
  if (words.length === 0) {
    const hits = entries
      .filter((e) => e.kind === "workspace")
      .slice(0, 8)
      .map((e) => toHit(e, 0, []));
    return { query: q, groups: hits.length ? [{ kind: "workspace", hits }] : [], total: hits.length };
  }
  const phrase = words.join(" ");
  const scored: { e: SearchEntry; score: number; seq: number }[] = [];
  entries.forEach((e, seq) => {
    const score = scoreEntry(e, words, phrase);
    if (score !== null) scored.push({ e, score, seq });
  });
  scored.sort((a, b) => b.score - a.score || a.seq - b.seq);

  const byKind = new Map<SearchKind, SearchHit[]>();
  for (const { e, score } of scored) {
    const list = byKind.get(e.kind) ?? [];
    if (list.length >= GROUP_LIMIT[e.kind]) continue;
    list.push(toHit(e, score, words));
    byKind.set(e.kind, list);
  }
  const groups = SEARCH_KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    hits: byKind.get(kind)!,
  }));
  return { query: q, groups, total: scored.length };
}
