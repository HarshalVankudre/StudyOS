/**
 * Patch operations for the in-workspace AI agent.
 *
 * Instead of re-emitting the entire workspace on every edit (thousands of
 * wasted output tokens, slow, fragile), the editor model returns the SMALLEST
 * list of operations that expresses the change. The server applies them to the
 * saved workspace here, then validates the result with `safeParseWorkspace`
 * before it is ever persisted — so a malformed op can never corrupt data.
 */
import { z } from "zod";
import type { Database, DatabaseView, Workspace } from "@/lib/workspace/types";
import {
  blockSchema,
  cellValueSchema,
  databasePropertySchema,
  databaseRowSchema,
  databaseSchema,
  databaseViewSchema,
  gradeCategorySchema,
  gradesBlockSchema,
  pageSchema,
} from "@/lib/workspace/schema";
import { findGradeDatabase, resolveGradeColumns } from "@/lib/grades/workspace";
import { cellText } from "@/lib/grades/categories";
import { matchAssessments } from "@/lib/import/assessment-match";
import { reconcileAgentQuiz } from "@/lib/study/quiz";
import type { Block, QuizBlock } from "@/lib/workspace/types";
import { AGENT_LIMITS } from "./limits";
import {
  mergeView,
  viewPatchSchema,
  viewPresetSchema,
  viewWithPreset,
} from "./agent-view-ops";

// Untrusted op fields are length-bounded so a malicious/runaway result cannot
// smuggle a huge string or array through to the trusted apply path. Ids stay
// far under this; the cap only trips on pathological input.
const limitedString = z.string().max(AGENT_LIMITS.maxOpString);

export const agentOpSchema = z.discriminatedUnion("op", [
  // ---- rows (the common case) ----
  z.object({
    op: z.literal("update_row"),
    databaseId: limitedString,
    rowId: limitedString,
    cells: z.record(limitedString, cellValueSchema),
  }),
  // `distinct`: the agent checked that a similar existing row is another item (see agent-duplicates).
  z.object({ op: z.literal("add_row"), databaseId: limitedString, row: databaseRowSchema, distinct: z.boolean().optional() }),
  z.object({ op: z.literal("delete_row"), databaseId: limitedString, rowId: limitedString }),

  // ---- database meta ----
  z.object({
    op: z.literal("update_database"),
    databaseId: limitedString,
    name: limitedString.optional(),
    icon: limitedString.optional(),
    description: limitedString.optional(),
  }),
  z.object({ op: z.literal("add_database"), database: databaseSchema }),
  z.object({ op: z.literal("delete_database"), databaseId: limitedString }),
  // Escape hatch for large single-database restructuring (still one database,
  // not the whole workspace).
  z.object({ op: z.literal("replace_database"), database: databaseSchema }),

  // ---- properties ----
  z.object({ op: z.literal("add_property"), databaseId: limitedString, property: databasePropertySchema }),
  z.object({ op: z.literal("update_property"), databaseId: limitedString, property: databasePropertySchema }),
  z.object({ op: z.literal("delete_property"), databaseId: limitedString, propertyId: limitedString }),

  // ---- views ----
  z.object({
    op: z.literal("add_view"),
    databaseId: limitedString,
    view: databaseViewSchema,
    preset: viewPresetSchema.optional(),
  }),
  // A patch, not a replacement: omitted fields keep their saved value (see
  // ./agent-view-ops), so saved filters and sorts are never wiped by accident.
  z.object({
    op: z.literal("update_view"),
    databaseId: limitedString,
    view: viewPatchSchema,
    preset: viewPresetSchema.optional(),
  }),
  z.object({ op: z.literal("delete_view"), databaseId: limitedString, viewId: limitedString }),

  // ---- pages ----
  z.object({ op: z.literal("add_page"), page: pageSchema }),
  z.object({
    op: z.literal("update_page"),
    pageId: limitedString,
    title: limitedString.optional(),
    icon: limitedString.optional(),
  }),
  z.object({ op: z.literal("delete_page"), pageId: limitedString }),
  z.object({
    op: z.literal("set_page_blocks"),
    pageId: limitedString,
    blocks: z.array(blockSchema).max(AGENT_LIMITS.maxArray),
  }),
  z.object({ op: z.literal("replace_page"), page: pageSchema }),
  // Add a grades block (after `afterBlockId`, else at the end) or reconfigure
  // the one with the same id in place, without resending the page.
  // `categories` sets the grading categories of the courses it names (weights
  // many items share, "Homework 30%"); `assign` places rows by hand.
  z.object({
    op: z.literal("set_grades_block"),
    pageId: limitedString,
    block: gradesBlockSchema,
    afterBlockId: limitedString.optional(),
    categories: z.array(gradeCategorySchema.extend({ id: limitedString.optional() })).max(50).optional(),
    assign: z.record(limitedString, limitedString).optional(),
  }),

  // ---- workspace root ----
  z.object({
    op: z.literal("update_workspace"),
    name: limitedString.optional(),
    icon: limitedString.optional(),
    homePageId: limitedString.optional(),
  }),
]);

export type AgentOp = z.infer<typeof agentOpSchema>;

/**
 * An op list bounded by `maxOps`, used at every boundary that accepts an
 * untrusted result so the trusted apply path can never be handed an unbounded
 * array of operations.
 */
export const agentOpsSchema = z.array(agentOpSchema).min(1).max(AGENT_LIMITS.maxOps);

/**
 * Apply patch operations to a copy of the workspace and return the result.
 * Throws a descriptive error if an op references an id that doesn't exist, so
 * the route can report exactly what went wrong instead of silently no-op'ing.
 */
export function applyAgentOps(workspace: Workspace, ops: AgentOp[]): Workspace {
  const next: Workspace = structuredClone(workspace);

  const findDb = (id: string) => {
    const db = next.databases.find((d) => d.id === id);
    if (!db) throw new Error(`operation referenced unknown database "${id}"`);
    return db;
  };
  const findPage = (id: string) => {
    const page = next.pages.find((p) => p.id === id);
    if (!page) throw new Error(`operation referenced unknown page "${id}"`);
    return page;
  };
  // Quiz blocks the agent writes keep the student's stats/attempts when it
  // leaves them out, and any question it adds or changes must be complete.
  const quizzesBefore = new Map<string, QuizBlock>();
  for (const p of workspace.pages) {
    for (const b of p.blocks) if (b.type === "quiz") quizzesBefore.set(b.id, b);
  }
  const checkQuizzes = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type !== "quiz") continue;
      const problem = reconcileAgentQuiz(b, quizzesBefore.get(b.id));
      if (problem) throw new Error(problem);
    }
  };

  for (const op of ops) {
    switch (op.op) {
      case "update_row": {
        const db = findDb(op.databaseId);
        const row = db.rows.find((r) => r.id === op.rowId);
        if (!row)
          throw new Error(`update_row referenced unknown row "${op.rowId}" in "${op.databaseId}"`);
        row.cells = { ...row.cells, ...op.cells };
        break;
      }
      case "add_row":
        findDb(op.databaseId).rows.push(op.row);
        break;
      case "delete_row": {
        const db = findDb(op.databaseId);
        db.rows = db.rows.filter((r) => r.id !== op.rowId);
        break;
      }
      case "update_database": {
        const db = findDb(op.databaseId);
        if (op.name !== undefined) db.name = op.name;
        if (op.icon !== undefined) db.icon = op.icon;
        if (op.description !== undefined) db.description = op.description;
        break;
      }
      case "add_database":
        next.databases.push(op.database);
        break;
      case "delete_database":
        next.databases = next.databases.filter((d) => d.id !== op.databaseId);
        break;
      case "replace_database": {
        const index = next.databases.findIndex((d) => d.id === op.database.id);
        if (index === -1) next.databases.push(op.database);
        else {
          // A rewrite that leaves the grading scheme out keeps it (it is easy to forget).
          const kept = next.databases[index].grading;
          next.databases[index] = op.database.grading || !kept ? op.database : { ...op.database, grading: kept };
        }
        break;
      }
      case "add_property":
        findDb(op.databaseId).properties.push(op.property);
        break;
      case "update_property": {
        const db = findDb(op.databaseId);
        const index = db.properties.findIndex((p) => p.id === op.property.id);
        if (index === -1) db.properties.push(op.property);
        else db.properties[index] = op.property;
        break;
      }
      case "delete_property": {
        const db = findDb(op.databaseId);
        db.properties = db.properties.filter((p) => p.id !== op.propertyId);
        break;
      }
      case "add_view": {
        const db = findDb(op.databaseId);
        db.views.push(viewWithPreset(db, op.view, op.preset));
        break;
      }
      case "update_view": {
        const db = findDb(op.databaseId);
        const index = db.views.findIndex((v) => v.id === op.view.id);
        // An unknown id adds the view (the whole-workspace validation then
        // rejects it unless the patch was a complete view).
        if (index === -1) db.views.push(viewWithPreset(db, op.view as DatabaseView, op.preset));
        else db.views[index] = mergeView(db, db.views[index], op.view, op.preset);
        break;
      }
      case "delete_view": {
        const db = findDb(op.databaseId);
        db.views = db.views.filter((v) => v.id !== op.viewId);
        break;
      }
      case "add_page":
        checkQuizzes(op.page.blocks);
        next.pages.push(op.page);
        break;
      case "update_page": {
        const page = findPage(op.pageId);
        if (op.title !== undefined) page.title = op.title;
        if (op.icon !== undefined) page.icon = op.icon;
        break;
      }
      case "delete_page":
        next.pages = next.pages.filter((p) => p.id !== op.pageId);
        break;
      case "set_page_blocks":
        checkQuizzes(op.blocks);
        findPage(op.pageId).blocks = op.blocks;
        break;
      case "replace_page": {
        checkQuizzes(op.page.blocks);
        const index = next.pages.findIndex((p) => p.id === op.page.id);
        if (index === -1) next.pages.push(op.page);
        else next.pages[index] = op.page;
        break;
      }
      case "set_grades_block": {
        const page = findPage(op.pageId);
        if (op.block.databaseId) findDb(op.block.databaseId);
        const at = page.blocks.findIndex((b) => b.id === op.block.id);
        if (at >= 0) {
          if (page.blocks[at].type !== "grades") {
            throw new Error(`set_grades_block: block "${op.block.id}" is not a grades block`);
          }
          page.blocks[at] = op.block;
        } else {
          const after = op.afterBlockId ? page.blocks.findIndex((b) => b.id === op.afterBlockId) : -1;
          page.blocks.splice(after >= 0 ? after + 1 : page.blocks.length, 0, op.block);
        }
        if (op.categories || op.assign) {
          const dbId = op.block.databaseId ?? findGradeDatabase(next)?.id;
          if (!dbId) throw new Error("set_grades_block: categories need the block's databaseId");
          setGrading(findDb(dbId), op.categories ?? [], op.assign);
        }
        break;
      }
      case "update_workspace":
        if (op.name !== undefined) next.name = op.name;
        if (op.icon !== undefined) next.icon = op.icon;
        if (op.homePageId !== undefined) next.homePageId = op.homePageId;
        break;
    }
  }

  assertUniqueIds(next);
  return next;
}

type AgentCategory = NonNullable<Extract<AgentOp, { op: "set_grades_block" }>["categories"]>[number];

/**
 * The grading categories of every course `categories` names are replaced by
 * those given (other courses keep theirs); a category keeps its id when one
 * of the same course and name exists. A row the list kept for one of them
 * (same name, no date, no score) is removed: a category is never a row.
 */
function setGrading(db: Database, categories: AgentCategory[], assign: Record<string, string> | undefined) {
  db.grading ??= { categories: [] };
  const scheme = db.grading;
  const courses = new Set(categories.map((c) => c.course));
  const old = scheme.categories;
  const taken = new Set<string>();
  const fresh = categories.map((c) => {
    const same = old.find((o) => o.course === c.course && o.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    let id = c.id ?? same?.id ?? `cat-${c.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 24) || "group"}`;
    while (taken.has(id) || old.some((o) => o.id === id && !courses.has(o.course))) id = `${id}-2`;
    taken.add(id);
    return { ...c, id };
  });
  scheme.categories = [...old.filter((o) => !courses.has(o.course)), ...fresh];
  if (assign) {
    const ids = new Set(scheme.categories.map((c) => c.id));
    for (const [rowId, categoryId] of Object.entries(assign)) {
      if (categoryId !== "" && !ids.has(categoryId)) throw new Error(`set_grades_block: assign names unknown category "${categoryId}"`);
      if (!db.rows.some((r) => r.id === rowId)) throw new Error(`set_grades_block: assign names unknown row "${rowId}"`);
    }
    scheme.assign = { ...(scheme.assign ?? {}), ...assign };
  }
  const columns = resolveGradeColumns(db, undefined);
  const title = db.properties.find((p) => p.type === "text");
  if (!title) return;
  db.rows = db.rows.filter((row) => {
    const name = cellText(row.cells[title.id]);
    const dated = columns.due ? cellText(row.cells[columns.due.id]) !== "" : false;
    const scored = columns.score ? typeof row.cells[columns.score.id] === "number" : false;
    if (!name || dated || scored) return true;
    return !fresh.some((c) => matchAssessments(c.name, name).strength === "same" && name.trim().toLowerCase() === c.name.trim().toLowerCase());
  });
}

/**
 * Ids must be unique within each list (pages, blocks of a page, cards of a
 * deck, questions, databases, columns, rows, views, options): every edit is
 * addressed by id, so a reused id (an agent picking one that exists) would
 * make edits to either item ambiguous.
 */
function assertUniqueIds(ws: Workspace): void {
  const check = (items: { id: string }[], where: string) => {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) throw new Error(`duplicate id "${item.id}" in ${where}; use a new id`);
      seen.add(item.id);
    }
  };
  check(ws.pages, "pages");
  check(ws.databases, "databases");
  for (const page of ws.pages) {
    check(page.blocks, `the blocks of page "${page.id}"`);
    for (const block of page.blocks) {
      if (block.type === "flashcards") check(block.cards, `the cards of "${block.id}"`);
      else if (block.type === "quiz") check(block.questions, `the questions of "${block.id}"`);
    }
  }
  for (const db of ws.databases) {
    check(db.properties, `the columns of "${db.id}"`);
    check(db.rows, `the rows of "${db.id}"`);
    check(db.views, `the views of "${db.id}"`);
    for (const prop of db.properties) if (prop.options) check(prop.options, `the options of "${prop.id}"`);
  }
}
