/**
 * The grades module (lib/grades) as the planner's weight source: the weight
 * column the student picked in a grades block for this database (or the one
 * the grades module detects), read as percent of the course grade. Plugged
 * into the planner through `PlannerInput.weightOf`; when it has nothing to
 * say, the planner falls back to its own "Weight" column detection.
 */
import { detectGradeColumns, isGradeEntry, resolveGradeColumns, type ResolvedColumns } from "@/lib/grades";
import type { Database, GradesBlock, Workspace } from "@/lib/workspace/types";
import type { WeightResolver } from "./planner";

function gradesBlockFor(workspace: Workspace, database: Database): GradesBlock | undefined {
  for (const page of workspace.pages) {
    for (const block of page.blocks) {
      if (block.type === "grades" && block.databaseId === database.id) return block;
    }
  }
  return undefined;
}

export function gradesWeightResolver(): WeightResolver {
  const cache = new Map<Database, string | null>();
  return (workspace, database, row) => {
    let propertyId = cache.get(database);
    if (propertyId === undefined) {
      const block = gradesBlockFor(workspace, database);
      // A block of module grades has no weights: it says nothing (its score
      // column holds grades like 1.7, never a share of a course grade).
      const columns: ResolvedColumns = block
        ? isGradeEntry(block)
          ? {}
          : resolveGradeColumns(database, block.columns)
        : detectGradeColumns(database);
      propertyId = columns.weight?.id ?? null;
      cache.set(database, propertyId);
    }
    if (!propertyId) return undefined;
    const value = row.cells[propertyId];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
    // Percent, as the grade calculator reads it: 1 is a 1 % item, never 100 %.
    return Math.min(100, Math.round(value * 10) / 10);
  };
}
