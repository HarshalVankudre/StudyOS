/**
 * Non-destructive database-view edits for the AI agent.
 *
 * `update_view` used to replace the whole view, so an edit that only renamed
 * a view (and omitted its saved filters and sorts) silently wiped the
 * student's settings. Views are now patched: only the fields the model sends
 * change, `null` removes a field, and a preset can fill in the common
 * "due soon, not done" settings with the same logic the editor uses.
 */
import { z } from "zod";
import type { Database, DatabaseView } from "@/lib/workspace/types";
import { viewFilterSchema, viewSortSchema } from "@/lib/workspace/schema";
import { upcomingViewSettings } from "@/lib/workspace/view-logic";
import { AGENT_LIMITS } from "./limits";

const limitedString = z.string().max(AGENT_LIMITS.maxOpString);
const nullable = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().optional();

/** A partial view: `id` picks the view; every other field is optional. */
export const viewPatchSchema = z.object({
  id: limitedString,
  name: limitedString.optional(),
  type: z.enum(["table", "board", "calendar", "list", "gallery"]).optional(),
  groupByPropertyId: nullable(limitedString),
  datePropertyId: nullable(limitedString),
  visiblePropertyIds: nullable(z.array(limitedString).max(AGENT_LIMITS.maxArray)),
  sorts: nullable(z.array(viewSortSchema).max(20)),
  filters: nullable(z.array(viewFilterSchema).max(30)),
  filterMatch: nullable(z.enum(["all", "any"])),
});

export type ViewPatch = z.infer<typeof viewPatchSchema>;

/**
 * Ready-made settings. `upcoming`: due within the next `days` days (today
 * included), not complete, soonest first, using the database's own
 * completion field (status "Done", a "Completed" checkbox, ...).
 */
export const viewPresetSchema = z.object({
  kind: z.literal("upcoming"),
  days: z.number().int().min(1).max(366).optional(),
  datePropertyId: limitedString.optional(),
});

export type ViewPreset = z.infer<typeof viewPresetSchema>;

const PATCH_KEYS = [
  "name",
  "type",
  "groupByPropertyId",
  "datePropertyId",
  "visiblePropertyIds",
  "sorts",
  "filters",
  "filterMatch",
] as const;

function presetSettings(db: Database, preset: ViewPreset | undefined) {
  if (!preset) return {};
  const settings = upcomingViewSettings(db, preset.datePropertyId, preset.days ?? 7);
  if (!settings) {
    throw new Error(`preset "upcoming" needs a date property in database "${db.id}"`);
  }
  return settings;
}

/**
 * Merge a patch (and an optional preset) into `base`. Fields absent from the
 * patch keep their saved value; `null` removes the field; arrays replace.
 */
export function mergeView(
  db: Database,
  base: DatabaseView,
  patch: ViewPatch,
  preset?: ViewPreset,
): DatabaseView {
  const next: Record<string, unknown> = { ...base, ...presetSettings(db, preset) };
  for (const key of PATCH_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  next.id = base.id;
  return next as unknown as DatabaseView;
}

/** A brand-new view from a full view plus an optional preset. */
export function viewWithPreset(db: Database, view: DatabaseView, preset?: ViewPreset): DatabaseView {
  if (!preset) return view;
  // Explicit fields on the view win over the preset's.
  const explicit = Object.fromEntries(
    Object.entries(view).filter(([, value]) => value !== undefined),
  );
  return { ...presetSettings(db, preset), ...explicit } as DatabaseView;
}

/** How the agent is told about views (kept next to the merge rules it describes). */
export const AGENT_VIEW_DOC = `Database views (sorting, filtering, "show only ..."):
- Prefer changing an existing view the student sees (the one embedded on their page) or add a new view; never delete a view to change it.
- update_view MERGES: send only the fields to change, e.g. {"op":"update_view","databaseId":"<id>","view":{"id":"<viewId>","sorts":[{"propertyId":"<dateProp>","direction":"asc"}]}}. Omitted fields keep their saved value; null removes a field; sorts/filters arrays replace the old ones (send [] to clear).
- View fields: sorts?: {propertyId, direction:"asc"|"desc"}[] (first key wins); filters?: {propertyId, operator, value?}[]; filterMatch?: "all"|"any" (default all).
- Filter operators by property type (value in brackets):
  text|url: contains, not_contains, is, is_not [string]; is_empty, is_not_empty
  number: eq, neq, gt, gte, lt, lte [number]; is_empty, is_not_empty
  checkbox: is [true|false]
  date: is, before, after, on_or_before, on_or_after ["YYYY-MM-DD" or "today"|"tomorrow"|"yesterday"]; next_days, past_days [number of days, today included]; overdue (no value: before today and not done); is_empty, is_not_empty
  select|status: is, is_not [option id, or an array of option ids = any of]; is_empty, is_not_empty
  multi_select|relation: contains, not_contains [id or ids]; is_empty, is_not_empty
- "Due this week / next N days, not done": add "preset":{"kind":"upcoming","days":7} to add_view or update_view (optional "datePropertyId"); it sets the date filter, the not-done filter and a soonest-first sort for you. Example: {"op":"update_view","databaseId":"<id>","view":{"id":"<viewId>","name":"This week"},"preset":{"kind":"upcoming","days":7}}.`;
