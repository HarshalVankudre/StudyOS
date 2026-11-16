/**
 * Cheap per-instance guards for the /api/notebooks routes (server-only), on
 * top of the database-backed usage limits (lib/usage-limits: notebook_pdf,
 * handwriting) that hold across instances.
 *
 * - Reads (shelf, detail, ink, texts, PDF bytes): opening a long notebook
 *   reads its ink 20 pages at a time while the student scrolls, so the cap
 *   is generous for a person and a wall for a loop.
 * - Writes (ops batches, metadata, folders, recognition): a device syncs its
 *   outbox every second or two while the student writes.
 * - PDF imports hold up to 30 MB of body each: one at a time per student and
 *   a few per instance, taken before the body is read.
 */
import "server-only";

import { createMemoryRateLimiter } from "@/lib/ops/memory-rate-limit";

export { readJsonBody } from "@/lib/materials/guard";

export const allowNotebookRead = createMemoryRateLimiter({ limit: 600, windowMs: 60_000 });
export const allowNotebookWrite = createMemoryRateLimiter({ limit: 300, windowMs: 60_000 });

const IMPORT_LIMITS = { perUser: 1, perInstance: 4 };
const importing = { total: 0, byUser: new Map<string, number>() };

/**
 * Take a PDF-import slot, or null when the student (or this instance) is
 * already at its cap. Call the returned release exactly once when done.
 */
export function acquireImportSlot(userId: string): (() => void) | null {
  const mine = importing.byUser.get(userId) ?? 0;
  if (mine >= IMPORT_LIMITS.perUser || importing.total >= IMPORT_LIMITS.perInstance) return null;
  importing.byUser.set(userId, mine + 1);
  importing.total += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    importing.total = Math.max(0, importing.total - 1);
    const left = (importing.byUser.get(userId) ?? 1) - 1;
    if (left <= 0) importing.byUser.delete(userId);
    else importing.byUser.set(userId, left);
  };
}
