/**
 * Which editor save produced which version: the one fact the sync engine
 * needs from the server to apply every change exactly once.
 *
 * A save is a compare-and-swap: "store this document if the workspace is still
 * at version B". It can therefore only ever produce version B + 1. When the
 * reply to such a save is lost, the tab asks one question: "was version B + 1
 * produced by my save?" This log answers it, and it says so when it cannot.
 *
 * Stored with the workspace row (column `saveIds`), written in the same
 * statement as the document, so the two can never disagree:
 *
 *   tabs            for each editor tab, the id of its latest save that landed
 *                   and the version it produced. One entry per tab, not per
 *                   save, so another device typing for hours evicts nothing.
 *   at              the version this log was last written at. Every writer in
 *                   this codebase (autosave, the AI agent, server-side edits)
 *                   keeps it equal to the row's version. A writer that does
 *                   not know the log (an instance of an older build during a
 *                   rolling deploy) leaves it behind, which is how its writes
 *                   are noticed.
 *   unknownThrough  versions up to this one may have been produced by a save
 *                   the log has no record of: written by such an older
 *                   instance, or by a tab whose entry was dropped to keep the
 *                   log small.
 *
 * The answer (`fateOfSends`) is one of:
 *   landed   the tab's entry names one of its saves: certain;
 *   pending  the workspace is still at version B: nothing landed yet (a
 *            request still on its way may);
 *   none     the workspace moved on, the log is complete from B + 1 on, and
 *            the tab's entry names none of its saves: certain;
 *   unknown  anything else. The engine never guesses in this case (see
 *            workspace-sync.ts, "uncertain").
 */

export interface SaveLog {
  v: 2;
  at: number;
  unknownThrough: number;
  tabs: Record<string, [saveId: string, version: number]>;
}

/** How many tabs are remembered per workspace (about 50 bytes each). */
export const SAVE_LOG_TABS = 100;

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const TAB = /^[A-Za-z0-9_-]{1,64}$/;

/** A save id: a random token made up by the tab for one save. */
export function isSaveId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

/** A tab id: a token naming one page load (the editor makes random ones). */
export function isTabId(value: unknown): value is string {
  return typeof value === "string" && TAB.test(value);
}

function isEntry(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && isSaveId(value[0]) && Number.isInteger(value[1]);
}

/** Is `value` a log in this format (what a current server sends)? */
export function isSaveLog(value: unknown): value is SaveLog {
  if (typeof value !== "object" || value === null) return false;
  const log = value as Partial<SaveLog>;
  if (log.v !== 2 || !Number.isInteger(log.at) || !Number.isInteger(log.unknownThrough)) return false;
  if (typeof log.tabs !== "object" || log.tabs === null || Array.isArray(log.tabs)) return false;
  return Object.entries(log.tabs).every(([tab, entry]) => isTabId(tab) && isEntry(entry));
}

/**
 * The stored column as it stands for a row at `rowVersion`. Anything that is
 * not a log kept in step with the row (an empty or damaged value, the format
 * of an earlier build, or `at` behind the row because a writer that does not
 * know the log saved since) means: who produced the versions up to
 * `rowVersion` is not known.
 */
export function readSaveLog(raw: string | null | undefined, rowVersion: number): SaveLog {
  let parsed: unknown = null;
  if (raw) {
    try {
      const value = JSON.parse(raw) as { v?: unknown; at?: unknown; u?: unknown; tabs?: unknown };
      parsed = { v: value?.v, at: value?.at, unknownThrough: value?.u, tabs: value?.tabs };
    } catch {
      parsed = null;
    }
  }
  if (!isSaveLog(parsed)) return { v: 2, at: rowVersion, unknownThrough: rowVersion, tabs: {} };
  if (parsed.at === rowVersion) return parsed;
  // Entries stay true (that save did produce that version); the gap is unknown.
  return { ...parsed, at: rowVersion, unknownThrough: Math.max(parsed.unknownThrough, rowVersion) };
}

export function serializeSaveLog(log: SaveLog): string {
  return JSON.stringify({ v: 2, at: log.at, u: log.unknownThrough, tabs: log.tabs });
}

/**
 * The log after a write that produces `newVersion`. `log` must be the log
 * read for the row at `newVersion - 1` (see `readSaveLog`). An editor save
 * passes its tab and save id; other writers pass neither and only keep the
 * log in step. A save that passes ids the log cannot record (a client of an
 * older build sends no tab id) makes its version one of unknown origin: the
 * log must never seem to say "no editor save produced this version".
 */
export function recordSave(log: SaveLog, newVersion: number, tabId?: string, saveId?: string): SaveLog {
  const tabs = { ...log.tabs };
  let unknownThrough = log.unknownThrough;
  if (isTabId(tabId) && isSaveId(saveId)) {
    // Re-inserted, so entries stay in the order their versions were produced.
    delete tabs[tabId];
    tabs[tabId] = [saveId, newVersion];
  } else if (tabId != null || saveId != null) {
    unknownThrough = Math.max(unknownThrough, newVersion);
  }
  const ids = Object.keys(tabs);
  if (ids.length > SAVE_LOG_TABS) {
    const oldestFirst = ids.sort((a, b) => tabs[a][1] - tabs[b][1]);
    for (const id of oldestFirst.slice(0, ids.length - SAVE_LOG_TABS)) {
      unknownThrough = Math.max(unknownThrough, tabs[id][1]);
      delete tabs[id];
    }
  }
  return { v: 2, at: newVersion, unknownThrough, tabs };
}

export type SendFate =
  | { fate: "landed"; saveId: string; version: number }
  | { fate: "pending" }
  | { fate: "none" }
  | { fate: "unknown" };

/**
 * What became of the saves `saveIds` that tab `tabId` sent on top of version
 * `baseVersion` and never got a reply for, given a read of the workspace at
 * `serverVersion` and the log that came with that same read (anything else
 * than a log in this format, as an older server sends, tells nothing).
 */
export function fateOfSends(
  log: unknown,
  serverVersion: number,
  tabId: string,
  baseVersion: number,
  saveIds: readonly string[],
): SendFate {
  if (saveIds.length === 0) return { fate: "none" };
  const known = isSaveLog(log) ? log : null;
  const entry = known?.tabs[tabId];
  if (entry && saveIds.includes(entry[0])) {
    // A save on top of B can only have produced B + 1; anything else is not ours to explain.
    return entry[1] === baseVersion + 1
      ? { fate: "landed", saveId: entry[0], version: entry[1] }
      : { fate: "unknown" };
  }
  // Still at B (or a read that lags behind it): nothing can be concluded yet.
  if (serverVersion <= baseVersion) return { fate: "pending" };
  if (known && known.at === serverVersion && baseVersion + 1 > known.unknownThrough) return { fate: "none" };
  return { fate: "unknown" };
}

function token(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** A fresh save id (about 95 random bits). */
export function newSaveId(): string {
  return token(16);
}

/** A fresh tab id: one per page load, never reused (see workspace-sync.ts). */
export function newTabId(): string {
  return token(16);
}
