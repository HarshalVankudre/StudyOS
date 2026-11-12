/**
 * What the agent model sees of a workspace, kept small.
 *
 * The tool loop used to resend the whole workspace JSON on every step, so a
 * single message on a large workspace could cost a month of credits. Instead
 * the model gets a compact outline (every id it might need, plus a sample of
 * rows), the full contents of only the areas the planner picked, and the
 * read_area / find_entities tools to look up anything else.
 *
 * Pure and deterministic: the same workspace always renders the same bytes,
 * which keeps the prompt prefix cacheable across the steps of a turn.
 */
import type {
  Block,
  Database,
  DatabaseRow,
  DatabaseView,
  Page,
  Workspace,
} from "@/lib/workspace/types";
import type { AgentOp } from "./agent-ops";

const OUTLINE_MAX_CHARS = 12_000;
const ROWS_PER_DATABASE = 12;
const FOCUS_MAX_CHARS = 16_000;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A short human label for a row: its first text value, then its first date. */
export function rowLabel(db: Database, row: DatabaseRow): string {
  const parts: string[] = [];
  const text = db.properties.find(
    (p) => p.type === "text" && typeof row.cells[p.id] === "string" && row.cells[p.id],
  );
  if (text) parts.push(`"${clip(String(row.cells[text.id]), 60)}"`);
  const date = db.properties.find((p) => p.type === "date" && typeof row.cells[p.id] === "string");
  if (date) parts.push(String(row.cells[date.id]));
  return parts.join(" · ") || "(untitled)";
}

function describeView(view: DatabaseView): string {
  const bits: string[] = [view.type];
  if (view.groupByPropertyId) bits.push(`by ${view.groupByPropertyId}`);
  if (view.datePropertyId) bits.push(`date ${view.datePropertyId}`);
  if (view.filters?.length) bits.push(`${view.filters.length} filter(s)`);
  if (view.sorts?.length) {
    bits.push(`sort ${view.sorts.map((s) => `${s.propertyId} ${s.direction}`).join(", ")}`);
  }
  return `[${view.id}] ${clip(view.name, 40)} (${bits.join("; ")})`;
}

function describeDatabase(db: Database, rowLimit: number): string {
  const props = db.properties
    .map((p) => {
      const options = p.options?.length
        ? `: ${p.options.map((o) => `${o.id}=${clip(o.label, 24)}`).join(", ")}`
        : "";
      const relation = p.relationDatabaseId ? ` → ${p.relationDatabaseId}` : "";
      return `[${p.id}] ${clip(p.name, 40)} (${p.type}${options}${relation})`;
    })
    .join("; ");
  const rows = db.rows.slice(0, rowLimit).map((r) => `[${r.id}] ${rowLabel(db, r)}`);
  const more = db.rows.length > rowLimit ? ` … +${db.rows.length - rowLimit} more (use find_entities / read_area)` : "";
  return [
    `- [${db.id}] ${db.icon ?? ""} ${clip(db.name, 60)} — ${db.rows.length} row(s)`,
    `  properties: ${props || "none"}`,
    `  views: ${db.views.map(describeView).join("; ") || "none"}`,
    `  rows: ${rows.join("; ") || "none"}${more}`,
  ].join("\n");
}

function describeBlock(block: Block): string {
  const b = block as Block & { text?: string; title?: string; databaseId?: string; viewId?: string };
  if (b.type === "database_view") return `database_view ${b.databaseId}/${b.viewId}`;
  const label = b.text ?? b.title;
  return label ? `${b.type} "${clip(label, 40)}"` : b.type;
}

function describePage(page: Page): string {
  const shown = page.blocks.slice(0, 6).map(describeBlock).join(", ");
  const more = page.blocks.length > 6 ? `, … +${page.blocks.length - 6} more` : "";
  return `- [${page.id}] ${page.icon ?? ""} ${clip(page.title, 60)} — ${page.blocks.length} block(s): ${shown}${more}`;
}

/** The compact outline, bounded to `maxChars` by sampling fewer rows if needed. */
export function workspaceOutline(ws: Workspace, maxChars = OUTLINE_MAX_CHARS): string {
  for (const rowLimit of [ROWS_PER_DATABASE, 5, 0]) {
    const text = [
      `Workspace "${clip(ws.name, 80)}"${ws.homePageId ? ` (home page ${ws.homePageId})` : ""}`,
      `Databases (${ws.databases.length}):`,
      ...ws.databases.map((db) => describeDatabase(db, rowLimit)),
      `Pages (${ws.pages.length}):`,
      ...ws.pages.map(describePage),
    ].join("\n");
    if (text.length <= maxChars || rowLimit === 0) {
      return text.length <= maxChars
        ? text
        : `${text.slice(0, maxChars)}\n… (outline cut; use find_entities / read_area)`;
    }
  }
  return "";
}

function fitArray<T>(items: T[], render: (subset: T[]) => string, maxChars: number): { json: string; shown: number } {
  let count = items.length;
  let json = render(items);
  while (json.length > maxChars && count > 0) {
    count = Math.max(0, Math.floor(count * 0.6));
    json = render(items.slice(0, count));
  }
  return { json, shown: count };
}

/** Full JSON of one area, rows/blocks trimmed to fit `maxChars`. */
export function areaJson(ws: Workspace, id: string, maxChars: number): string | null {
  const db = ws.databases.find((d) => d.id === id);
  if (db) {
    const { json, shown } = fitArray(db.rows, (rows) => JSON.stringify({ ...db, rows }), maxChars);
    return shown < db.rows.length
      ? `${json}\n(showing rows 1-${shown} of ${db.rows.length}; read_area {"id":"${db.id}","offset":${shown}} for more)`
      : json;
  }
  const page = ws.pages.find((p) => p.id === id);
  if (page) {
    const { json, shown } = fitArray(page.blocks, (blocks) => JSON.stringify({ ...page, blocks }), maxChars);
    return shown < page.blocks.length
      ? `${json}\n(showing blocks 1-${shown} of ${page.blocks.length}; read_area {"id":"${page.id}","offset":${shown}} for more)`
      : json;
  }
  return null;
}

/** The planner-chosen areas, in full where they fit, within `maxChars` total. */
export function focusAreas(ws: Workspace, ids: string[], maxChars = FOCUS_MAX_CHARS): string {
  const unique = [...new Set(ids)].slice(0, 6);
  if (unique.length === 0) return "";
  const each = Math.floor(maxChars / unique.length);
  return unique
    .map((id) => areaJson(ws, id, each))
    .filter((json): json is string => Boolean(json))
    .join("\n\n");
}

const NOTE_MAX_CHARS = 900;

/**
 * A compact, id-bearing note of what a turn changed, stored with the reply so
 * a follow-up ("make that one due Monday instead") can find the same item.
 */
export function summarizeOps(ops: AgentOp[], after: Workspace): string {
  const dbName = (id: string) => after.databases.find((d) => d.id === id)?.name ?? id;
  const lines = ops.map((op): string => {
    switch (op.op) {
      case "add_row": {
        const db = after.databases.find((d) => d.id === op.databaseId);
        const label = db ? rowLabel(db, op.row) : "";
        return `added row [${op.row.id}] ${label} to [${op.databaseId}] ${dbName(op.databaseId)}`;
      }
      case "update_row": {
        const db = after.databases.find((d) => d.id === op.databaseId);
        const row = db?.rows.find((r) => r.id === op.rowId);
        const label = db && row ? rowLabel(db, row) : "";
        return `updated row [${op.rowId}] ${label} in [${op.databaseId}] (${Object.keys(op.cells).join(", ")})`;
      }
      case "delete_row":
        return `deleted row [${op.rowId}] from [${op.databaseId}]`;
      case "add_view":
      case "update_view":
        return `${op.op === "add_view" ? "added" : "updated"} view [${op.view.id}] in [${op.databaseId}]`;
      case "delete_view":
        return `deleted view [${op.viewId}] from [${op.databaseId}]`;
      case "add_page":
      case "replace_page":
        return `${op.op === "add_page" ? "added" : "rewrote"} page [${op.page.id}] "${clip(op.page.title, 40)}"`;
      case "update_page":
      case "set_page_blocks":
      case "delete_page":
        return `${op.op.replace(/_/g, " ")} [${op.pageId}]`;
      case "add_database":
      case "replace_database":
        return `${op.op === "add_database" ? "added" : "rewrote"} database [${op.database.id}] "${clip(op.database.name, 40)}"`;
      default: {
        const anyOp = op as { op: string; databaseId?: string };
        return `${anyOp.op.replace(/_/g, " ")}${anyOp.databaseId ? ` [${anyOp.databaseId}]` : ""}`;
      }
    }
  });
  const text = lines.join("; ");
  return text.length > NOTE_MAX_CHARS ? `${text.slice(0, NOTE_MAX_CHARS - 1)}…` : text;
}
