/**
 * A check the agent's apply_ops runs before a new row lands in the list of
 * graded work: is it an item the list already has? A student who first said
 * "I have a midterm" and later "the midterm is on March 5" means the same
 * midterm; adding a second, dated "Midterm exam" next to the undated one
 * splits its weight and shows two midterms in the calendar and the plan.
 *
 * Uses the syllabus matcher (src/lib/import/assessment-match), so "Midterm"
 * and "Midterm exam", "PS4" and "Problem Set 4", "Examen parcial" and
 * "Midterm" on the same day are the same item, while "Midterm 1" and
 * "Midterm 2" are not. Pure.
 */
import type { Database, DatabaseRow, Workspace } from "@/lib/workspace/types";
import { gradeDatabaseScore, resolveGradeColumns } from "@/lib/grades/workspace";
import { cellText } from "@/lib/grades/categories";
import { findGradedWorkDatabase } from "@/lib/grades/ensure";
import { assessmentKey, matchAssessments } from "@/lib/import/assessment-match";
import type { AgentOp } from "./agent-ops";

export interface DuplicateRow {
  databaseId: string;
  /** The row the agent wanted to add. */
  added: { id: string; title: string };
  /** The existing row it looks like. */
  existing: { id: string; title: string; dated: boolean };
}

function isGradedWork(workspace: Workspace, db: Database): boolean {
  return gradeDatabaseScore(db) > 0 || findGradedWorkDatabase(workspace)?.id === db.id;
}

/**
 * Every add_row (without `distinct: true`) whose row is confidently an item
 * the graded-work list already has, or plausibly one that has no date yet.
 * `before` is the workspace the ops apply to.
 */
export function findDuplicateRowAdds(before: Workspace, ops: readonly AgentOp[]): DuplicateRow[] {
  const out: DuplicateRow[] = [];
  for (const op of ops) {
    if (op.op !== "add_row" || op.distinct) continue;
    const db = before.databases.find((d) => d.id === op.databaseId);
    if (!db || !isGradedWork(before, db)) continue;
    const title = db.properties.find((p) => p.type === "text");
    if (!title) continue;
    const columns = resolveGradeColumns(db, undefined);
    const name = cellText(op.row.cells[title.id]);
    if (!name) continue;
    const due = (row: DatabaseRow) => (columns.due ? cellText(row.cells[columns.due.id]).slice(0, 10) : "");
    const course = (row: DatabaseRow) => (columns.course ? row.cells[columns.course.id] : undefined);
    const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    const newDue = due(op.row);
    for (const row of db.rows) {
      const other = cellText(row.cells[title.id]);
      if (!other) continue;
      const a = course(op.row);
      const b = course(row);
      if (!empty(a) && !empty(b) && JSON.stringify(a) !== JSON.stringify(b)) continue;
      const oldDue = due(row);
      const result = matchAssessments(name, other, { dateA: newDue || null, dateB: oldDue || null });
      // "Midterm 2" next to "Midterm" is more likely the second of two than the same one.
      const numbered = (t: string) => assessmentKey(t).numbers.length > 0;
      const plausible = result.strength === "maybe" && !oldDue && numbered(name) === numbered(other);
      if (result.strength === "same" || plausible) {
        out.push({ databaseId: db.id, added: { id: op.row.id, title: name }, existing: { id: row.id, title: other, dated: !!oldDue } });
        break;
      }
    }
  }
  return out;
}

/** What apply_ops tells the agent, so it updates the existing row instead. */
export function duplicateRowMessage(found: readonly DuplicateRow[]): string {
  return found
    .map(
      (d) =>
        `add_row "${d.added.title}" in [${d.databaseId}] looks like the existing row [${d.existing.id}] "${d.existing.title}"${d.existing.dated ? "" : " (no date yet)"}. ` +
        `If it is the same item, update_row [${d.existing.id}] (set its date and other cells) instead of adding a second row. ` +
        `Only if it really is a different item, send the add_row again with "distinct": true.`,
    )
    .join(" ");
}
