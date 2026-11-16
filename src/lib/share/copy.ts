/**
 * "Save a copy to my StudyOS": a shared page as a NEW workspace of the
 * visitor's own. Pure (no database): the server action saves the result
 * through the normal store path (lib/workspace/store saveNewWorkspace).
 *
 * The copy holds what the visitor could see on the shared page, nothing
 * more (lib/share/public-view.ts decides that):
 *  - every block gets a fresh id; a flashcard deck starts unscheduled and a
 *    quiz without scores or attempts (duplicateBlock); citations, which point
 *    into the sharer's own material, are dropped;
 *  - each table becomes a database of its own built from exactly what the
 *    page's views showed (public-view.ts viewProjection: the rows left after
 *    their filters, in their sort, cut at PUBLIC_ROW_CAP, in their columns):
 *    a cell is copied only when some view showed that column for that row,
 *    every other cell stays blank; a relation column, whose rows live in a
 *    database that is not copied, becomes text with the titles the visitor
 *    saw; a select keeps only the options its copied cells use; the
 *    database's description, imported-calendar markers, grading schemes and
 *    the values of the views' filters (a searched text, an option or row id)
 *    stay behind;
 *  - grade calculators and interactive components are not copied;
 *  - images are owned by the sharer, so another student's copy leaves them
 *    out (image blocks, and uploaded images inside Markdown become their alt
 *    text); the sharer's own copy keeps them;
 *  - deep links into the sharer's workspaces and their workspace id are
 *    removed from every text of another student's copy, as they are from
 *    the shared page.
 */
import { duplicateBlock, newId as randomId } from "@/components/workspace/editor/blockOps";
import { cellText } from "@/lib/export/cells";
import { operatorTakesValue } from "@/lib/workspace/view-logic";
import type {
  Block,
  CellValue,
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  Page,
  ViewFilter,
  Workspace,
} from "@/lib/workspace/types";
import { publicQuestion, resolveView, scrubPrivate, viewProjection, type ViewProjection } from "./public-view";

export interface CopyOptions {
  /** The person copying is the one who shared the page (their images stay). */
  sameOwner: boolean;
  /** The day database views are evaluated on (YYYY-MM-DD): the sharer's, in their time zone. */
  today: string;
  /** The new workspace's name when the page has no title. */
  untitled: string;
  /** Id source (tests pass a counter). */
  newId?: () => string;
}

const MARKDOWN_ASSET_IMAGE =
  /!\[([^\]]*)\]\(\s*<?[^)\s>]*\/api\/asset\/[^)\s>]*>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const HTML_ASSET_IMAGE = /<img\b[^>]*\/api\/asset\/[^>]*>/gi;

/** Markdown with uploaded images (which belong to someone else) replaced by their alt text. */
export function withoutAssetImages(text: string): string {
  return text.replace(MARKDOWN_ASSET_IMAGE, "$1").replace(HTML_ASSET_IMAGE, "");
}

interface DatabaseCopy {
  database: Database;
  /** Old view id (as resolved for a block) -> the copy's view id. */
  viewIds: Map<string, string>;
  /** The copy's view for a block whose database had no views. */
  fallbackViewId: string;
}

const hasOptions = (p: DatabaseProperty) => p.type === "select" || p.type === "status" || p.type === "multi_select";

/**
 * A shown cell as the copy keeps it, or undefined for a blank: a relation
 * becomes the titles the visitor saw, a select only options that exist
 * (an unknown option id showed nothing).
 */
function copiedCell(p: DatabaseProperty, value: CellValue | undefined, ws: Pick<Workspace, "databases">): CellValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (p.type === "relation") return cellText(ws, p, value) || undefined;
  if (hasOptions(p)) {
    const known = new Set((p.options ?? []).map((opt) => opt.id));
    if (p.type === "multi_select") {
      const ids = Array.isArray(value) ? value.filter((id) => known.has(id)) : [];
      return ids.length > 0 ? ids : undefined;
    }
    return typeof value === "string" && known.has(value) ? value : undefined;
  }
  return structuredClone(value);
}

/**
 * A view of the copy: its kind, name and shown columns; sorts, grouping and
 * dates on copied columns; and only filters that carry no value (empty,
 * overdue), since a value can name what the page never showed. With "any",
 * dropping one condition would hide rows the page showed, so none is kept.
 */
function copiedView(view: DatabaseView, id: string, shown: Set<string>, usable: (id: string | undefined) => boolean): DatabaseView {
  const copy: DatabaseView = { id, name: view.name, type: view.type };
  const visible = view.visiblePropertyIds?.filter((pid) => shown.has(pid));
  if (visible && visible.length > 0) copy.visiblePropertyIds = [...visible];
  const sorts = view.sorts?.filter((s) => usable(s.propertyId)).map((s) => ({ ...s }));
  if (sorts && sorts.length > 0) copy.sorts = sorts;
  const all = view.filters ?? [];
  const valueFree: ViewFilter[] = all
    .filter((f) => usable(f.propertyId) && !operatorTakesValue(f.operator))
    .map((f) => ({ propertyId: f.propertyId, operator: f.operator }));
  const keep = view.filterMatch === "any" ? (valueFree.length === all.length ? valueFree : []) : valueFree;
  if (keep.length > 0) {
    copy.filters = keep;
    if (view.filterMatch) copy.filterMatch = view.filterMatch;
  }
  if (usable(view.groupByPropertyId)) copy.groupByPropertyId = view.groupByPropertyId;
  if (usable(view.datePropertyId)) copy.datePropertyId = view.datePropertyId;
  return copy;
}

function copyDatabase(
  db: Database,
  viewIds: readonly string[],
  ws: Pick<Workspace, "databases">,
  o: Required<Pick<CopyOptions, "today" | "newId">>,
): DatabaseCopy {
  // What each distinct view on the page showed (the same projection as the shared table).
  const projections = new Map<string, ViewProjection>();
  for (const viewId of viewIds) {
    const projection = viewProjection(db, viewId, o.today);
    const key = projection.view?.id ?? "";
    if (!projections.has(key)) projections.set(key, projection);
  }

  // Row id -> the columns some view showed for it, rows in the order the page first showed them.
  const shownCells = new Map<string, { row: DatabaseRow; columns: Set<string> }>();
  const shownProps = new Set<string>();
  for (const { properties, rows } of projections.values()) {
    for (const p of properties) shownProps.add(p.id);
    for (const row of rows) {
      const entry = shownCells.get(row.id) ?? { row, columns: new Set<string>() };
      for (const p of properties) entry.columns.add(p.id);
      shownCells.set(row.id, entry);
    }
  }
  const kept = db.properties.filter((p) => shownProps.has(p.id));
  const converted = new Set(kept.filter((p) => p.type === "relation").map((p) => p.id));
  const usable = (id: string | undefined) => !!id && shownProps.has(id) && !converted.has(id);

  const usedOptions = new Map<string, Set<string>>();
  const rows: DatabaseRow[] = [...shownCells.values()].map(({ row, columns }) => {
    const cells: Record<string, CellValue> = {};
    for (const p of kept) {
      if (!columns.has(p.id)) continue;
      const value = copiedCell(p, row.cells[p.id], ws);
      if (value === undefined) continue;
      cells[p.id] = value;
      if (hasOptions(p)) {
        const used = usedOptions.get(p.id) ?? new Set<string>();
        for (const id of Array.isArray(value) ? value : [value]) used.add(String(id));
        usedOptions.set(p.id, used);
      }
    }
    return { id: o.newId(), cells };
  });

  const properties: DatabaseProperty[] = kept.map((p) => {
    if (p.type === "relation") return { id: p.id, name: p.name, type: "text" };
    const copy: DatabaseProperty = { id: p.id, name: p.name, type: p.type };
    if (hasOptions(p)) {
      const used = usedOptions.get(p.id);
      copy.options = (p.options ?? []).filter((opt) => used?.has(opt.id)).map((opt) => ({ ...opt }));
    }
    return copy;
  });

  const map = new Map<string, string>();
  const copiedViews: DatabaseView[] = [];
  for (const { view } of projections.values()) {
    if (!view) continue;
    const id = o.newId();
    map.set(view.id, id);
    copiedViews.push(copiedView(view, id, shownProps, usable));
  }
  const fallbackViewId = copiedViews[0]?.id ?? o.newId();
  if (copiedViews.length === 0) copiedViews.push({ id: fallbackViewId, name: db.name, type: "table" });

  return {
    database: {
      id: o.newId(),
      name: db.name,
      ...(db.icon ? { icon: db.icon } : {}),
      properties,
      rows,
      views: copiedViews,
    },
    viewIds: map,
    fallbackViewId,
  };
}

/** A text-bearing block's Markdown, as the copier may keep it. */
function cleanText(text: string, sameOwner: boolean): string {
  return sameOwner ? text : withoutAssetImages(text);
}

/** The new workspace holding a copy of `page`. */
export function buildPageCopy(page: Page, ws: Workspace, options: CopyOptions): Workspace {
  const newId = options.newId ?? randomId;
  const o = { today: options.today, newId };
  const { sameOwner } = options;

  // Databases shown on the page, each with the views its blocks use.
  const viewsByDb = new Map<string, string[]>();
  for (const block of page.blocks) {
    if (block.type !== "database_view") continue;
    if (!ws.databases.some((d) => d.id === block.databaseId)) continue;
    viewsByDb.set(block.databaseId, [...(viewsByDb.get(block.databaseId) ?? []), block.viewId]);
  }
  const copies = new Map<string, DatabaseCopy>();
  for (const [dbId, viewIds] of viewsByDb) {
    const db = ws.databases.find((d) => d.id === dbId)!;
    copies.set(dbId, copyDatabase(db, viewIds, ws, o));
  }

  const blocks: Block[] = [];
  for (const block of page.blocks) {
    switch (block.type) {
      case "grades":
      case "react_artifact":
        continue;
      case "media":
        if (sameOwner) blocks.push(duplicateBlock(block, newId()));
        continue;
      case "database_view": {
        const copy = copies.get(block.databaseId);
        if (!copy) continue;
        const resolved = ws.databases.find((d) => d.id === block.databaseId);
        const view = resolved ? resolveView(resolved, block.viewId) : undefined;
        blocks.push({
          id: newId(),
          type: "database_view",
          databaseId: copy.database.id,
          viewId: (view && copy.viewIds.get(view.id)) ?? copy.fallbackViewId,
        });
        continue;
      }
      case "flashcards": {
        const deck = duplicateBlock(block, newId());
        if (deck.type !== "flashcards") continue;
        deck.cards = deck.cards
          .filter((c) => c.front.trim() && c.back.trim())
          .map((c) => ({
            id: c.id,
            front: cleanText(c.front, sameOwner),
            back: cleanText(c.back, sameOwner),
          }));
        if (deck.cards.length > 0) blocks.push(deck);
        continue;
      }
      case "quiz": {
        const quiz = duplicateBlock(block, newId());
        if (quiz.type !== "quiz") continue;
        quiz.questions = quiz.questions
          .filter((q) => publicQuestion(q) !== null)
          .map((q) => {
            const clean = { ...q, prompt: cleanText(q.prompt, sameOwner) };
            delete clean.source;
            delete clean.stats;
            if (clean.choices) clean.choices = clean.choices.map((c) => cleanText(c, sameOwner));
            if (clean.answerText) clean.answerText = cleanText(clean.answerText, sameOwner);
            if (clean.explanation) clean.explanation = cleanText(clean.explanation, sameOwner);
            return clean;
          });
        if (quiz.questions.length > 0) blocks.push(quiz);
        continue;
      }
      default: {
        const copy = duplicateBlock(block, newId());
        delete copy.keptFrom;
        if ("text" in copy && typeof copy.text === "string") copy.text = cleanText(copy.text, sameOwner);
        blocks.push(copy);
      }
    }
  }

  const pageCopy: Page = {
    id: newId(),
    title: page.title,
    ...(page.icon ? { icon: page.icon } : {}),
    blocks,
  };
  const workspace: Workspace = {
    id: "",
    name: page.title.trim() || options.untitled,
    ...(page.icon ? { icon: page.icon } : {}),
    pages: [pageCopy],
    databases: [...copies.values()].map((c) => c.database),
    homePageId: pageCopy.id,
  };
  return sameOwner ? workspace : scrubPrivate(workspace, ws.id);
}
