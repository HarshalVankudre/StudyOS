/**
 * Database → CSV (RFC 4180), safe to open in Excel, Numbers or Google Sheets.
 *
 * - Fields containing a comma, quote, CR or LF (or leading/trailing spaces)
 *   are quoted, with quotes doubled.
 * - Formula injection is neutralised: a text cell beginning with =, +, -, @,
 *   a tab or a carriage return is prefixed with an apostrophe, so a
 *   spreadsheet shows it as text instead of evaluating it (OWASP guidance).
 *   Genuine numbers in number columns (for example -5) are left as numbers;
 *   they cannot carry a formula.
 * - Rows end with CRLF and the file starts with a UTF-8 byte-order mark so
 *   Excel reads accents and non-Latin scripts correctly.
 */
import type { Database, Workspace } from "@/lib/workspace/types";
import { cellText } from "./cells";

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

export const CSV_BOM = "﻿";

/** Neutralise a value a spreadsheet would treat as a formula. */
export function neutraliseFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Quote one field if needed. */
export function csvField(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV line from already-formatted texts (each is neutralised + quoted). */
export function csvLine(texts: string[]): string {
  return texts.map((t) => csvField(neutraliseFormula(t))).join(",");
}

/** The whole database as CSV text: a header row of column names, then one line per row. */
export function databaseToCsv(db: Database, ws: Pick<Workspace, "databases">): string {
  const lines = [csvLine(db.properties.map((p) => p.name))];
  for (const row of db.rows) {
    lines.push(
      db.properties
        .map((p) => {
          const value = row.cells[p.id];
          const text = cellText(ws, p, value);
          // A real number is data, not a formula: keep "-5" as -5.
          if (p.type === "number" && typeof value === "number" && Number.isFinite(value)) return text;
          return csvField(neutraliseFormula(text));
        })
        .join(","),
    );
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
