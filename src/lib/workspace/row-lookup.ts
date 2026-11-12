/**
 * Constant-time row lookup by id, for resolving relation cells.
 *
 * Resolving a relation by `rows.find` per id is quadratic: a database of
 * 20,000 rows and one cell listing 130,000 ids took 15 seconds on the server.
 * `findRow` builds an id index once per rows array and reuses it.
 *
 * The index maps an id to its position and every hit is checked against the
 * live array (`rows[i].id === id`), so a row replaced, moved or removed in
 * place is never returned stale: a mismatch rebuilds the index once. A miss
 * rebuilds only when the array length changed since the index was built.
 */
import type { Database, DatabaseRow, Workspace } from "./types";

/**
 * Most related ids read from one relation cell when turning it into labels
 * (search text, calendar course names). A real cell links a handful of rows;
 * anything beyond this is not useful to a person reading the label.
 */
export const MAX_RELATION_IDS = 500;

interface RowIndex {
  length: number;
  at: Map<string, number>;
}

const indexes = new WeakMap<DatabaseRow[], RowIndex>();

function build(rows: DatabaseRow[]): RowIndex {
  const at = new Map<string, number>();
  rows.forEach((row, i) => {
    if (row && typeof row.id === "string" && !at.has(row.id)) at.set(row.id, i);
  });
  const index = { length: rows.length, at };
  indexes.set(rows, index);
  return index;
}

/** The row of `db` with this id, or undefined. */
export function findRow(db: Pick<Database, "rows">, id: unknown): DatabaseRow | undefined {
  if (typeof id !== "string") return undefined;
  const rows = db.rows;
  if (!Array.isArray(rows)) return undefined;
  let index = indexes.get(rows) ?? build(rows);
  let i = index.at.get(id);
  if (i === undefined) {
    if (index.length === rows.length) return undefined;
    index = build(rows);
    i = index.at.get(id);
    if (i === undefined) return undefined;
  }
  if (rows[i]?.id === id) return rows[i];
  i = build(rows).at.get(id);
  return i === undefined ? undefined : rows[i];
}

/** Databases by id for one workspace (built per call; workspaces have few databases). */
export function databaseById(ws: Pick<Workspace, "databases">, id: string | undefined): Database | undefined {
  return id ? ws.databases.find((d) => d.id === id) : undefined;
}

/** The ids of a relation cell, at most `max` of them, strings only. */
export function relationIds(value: unknown, max = MAX_RELATION_IDS): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string") out.push(v);
    if (out.length >= max) break;
  }
  return out;
}
