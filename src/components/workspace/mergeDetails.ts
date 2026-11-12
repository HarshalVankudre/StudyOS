/**
 * What the merge banner says about one value: where it is (in the student's
 * words: the row and column, the page) and the two values, as a person reads
 * them. The engine reports paths (lib/workspace/changes.ts `Overwrite`); a
 * student needs "Essay 2 · Due".
 */
import { cellText } from "@/lib/export/cells";
import type { Overwrite, Path } from "@/lib/workspace/changes";
import { titleProperty } from "@/lib/workspace/helpers";
import type { CellValue, Workspace } from "@/lib/workspace/types";

export interface ValueDetail {
  /** Where the value lives, or null when it has no name a student would know. */
  where: string | null;
  mine: string;
  theirs: string;
}

const MAX_TEXT = 60;
const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

function plain(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return clip(String(value));
  return "…";
}

const idOf = (path: Path, i: number): string | null => {
  const seg = path[i];
  return typeof seg === "object" ? seg.id : null;
};

/** `entry` in words, looked up in `workspace` (the document as it is now). */
export function describeValue(workspace: Workspace, entry: Overwrite): ValueDetail {
  const { path } = entry;
  if (path[0] === "databases") {
    const db = workspace.databases.find((d) => d.id === idOf(path, 1));
    if (db && path[2] === "rows" && path[4] === "cells" && typeof path[5] === "string") {
      const row = db.rows.find((r) => r.id === idOf(path, 3));
      const prop = db.properties.find((p) => p.id === path[5]);
      const title = row ? row.cells[titleProperty(db).id] : undefined;
      const rowName = typeof title === "string" && title.trim() ? title.trim() : db.name;
      const show = (value: unknown) => (prop ? clip(cellText(workspace, prop, value as CellValue)) || "—" : plain(value));
      return {
        where: clip(prop ? `${rowName} · ${prop.name}` : rowName),
        mine: show(entry.mine),
        theirs: show(entry.theirs),
      };
    }
    return { where: db ? clip(db.name) : null, mine: plain(entry.mine), theirs: plain(entry.theirs) };
  }
  if (path[0] === "pages") {
    const page = workspace.pages.find((p) => p.id === idOf(path, 1));
    const block = page && path[2] === "blocks" ? page.blocks.find((b) => b.id === idOf(path, 3)) : undefined;
    const text = block && "text" in block && typeof block.text === "string" ? block.text.trim() : "";
    const title = block && "title" in block && typeof block.title === "string" ? block.title.trim() : "";
    const name = text || title || page?.title || "";
    return { where: name ? clip(name) : null, mine: plain(entry.mine), theirs: plain(entry.theirs) };
  }
  return { where: null, mine: plain(entry.mine), theirs: plain(entry.theirs) };
}
