/**
 * How many Notion imports run at once (server-only, per instance).
 *
 * An import holds the upload (up to 25 MB) and what it inflates (up to
 * 120 MB) in this process for a few seconds, so one student runs one at a
 * time and an instance a few. The hourly limit (lib/usage-limits,
 * "notion_import") holds across instances; this bounds memory here and now.
 */
import "server-only";

export interface ImportSlotLimits {
  perUser: number;
  perInstance: number;
}

export const DEFAULT_IMPORT_SLOTS: Readonly<ImportSlotLimits> = { perUser: 1, perInstance: 2 };

interface SlotState {
  limits: ImportSlotLimits;
  total: number;
  byUser: Map<string, number>;
}

// On globalThis so every route bundle (and dev hot reloads) share one count.
const KEY = Symbol.for("studyos.notionImportSlots");

function state(): SlotState {
  const holder = globalThis as unknown as Record<symbol, SlotState | undefined>;
  holder[KEY] ??= { limits: { ...DEFAULT_IMPORT_SLOTS }, total: 0, byUser: new Map() };
  return holder[KEY]!;
}

/** Change the limits (tests); returns the previous ones. */
export function configureImportSlots(changes: Partial<ImportSlotLimits>): ImportSlotLimits {
  const s = state();
  const previous = { ...s.limits };
  s.limits = { ...s.limits, ...changes };
  return previous;
}

/** Take a slot, or null when the student (or this instance) is at its cap. Release exactly once. */
export function acquireImportSlot(userId: string): (() => void) | null {
  const s = state();
  const mine = s.byUser.get(userId) ?? 0;
  if (mine >= s.limits.perUser || s.total >= s.limits.perInstance) return null;
  s.total += 1;
  s.byUser.set(userId, mine + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    s.total -= 1;
    const left = (s.byUser.get(userId) ?? 1) - 1;
    if (left <= 0) s.byUser.delete(userId);
    else s.byUser.set(userId, left);
  };
}
