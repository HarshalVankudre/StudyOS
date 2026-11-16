/**
 * Apply one batch of notebook ops (POST /api/notebooks/:id/ops), server-only.
 *
 * The whole batch runs in ONE transaction holding the notebook's advisory
 * lock (lib/db-lock withKeyLock on notebookLockKey), so two devices syncing
 * the same notebook apply their batches one after the other, and a batch is
 * applied completely or not at all (a malformed stroke record or an ink
 * limit refuses it with nothing written).
 *
 * Ops are applied in the order given, against an in-memory copy of the
 * notebook's pages (metadata only), so a `page.add` followed by ink on that
 * page in the same batch works, and so does delete-then-re-add. Ink ops are
 * collected per page in order and run through applyInkOps once per touched
 * page at the end, against the stored blob (each page's blob is read on its
 * own, so a batch touching many pages never holds them all in memory). Ink
 * ops for a page deleted later in the same batch are discarded with it.
 *
 * Ops that cannot apply are dropped and counted (`dropped`), never an error,
 * so a device's outbox always drains:
 *   - ink.*, page.move, page.template naming a page that is not in this
 *     notebook (deleted on another device);
 *   - page.add with an id that exists in another notebook or for another
 *     student (ids are client-chosen: a collision is skipped, never merged);
 *   - page.add showing a PDF page that is not one of the student's files, or
 *     past the file's last page.
 * A page.add whose id is already in this notebook is a retry: nothing
 * happens. Adding past MAX_PAGES_PER_NOTEBOOK refuses the batch (422 limit).
 *
 * At the end: changed pages get `inkVersion + 1` (once per batch), the
 * notebook's `version` is bumped once and `pageCount` set to the exact count.
 * A batch that changed nothing (a full retry of deletes and moves) bumps
 * nothing. Note that `ink.put` always counts as a change (applyInkOps does not
 * compare records), so a retried put batch moves inkVersion again; that is
 * harmless: the stroke is the same.
 */
import "server-only";

import { withKeyLock, type LockedTx } from "@/lib/db-lock";
import { CodecError, EMPTY_PAGE } from "../codec";
import { MAX_PAGES_PER_NOTEBOOK } from "../model";
import { applyInkOps, type InkOp, type Op } from "../ops";
import { NotebookError } from "./errors";
import { plainBytes } from "./file-store";
import { notebookLockKey } from "./limits";
import { templateJson } from "./schemas";
import { findLiveNotebook, PAGE_META_SELECT, pageIdsTaken } from "./store";

export interface BatchResult {
  /** The notebook's version after the batch. */
  version: number;
  /** Pages the batch added or changed (still in the notebook), with their ink state now. */
  pages: { id: string; inkVersion: number; strokeCount: number }[];
  /** Ops that could not apply (see the header). */
  dropped: number;
}

interface PageState {
  id: string;
  /** "db": stored before this batch; "new": added by it. */
  origin: "db" | "new";
  position: number;
  template: string;
  width: number;
  height: number;
  pdfFileId: string | null;
  pdfPage: number | null;
  inkVersion: number;
  strokeCount: number;
  /** Position or template changed (stored pages). */
  metaChanged: boolean;
  inkOps: InkOp[];
  /** The new blob, once ink ops changed it. */
  blob: Uint8Array | null;
}

/** applyInkOps, with a base64 that does not decode reported as a codec error (400). */
function applyInk(blob: Uint8Array, ops: InkOp[]) {
  try {
    return applyInkOps(blob, ops);
  } catch (error) {
    // atob throws a DOMException (InvalidCharacterError) on malformed base64.
    if (typeof DOMException !== "undefined" && error instanceof DOMException) {
      throw new CodecError("stroke record is not base64");
    }
    throw error;
  }
}

export async function applyBatch(ownerId: string, notebookId: string, ops: readonly Op[]): Promise<BatchResult> {
  return withKeyLock(notebookLockKey(notebookId), (tx) => applyBatchLocked(tx, ownerId, notebookId, ops));
}

/** The batch inside its transaction (exported for tests that drive a fake transaction). */
export async function applyBatchLocked(
  tx: LockedTx,
  ownerId: string,
  notebookId: string,
  ops: readonly Op[],
): Promise<BatchResult> {
  const notebook = await findLiveNotebook(tx, ownerId, notebookId);
  if (!notebook) throw new NotebookError("not_found", 404);

  const rows = await tx.notebookPage.findMany({ where: { notebookId, ownerId }, select: PAGE_META_SELECT });
  const pages = new Map<string, PageState>();
  for (const r of rows) {
    pages.set(r.id, { ...r, origin: "db", metaChanged: false, inkOps: [], blob: null });
  }
  const stored = new Set(rows.map((r) => r.id));

  // Ids this batch adds that are not this notebook's: any that exist belong
  // to another notebook or student, and are skipped.
  const adds = ops.filter((op): op is Extract<Op, { t: "page.add" }> => op.t === "page.add");
  const foreign = await pageIdsTaken(tx, [...new Set(adds.map((op) => op.id).filter((id) => !stored.has(id)))]);
  // PDF backgrounds must be the student's own files, within their page count.
  const fileIds = [...new Set(adds.flatMap((op) => (op.pdf ? [op.pdf.fileId] : [])))];
  const files = new Map(
    fileIds.length > 0
      ? (
          await tx.notebookFile.findMany({ where: { id: { in: fileIds }, ownerId }, select: { id: true, pageCount: true } })
        ).map((f) => [f.id, f.pageCount] as const)
      : [],
  );

  const deletedStored = new Set<string>();
  let dropped = 0;
  let changed = false;

  for (const op of ops) {
    switch (op.t) {
      case "page.add": {
        if (pages.has(op.id)) break; // a retry: already there
        if (foreign.has(op.id)) {
          dropped += 1;
          break;
        }
        if (op.pdf) {
          const filePages = files.get(op.pdf.fileId);
          if (filePages === undefined || op.pdf.page > filePages) {
            dropped += 1;
            break;
          }
        }
        if (pages.size >= MAX_PAGES_PER_NOTEBOOK) {
          throw new NotebookError("limit", 422, { limit: "pages" });
        }
        pages.set(op.id, {
          id: op.id,
          origin: "new",
          position: op.position,
          template: templateJson(op.template),
          width: op.width,
          height: op.height,
          pdfFileId: op.pdf?.fileId ?? null,
          pdfPage: op.pdf?.page ?? null,
          inkVersion: 0,
          strokeCount: 0,
          metaChanged: false,
          inkOps: [],
          blob: null,
        });
        changed = true;
        break;
      }
      case "page.del": {
        const page = pages.get(op.id);
        if (!page) break; // already gone
        pages.delete(op.id);
        if (page.origin === "db") deletedStored.add(op.id);
        changed = true;
        break;
      }
      case "page.move": {
        const page = pages.get(op.id);
        if (!page) {
          dropped += 1;
          break;
        }
        if (page.position !== op.position) {
          page.position = op.position;
          page.metaChanged = true;
          changed = true;
        }
        break;
      }
      case "page.template": {
        const page = pages.get(op.id);
        if (!page) {
          dropped += 1;
          break;
        }
        const json = templateJson(op.template);
        if (page.template !== json) {
          page.template = json;
          page.metaChanged = true;
          changed = true;
        }
        break;
      }
      case "ink.put":
      case "ink.del": {
        const page = pages.get(op.page);
        if (!page) {
          dropped += 1;
          break;
        }
        page.inkOps.push(op);
        break;
      }
    }
  }

  // Ink, one page at a time. A page deleted and re-added in this batch is
  // "new": it starts from an empty blob.
  const inkChanged = new Set<string>();
  for (const page of pages.values()) {
    if (page.inkOps.length === 0) continue;
    let base: Uint8Array = EMPTY_PAGE;
    if (page.origin === "db") {
      const row = await tx.notebookPage.findFirst({
        where: { id: page.id, notebookId, ownerId },
        select: { ink: true },
      });
      if (row) base = row.ink;
    }
    const next = applyInk(base, page.inkOps);
    if (!next) continue;
    page.blob = next.blob;
    page.strokeCount = next.strokeCount;
    page.inkVersion += 1;
    inkChanged.add(page.id);
    changed = true;
  }

  if (!changed) return { version: notebook.version, pages: [], dropped };

  if (deletedStored.size > 0) {
    await tx.notebookPage.deleteMany({ where: { id: { in: [...deletedStored] }, notebookId, ownerId } });
  }
  const created = [...pages.values()].filter((p) => p.origin === "new");
  if (created.length > 0) {
    await tx.notebookPage.createMany({
      data: created.map((p) => ({
        id: p.id,
        notebookId,
        ownerId,
        position: p.position,
        template: p.template,
        width: p.width,
        height: p.height,
        pdfFileId: p.pdfFileId,
        pdfPage: p.pdfPage,
        ink: plainBytes(p.blob ?? EMPTY_PAGE),
        inkVersion: p.inkVersion,
        strokeCount: p.strokeCount,
      })),
      // A concurrent add of the same id under another notebook's lock (a race
      // the foreign check cannot see) is skipped instead of failing the batch.
      skipDuplicates: true,
    });
  }
  for (const page of pages.values()) {
    if (page.origin !== "db" || (!page.metaChanged && !inkChanged.has(page.id))) continue;
    await tx.notebookPage.updateMany({
      where: { id: page.id, notebookId, ownerId },
      data: {
        ...(page.metaChanged ? { position: page.position, template: page.template } : {}),
        ...(inkChanged.has(page.id) && page.blob
          ? { ink: plainBytes(page.blob), inkVersion: page.inkVersion, strokeCount: page.strokeCount }
          : {}),
      },
    });
  }
  const updated = await tx.notebook.update({
    where: { id: notebookId },
    data: { version: { increment: 1 }, pageCount: pages.size },
    select: { version: true },
  });

  const touched = [...pages.values()].filter(
    (p) => p.origin === "new" || p.metaChanged || inkChanged.has(p.id),
  );
  return {
    version: updated.version,
    pages: touched.map((p) => ({ id: p.id, inkVersion: p.inkVersion, strokeCount: p.strokeCount })),
    dropped,
  };
}
