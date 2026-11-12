/**
 * Turn a database cell into the text a person reads, shared by the CSV and
 * Markdown exports: option ids become their labels, relations become the
 * related rows' titles, checkboxes become TRUE/FALSE.
 */
import { titleProperty } from "@/lib/workspace/helpers";
import { findRow } from "@/lib/workspace/row-lookup";
import type { CellValue, Database, DatabaseProperty, Workspace } from "@/lib/workspace/types";

/** Separator between several values in one cell (multi-select, relation). */
export const MULTI_SEPARATOR = "; ";

function ids(value: CellValue): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" && value ? [value] : [];
}

export function cellText(
  ws: Pick<Workspace, "databases">,
  prop: DatabaseProperty,
  value: CellValue | undefined,
): string {
  if (value === null || value === undefined) return "";
  switch (prop.type) {
    case "checkbox":
      return value === true ? "TRUE" : "FALSE";
    case "select":
    case "status":
    case "multi_select": {
      const labels = new Map((prop.options ?? []).map((o) => [o.id, o.label] as const));
      return ids(value)
        .map((id) => labels.get(id) ?? "")
        .filter(Boolean)
        .join(MULTI_SEPARATOR);
    }
    case "relation": {
      const target = ws.databases.find((d) => d.id === prop.relationDatabaseId);
      const tp = target ? titleProperty(target) : undefined;
      return ids(value)
        .map((id) => {
          const row = target ? findRow(target, id) : undefined;
          const title = row && tp ? row.cells[tp.id] : undefined;
          return typeof title === "string" || typeof title === "number" ? String(title) : "";
        })
        .filter(Boolean)
        .join(MULTI_SEPARATOR);
    }
    default:
      return Array.isArray(value) ? value.join(MULTI_SEPARATOR) : String(value);
  }
}

/** The properties a view shows, in its order (all of them when unset). */
export function visibleProperties(db: Database, visibleIds?: string[]): DatabaseProperty[] {
  if (!visibleIds || visibleIds.length === 0) return db.properties;
  const shown = visibleIds
    .map((id) => db.properties.find((p) => p.id === id))
    .filter((p): p is DatabaseProperty => !!p);
  return shown.length > 0 ? shown : db.properties;
}
