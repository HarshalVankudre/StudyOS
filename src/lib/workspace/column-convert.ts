/**
 * Convert a database column to another property type, carrying values over
 * where a sensible conversion exists (text -> number, select -> status,
 * text -> select with options built from the distinct values, ...).
 *
 * Pure: returns the new property definition and the new cell per row plus a
 * count of values that could not be carried over, so the UI can ask for
 * confirmation before anything is lost.
 */
import type { CellValue, Database, DatabaseProperty, PropertyType, SelectOption } from "./types";
import { isDayKey } from "./view-logic";

export interface ConversionResult {
  property: DatabaseProperty;
  /** New cell value for every row, keyed by row id. */
  cells: Record<string, CellValue>;
  /** Rows whose non-empty value could not be carried over (fully). */
  lost: number;
  /** Rows whose non-empty value was carried over. */
  converted: number;
}

export interface ConversionOptions {
  /** Options to use for select/status/multi_select when none can be derived. */
  defaultOptions: (type: PropertyType) => SelectOption[];
  /** Id factory for new options (crypto.randomUUID in the app). */
  newId: () => string;
  /** Database a new relation column points to. */
  relationDatabaseId?: string;
}

const OPTION_TYPES: PropertyType[] = ["select", "status", "multi_select"];
const COLORS = ["blue", "amber", "green", "violet", "rose", "sky", "orange", "teal", "pink", "indigo", "lime", "zinc"];
const TRUE_WORDS = new Set(["true", "yes", "y", "x", "✓", "✔", "1", "done", "ja", "sí", "si", "oui", "sim", "是", "はい", "نعم"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "nein", "non", "não", "nee", "否", "いいえ", "لا", ""]);

function isEmpty(value: CellValue | undefined): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Parse "12", "1,5", "1,000.5", "80 %", " -3 " as numbers. */
export function parseNumber(text: string): number | null {
  let s = text.trim().replace(/[\s% ]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) {
    // Whichever separator comes last is the decimal one.
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse unambiguous dates: 2026-09-14, 2026/09/14, 14.09.2026, or an ISO timestamp. */
export function parseDay(text: string): string | null {
  const s = text.trim();
  const iso = s.slice(0, 10).replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && isDayKey(iso)) return iso;
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (dotted) {
    const key = `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`;
    return isDayKey(key) ? key : null;
  }
  return null;
}

function parseBool(text: string): boolean | null {
  const s = text.trim().toLocaleLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}

/** The value as plain text, or null when it has no text form. */
function asText(prop: DatabaseProperty, value: CellValue | undefined): string | null {
  if (isEmpty(value)) return null;
  switch (prop.type) {
    case "select":
    case "status":
    case "multi_select": {
      const ids = Array.isArray(value) ? value : [String(value)];
      const labels = ids
        .map((id) => prop.options?.find((o) => o.id === id)?.label)
        .filter((l): l is string => Boolean(l));
      return labels.length ? labels.join(", ") : null;
    }
    case "checkbox":
      return value === true ? "✓" : null;
    case "relation":
      return null;
    default:
      return typeof value === "string" ? value : String(value);
  }
}

/**
 * Convert column `propertyId` of `db` to `type`. Does not mutate `db`.
 * Throws if the property does not exist.
 */
export function convertProperty(
  db: Database,
  propertyId: string,
  type: PropertyType,
  opts: ConversionOptions,
): ConversionResult {
  const source = db.properties.find((p) => p.id === propertyId);
  if (!source) throw new Error(`unknown property "${propertyId}"`);

  const property: DatabaseProperty = { id: source.id, name: source.name, type };
  const cells: Record<string, CellValue> = {};
  let lost = 0;
  let converted = 0;

  if (source.type === type) {
    for (const row of db.rows) cells[row.id] = row.cells[propertyId] ?? null;
    return {
      property: structuredClone(source),
      cells,
      lost: 0,
      converted: db.rows.filter((r) => !isEmpty(r.cells[propertyId])).length,
    };
  }

  // ---- to an option type --------------------------------------------------
  if (OPTION_TYPES.includes(type)) {
    let options: SelectOption[] = [];
    const toIds: (value: CellValue | undefined) => string[] | null = (() => {
      if (OPTION_TYPES.includes(source.type)) {
        options = structuredClone(source.options ?? []);
        const known = new Set(options.map((o) => o.id));
        return (value) => {
          const ids = (Array.isArray(value) ? value : [String(value)]).filter((id) => known.has(id));
          return ids.length ? ids : null;
        };
      }
      if (source.type === "checkbox") {
        options = opts.defaultOptions(type);
        // Checked -> the last option ("Done" for status), unchecked -> empty.
        const done = options[options.length - 1]?.id;
        return (value) => (value === true && done ? [done] : value === false ? [] : null);
      }
      if (source.type === "relation") {
        options = opts.defaultOptions(type);
        return () => null;
      }
      // Text-like sources: one option per distinct value, in order of appearance.
      options = [];
      const byLabel = new Map<string, string>();
      const idFor = (label: string) => {
        const key = label.toLocaleLowerCase();
        let id = byLabel.get(key);
        if (!id) {
          id = opts.newId();
          byLabel.set(key, id);
          options.push({ id, label, color: COLORS[options.length % COLORS.length] });
        }
        return id;
      };
      return (value) => {
        const text = asText(source, value);
        if (text === null) return null;
        const labels =
          type === "multi_select" && source.type === "text"
            ? text.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
            : [text.trim()];
        return labels.length ? labels.map(idFor) : null;
      };
    })();

    for (const row of db.rows) {
      const value = row.cells[propertyId];
      if (isEmpty(value) || (source.type === "checkbox" && value !== true)) {
        cells[row.id] = type === "multi_select" ? [] : null;
        continue;
      }
      const ids = toIds(value);
      if (!ids || ids.length === 0) {
        cells[row.id] = type === "multi_select" ? [] : null;
        lost++;
        continue;
      }
      if (type === "multi_select") {
        cells[row.id] = ids;
      } else {
        cells[row.id] = ids[0];
        if (ids.length > 1) lost++;
        else converted++;
        continue;
      }
      converted++;
    }
    property.options = options.length ? options : opts.defaultOptions(type);
    return { property, cells, lost, converted };
  }

  // ---- to a scalar type ------------------------------------------------------
  if (type === "relation") property.relationDatabaseId = opts.relationDatabaseId;

  for (const row of db.rows) {
    const value = row.cells[propertyId];
    if (isEmpty(value) || (source.type === "checkbox" && value === false && type !== "number")) {
      cells[row.id] = null;
      continue;
    }
    let next: CellValue | undefined;
    const text = asText(source, value);
    switch (type) {
      case "text":
      case "url":
        next = text ?? undefined;
        break;
      case "number":
        if (source.type === "checkbox") next = value === true ? 1 : 0;
        else if (source.type === "date") next = undefined;
        else next = text === null ? undefined : (parseNumber(text) ?? undefined);
        break;
      case "checkbox":
        if (source.type === "number") next = Number(value) !== 0;
        else if (source.type === "date" || source.type === "relation") next = undefined;
        else next = text === null ? undefined : (parseBool(text) ?? undefined);
        break;
      case "date":
        next = text === null || source.type === "number" ? undefined : (parseDay(text) ?? undefined);
        break;
      case "relation":
        next = undefined;
        break;
    }
    if (next === undefined) {
      cells[row.id] = null;
      lost++;
    } else {
      cells[row.id] = next;
      converted++;
    }
  }
  return { property, cells, lost, converted };
}
