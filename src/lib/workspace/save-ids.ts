/**
 * Recent save ids of a workspace: which editor save produced which version.
 *
 * Every autosave carries an id the tab made up. The server records it with
 * the version the save produced, in a small bounded list stored with the
 * workspace (column `saveIds`), and hands the list back on a refused save and
 * with every read. A tab whose save landed although the reply never arrived
 * (or a draft left behind by a closed tab) can then tell for certain that its
 * changes are already in, and must not be applied a second time on top of
 * what happened since.
 *
 * `through` is the highest version among entries already dropped from the
 * list: the list answers "did save X land?" for a save based on version B
 * only when `through <= B` (otherwise its entry may have been dropped).
 */

export interface SaveLog {
  /** Highest version among dropped entries (0: nothing dropped yet). */
  through: number;
  /** [save id, version it produced], oldest first. */
  ids: Array<[string, number]>;
}

/** How many recent saves are remembered per workspace. */
export const SAVE_LOG_SIZE = 100;

const SAVE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function isSaveId(value: unknown): value is string {
  return typeof value === "string" && SAVE_ID.test(value);
}

export function emptySaveLog(): SaveLog {
  return { through: 0, ids: [] };
}

/** The stored column, read tolerantly (a damaged value is an empty log). */
export function parseSaveLog(raw: string | null | undefined): SaveLog {
  if (!raw) return emptySaveLog();
  try {
    const value = JSON.parse(raw) as { t?: unknown; s?: unknown };
    const through = typeof value.t === "number" && Number.isFinite(value.t) ? value.t : 0;
    const ids = Array.isArray(value.s)
      ? value.s.filter(
          (e): e is [string, number] =>
            Array.isArray(e) && isSaveId(e[0]) && typeof e[1] === "number" && Number.isFinite(e[1]),
        )
      : [];
    return { through, ids };
  } catch {
    return emptySaveLog();
  }
}

export function serializeSaveLog(log: SaveLog): string {
  return JSON.stringify({ t: log.through, s: log.ids });
}

/** The log with one more save, trimmed to SAVE_LOG_SIZE. */
export function appendSave(log: SaveLog, id: string, version: number): SaveLog {
  const ids = [...log.ids, [id, version] as [string, number]];
  let through = log.through;
  while (ids.length > SAVE_LOG_SIZE) {
    const [, v] = ids.shift()!;
    through = Math.max(through, v);
  }
  return { through, ids };
}

/** The version save `id` produced, if it is in the log. */
export function landedVersion(log: SaveLog | undefined, id: string): number | null {
  if (!log) return null;
  for (const [saveId, version] of log.ids) if (saveId === id) return version;
  return null;
}

/**
 * Can the log tell whether a save based on `baseVersion` landed? (Its entry,
 * if any, would have version baseVersion + 1 and cannot have been dropped.)
 */
export function logCovers(log: SaveLog | undefined, baseVersion: number): boolean {
  return !!log && log.through <= baseVersion;
}

/** A fresh save id. */
export function newSaveId(): string {
  const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32).padEnd(8, "0");
}
