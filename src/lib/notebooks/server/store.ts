/**
 * The notebooks store (server-only): notebooks, folders, pages and imported
 * PDF files in Postgres (models in prisma/schema.prisma), behind the
 * /api/notebooks routes.
 *
 * Rules every function keeps:
 *  - Owner-scoped: every query filters on `ownerId`; someone else's row is
 *    "not found". The one deliberate exception is the id-collision check
 *    (pageIdsTaken), which looks for an id anywhere so a client-chosen id can
 *    never land on, or reveal anything about, another student's row: a taken
 *    id is simply refused or skipped.
 *  - The trash: a notebook with `deletedAt` is invisible to everything except
 *    the shelf listing (which returns live and trashed notebooks; the client
 *    splits them), restore (PATCH trashed: false) and permanent delete.
 *  - Caps: notebooks and folders per student and PDF storage per student are
 *    checked and written in one transaction holding the student's
 *    "notebooks" advisory lock (lib/db-lock), so parallel requests cannot all
 *    pass a count at its boundary. Page changes take the notebook's own lock
 *    (notebookLockKey) in the same order (student, then notebook).
 *
 * Page and ink changes from the editor go through ./apply-batch.ts; PDF
 * imports through ./pdf-import.ts, which uses createNotebook and
 * insertPdfPages below.
 */
import "server-only";

import { prisma } from "@/lib/db";
import { lockKey, userLockKey, type LockedTx } from "@/lib/db-lock";
import { reportError } from "@/lib/ops/report-error";
import { EMPTY_PAGE } from "../codec";
import {
  MAX_FOLDERS_PER_USER,
  MAX_NOTEBOOKS_PER_USER,
  MAX_PAGES_PER_NOTEBOOK,
  newId,
  pageSize,
  type NotebookDetail,
  type NotebookFolder,
  type NotebookPaper,
  type NotebookSummary,
  type PageMeta,
  type PageTemplate,
} from "../model";
import { NotebookError } from "./errors";
import { deletePdfObjects, plainBytes, readPdfBytes } from "./file-store";
import { MAX_PDF_STORAGE_BYTES_PER_USER, notebookLockKey } from "./limits";
import { paperJson, parseCover, parsePaper, parseTemplate, templateJson, type NotebookPatch } from "./schemas";

type Db = LockedTx | typeof prisma;

/** Lock for one student's notebook count, folder count and PDF storage. */
export function userNotebooksLockKey(userId: string): string {
  return userLockKey("notebooks", userId);
}

/**
 * Run `fn` in one transaction holding the advisory locks for `keys`, taken
 * in the order given (always the student's before a notebook's).
 */
export async function withLocks<T>(keys: readonly string[], fn: (tx: LockedTx) => Promise<T>, timeoutMs = 20_000): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      for (const key of keys) await lockKey(tx, key);
      return fn(tx);
    },
    { maxWait: 10_000, timeout: timeoutMs },
  );
}

// ---- Rows to API shapes -----------------------------------------------------------

const SUMMARY_SELECT = {
  id: true,
  title: true,
  cover: true,
  folderId: true,
  workspaceId: true,
  pageCount: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const DETAIL_SELECT = { ...SUMMARY_SELECT, paper: true, version: true } as const;

export const PAGE_META_SELECT = {
  id: true,
  position: true,
  template: true,
  width: true,
  height: true,
  pdfFileId: true,
  pdfPage: true,
  inkVersion: true,
  strokeCount: true,
} as const;

interface SummaryRow {
  id: string;
  title: string;
  cover: string;
  folderId: string | null;
  workspaceId: string | null;
  pageCount: number;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface PageMetaRow {
  id: string;
  position: number;
  template: string;
  width: number;
  height: number;
  pdfFileId: string | null;
  pdfPage: number | null;
  inkVersion: number;
  strokeCount: number;
}

export function toPageMeta(row: PageMetaRow): PageMeta {
  return {
    id: row.id,
    position: row.position,
    template: parseTemplate(row.template),
    width: row.width,
    height: row.height,
    pdf: row.pdfFileId && row.pdfPage ? { fileId: row.pdfFileId, page: row.pdfPage } : null,
    inkVersion: row.inkVersion,
    strokeCount: row.strokeCount,
  };
}

function toSummary(row: SummaryRow, firstPageId: string | null): NotebookSummary {
  return {
    id: row.id,
    title: row.title,
    cover: parseCover(row.cover),
    folderId: row.folderId,
    workspaceId: row.workspaceId,
    pageCount: row.pageCount,
    firstPageId,
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toFolder(row: { id: string; name: string; createdAt: Date }): NotebookFolder {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

/** A notebook with its pages (no ink), or null. Trashed ones only when `trashed` is true. */
async function loadDetail(db: Db, ownerId: string, id: string, trashed = false): Promise<NotebookDetail | null> {
  const row = await db.notebook.findFirst({
    where: { id, ownerId, ...(trashed ? {} : { deletedAt: null }) },
    select: DETAIL_SELECT,
  });
  if (!row) return null;
  const pages = await db.notebookPage.findMany({
    where: { notebookId: id, ownerId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: PAGE_META_SELECT,
  });
  return {
    ...toSummary(row, pages[0]?.id ?? null),
    paper: parsePaper(row.paper),
    version: row.version,
    pages: pages.map(toPageMeta),
  };
}

// ---- Ownership checks -----------------------------------------------------------

/** The student's notebook that is not in the trash (id and version), or null. */
export async function findLiveNotebook(db: Db, ownerId: string, id: string) {
  return db.notebook.findFirst({ where: { id, ownerId, deletedAt: null }, select: { id: true, version: true } });
}

async function assertFolder(db: Db, ownerId: string, folderId: string | null | undefined): Promise<void> {
  if (!folderId) return;
  const folder = await db.notebookFolder.findFirst({ where: { id: folderId, ownerId }, select: { id: true } });
  if (!folder) throw new NotebookError("not_found", 404, { field: "folderId" });
}

async function assertWorkspace(db: Db, ownerId: string, workspaceId: string | null | undefined): Promise<void> {
  if (!workspaceId) return;
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!workspace) throw new NotebookError("not_found", 404, { field: "workspaceId" });
}

/** Of `ids`, those that already exist as a page anywhere (any notebook, any owner). */
export async function pageIdsTaken(db: Db, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.notebookPage.findMany({ where: { id: { in: [...ids] } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** Bytes of imported PDFs the student stores now. */
export async function pdfStorageUsed(db: Db, ownerId: string): Promise<number> {
  const sum = await db.notebookFile.aggregate({ where: { ownerId }, _sum: { sizeBytes: true } });
  return sum._sum.sizeBytes ?? 0;
}

// ---- The shelf ------------------------------------------------------------------

/** First page (lowest position) of each of the student's notebooks. */
async function firstPageIds(ownerId: string): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<{ notebookId: string; id: string }[]>`
    SELECT DISTINCT ON ("notebookId") "notebookId", "id"
    FROM "NotebookPage"
    WHERE "ownerId" = ${ownerId}
    ORDER BY "notebookId", "position" ASC, "id" ASC`;
  return new Map(rows.map((r) => [r.notebookId, r.id]));
}

/** Every notebook (live and trashed, most recently changed first) and folder of the student. */
export async function listNotebooks(ownerId: string): Promise<{ notebooks: NotebookSummary[]; folders: NotebookFolder[] }> {
  const [rows, folders, firsts] = await Promise.all([
    prisma.notebook.findMany({ where: { ownerId }, orderBy: { updatedAt: "desc" }, select: SUMMARY_SELECT }),
    prisma.notebookFolder.findMany({
      where: { ownerId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, createdAt: true },
    }),
    firstPageIds(ownerId),
  ]);
  return {
    notebooks: rows.map((row) => toSummary(row, firsts.get(row.id) ?? null)),
    folders: folders.map(toFolder),
  };
}

/** A live notebook with its pages ordered by position (no ink), or null. */
export async function getNotebook(ownerId: string, id: string): Promise<NotebookDetail | null> {
  return loadDetail(prisma, ownerId, id);
}

// ---- Creating ---------------------------------------------------------------------

/** A page to insert (server-side creations: the first page, PDF imports). */
export interface NewPage {
  id: string;
  position: number;
  template: PageTemplate;
  width: number;
  height: number;
  pdfFileId?: string | null;
  pdfPage?: number | null;
  pdfText?: string;
}

/** An imported PDF's row (its bytes are already stored, see ./file-store.ts). */
export interface NewFile {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  pageCount: number;
  storageKey: string | null;
  data: Uint8Array<ArrayBuffer> | null;
}

export interface CreateNotebookInput {
  id?: string;
  title: string;
  cover: string;
  folderId?: string | null;
  workspaceId?: string | null;
  paper: NotebookPaper;
  /** Id of the first page (client-generated); a new one when missing. */
  firstPageId?: string;
  /**
   * The pages to create instead of one blank first page (a PDF import), and
   * the file they show. With `pages: []` the notebook starts empty.
   */
  pages?: NewPage[];
  file?: NewFile;
}

function pageRow(ownerId: string, notebookId: string, page: NewPage) {
  return {
    id: page.id,
    notebookId,
    ownerId,
    position: page.position,
    template: templateJson(page.template),
    width: page.width,
    height: page.height,
    pdfFileId: page.pdfFileId ?? null,
    pdfPage: page.pdfPage ?? null,
    pdfText: page.pdfText ?? "",
    ink: plainBytes(EMPTY_PAGE),
  };
}

async function insertFile(tx: LockedTx, ownerId: string, notebookId: string, file: NewFile): Promise<void> {
  const used = await pdfStorageUsed(tx, ownerId);
  if (used + file.sizeBytes > MAX_PDF_STORAGE_BYTES_PER_USER) {
    throw new NotebookError("limit", 422, { limit: "storage" });
  }
  await tx.notebookFile.create({ data: { ...file, ownerId, notebookId } });
}

/**
 * Create a notebook with its first page (or the given pages). Idempotent for
 * a retried create: an id the student already uses for a live notebook
 * returns that notebook (`created: false`). An id taken otherwise, or a
 * first page id that exists anywhere, is refused (409 invalid). Folder and
 * linked workspace must be the student's (404 otherwise).
 */
export async function createNotebook(
  ownerId: string,
  input: CreateNotebookInput,
): Promise<{ notebook: NotebookDetail; created: boolean }> {
  const id = input.id ?? newId();
  return withLocks([userNotebooksLockKey(ownerId)], async (tx) => {
    const existing = await tx.notebook.findUnique({ where: { id }, select: { ownerId: true, deletedAt: true } });
    if (existing) {
      if (existing.ownerId === ownerId && !existing.deletedAt && !input.file) {
        const notebook = await loadDetail(tx, ownerId, id);
        if (notebook) return { notebook, created: false };
      }
      throw new NotebookError("invalid", 409, { field: "id" });
    }
    await assertFolder(tx, ownerId, input.folderId);
    await assertWorkspace(tx, ownerId, input.workspaceId);
    if ((await tx.notebook.count({ where: { ownerId } })) >= MAX_NOTEBOOKS_PER_USER) {
      throw new NotebookError("limit", 422, { limit: "notebooks" });
    }

    const pages: NewPage[] = input.pages ?? [
      { id: input.firstPageId ?? newId(), position: 1, template: input.paper.template, ...pageSize(input.paper) },
    ];
    if (pages.length > MAX_PAGES_PER_NOTEBOOK) throw new NotebookError("limit", 422, { limit: "pages" });
    if ((await pageIdsTaken(tx, pages.map((p) => p.id))).size > 0) {
      throw new NotebookError("invalid", 409, { field: "firstPageId" });
    }

    if (input.file) await insertFile(tx, ownerId, id, input.file);
    await tx.notebook.create({
      data: {
        id,
        ownerId,
        folderId: input.folderId ?? null,
        workspaceId: input.workspaceId ?? null,
        title: input.title,
        cover: input.cover,
        paper: paperJson(input.paper),
        pageCount: pages.length,
      },
    });
    if (pages.length > 0) {
      await tx.notebookPage.createMany({ data: pages.map((p) => pageRow(ownerId, id, p)) });
    }
    const notebook = await loadDetail(tx, ownerId, id);
    if (!notebook) throw new Error("created notebook not found");
    return { notebook, created: true };
  });
}

/**
 * Insert pages (an imported PDF's) after `afterPageId`, or at the end when it
 * is missing or no longer in the notebook. The file row is created in the
 * same transaction (storage cap checked under the student's lock), the
 * notebook's version is bumped and its page count kept.
 */
export async function insertPdfPages(
  ownerId: string,
  notebookId: string,
  afterPageId: string | null,
  pages: Omit<NewPage, "position">[],
  file: NewFile,
): Promise<NotebookDetail> {
  return withLocks([userNotebooksLockKey(ownerId), notebookLockKey(notebookId)], async (tx) => {
    const notebook = await findLiveNotebook(tx, ownerId, notebookId);
    if (!notebook) throw new NotebookError("not_found", 404);
    const existing = await tx.notebookPage.findMany({
      where: { notebookId, ownerId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, position: true },
    });
    if (existing.length + pages.length > MAX_PAGES_PER_NOTEBOOK) {
      throw new NotebookError("limit", 422, { limit: "pages" });
    }
    const at = afterPageId ? existing.findIndex((p) => p.id === afterPageId) : -1;
    const before = at >= 0 ? existing[at].position : (existing.at(-1)?.position ?? null);
    const after = at >= 0 ? (existing[at + 1]?.position ?? null) : null;
    const positions = spreadPositions(before, after, pages.length);

    await insertFile(tx, ownerId, notebookId, file);
    await tx.notebookPage.createMany({
      data: pages.map((p, i) => pageRow(ownerId, notebookId, { ...p, position: positions[i] })),
    });
    await tx.notebook.update({
      where: { id: notebookId },
      data: { version: { increment: 1 }, pageCount: existing.length + pages.length },
    });
    const detail = await loadDetail(tx, ownerId, notebookId);
    if (!detail) throw new Error("notebook vanished inside its own lock");
    return detail;
  });
}

/** `n` increasing order keys strictly between `a` and `b` (either may be missing: a list end). */
export function spreadPositions(a: number | null, b: number | null, n: number): number[] {
  const out: number[] = [];
  if (a !== null && b !== null) {
    for (let i = 1; i <= n; i++) out.push(a + ((b - a) * i) / (n + 1));
  } else if (a !== null) {
    for (let i = 1; i <= n; i++) out.push(a + i);
  } else if (b !== null) {
    for (let i = n; i >= 1; i--) out.push(b - i);
  } else {
    for (let i = 1; i <= n; i++) out.push(i);
  }
  return out;
}

// ---- Changing and deleting ----------------------------------------------------------

/**
 * Change a notebook's metadata, move it to the trash (`trashed: true`) or
 * restore it (`trashed: false`). A trashed notebook accepts only a restore
 * (other fields may come with it); anything else is "not found". Returns the
 * notebook as it is now (also when it was just trashed), or null when it is
 * not the student's. Metadata changes do not bump `version` (it tracks pages
 * and ink); `updatedAt` moves.
 */
export async function updateNotebook(ownerId: string, id: string, patch: NotebookPatch): Promise<NotebookDetail | null> {
  const row = await prisma.notebook.findFirst({ where: { id, ownerId }, select: { deletedAt: true } });
  if (!row) return null;
  if (row.deletedAt && patch.trashed !== false) return null;

  await assertFolder(prisma, ownerId, patch.folderId);
  await assertWorkspace(prisma, ownerId, patch.workspaceId);
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.cover !== undefined) data.cover = patch.cover;
  if (patch.folderId !== undefined) data.folderId = patch.folderId;
  if (patch.workspaceId !== undefined) data.workspaceId = patch.workspaceId;
  if (patch.paper !== undefined) data.paper = paperJson(patch.paper);
  if (patch.trashed === true && !row.deletedAt) data.deletedAt = new Date();
  if (patch.trashed === false) data.deletedAt = null;
  if (Object.keys(data).length > 0) {
    await prisma.notebook.updateMany({ where: { id, ownerId }, data });
  }
  return loadDetail(prisma, ownerId, id, true);
}

/**
 * Permanently delete a notebook from the trash (a live notebook is "not
 * found": it must be trashed first). Returns false when there was nothing to
 * delete.
 */
export async function deleteNotebookForever(ownerId: string, id: string): Promise<boolean> {
  const row = await prisma.notebook.findFirst({
    where: { id, ownerId, deletedAt: { not: null } },
    select: { id: true },
  });
  if (!row) return false;
  await purgeNotebook(ownerId, id);
  return true;
}

/**
 * Delete a notebook, its pages (ON DELETE CASCADE) and the PDFs it imported.
 * A PDF that a page of another of the owner's notebooks still shows is kept
 * and handed to that notebook. Stored objects that cannot be deleted now (an
 * outage) keep their row, detached (`notebookId` null), and the daily
 * maintenance retries them (retryOrphanedNotebookFiles).
 */
export async function purgeNotebook(ownerId: string, id: string): Promise<void> {
  const files = await prisma.notebookFile.findMany({
    where: { ownerId, notebookId: id },
    select: { id: true, storageKey: true },
  });
  const handedOver = new Set<string>();
  if (files.length > 0) {
    const refs = await prisma.notebookPage.findMany({
      where: { ownerId, notebookId: { not: id }, pdfFileId: { in: files.map((f) => f.id) } },
      select: { pdfFileId: true, notebookId: true },
      distinct: ["pdfFileId"],
    });
    for (const ref of refs) {
      if (!ref.pdfFileId) continue;
      await prisma.notebookFile.updateMany({
        where: { id: ref.pdfFileId, ownerId },
        data: { notebookId: ref.notebookId },
      });
      handedOver.add(ref.pdfFileId);
    }
  }
  const doomed = files.filter((f) => !handedOver.has(f.id));
  const keys = doomed.flatMap((f) => (f.storageKey ? [f.storageKey] : []));
  const { deleted } = await deletePdfObjects(keys);
  const gone = new Set(deleted);
  const removable = doomed.filter((f) => !f.storageKey || gone.has(f.storageKey)).map((f) => f.id);
  const pending = doomed.filter((f) => f.storageKey && !gone.has(f.storageKey)).map((f) => f.id);
  if (pending.length > 0) {
    reportError(new Error(`${pending.length} notebook PDF file(s) could not be deleted; kept for retry`), {
      source: "notebooks",
      userId: ownerId,
    });
  }
  await prisma.$transaction([
    prisma.notebookFile.deleteMany({ where: { ownerId, id: { in: removable } } }),
    prisma.notebookFile.updateMany({ where: { ownerId, id: { in: pending } }, data: { notebookId: null } }),
    prisma.notebook.deleteMany({ where: { id, ownerId } }),
  ]);
}

/** Notebooks purged per maintenance run (each may delete a few stored files). */
export const TRASH_PURGE_BATCH = 200;

/** Purge notebooks trashed before `cutoff` (lib/ops/retention). Returns how many. */
export async function purgeTrashedNotebooks(cutoff: Date, limit = TRASH_PURGE_BATCH): Promise<number> {
  const rows = await prisma.notebook.findMany({
    where: { deletedAt: { lt: cutoff } },
    orderBy: { deletedAt: "asc" },
    take: limit,
    select: { id: true, ownerId: true },
  });
  let purged = 0;
  for (const row of rows) {
    try {
      await purgeNotebook(row.ownerId, row.id);
      purged += 1;
    } catch (error) {
      // One notebook's failure never stops the rest; it is retried next run.
      reportError(error, { source: "retention", route: "purgeTrashedNotebooks" });
    }
  }
  return purged;
}

/** Stored PDF objects retried per maintenance run. */
export const ORPHAN_NOTEBOOK_FILE_BATCH = 200;

/**
 * Retry deleting the stored objects of PDF files that lost their notebook
 * (purgeNotebook could not delete them) or whose account was erased
 * (eraseUserData could not delete them). Removes each row once its object is
 * gone. Run daily by the maintenance job.
 */
export async function retryOrphanedNotebookFiles(
  limit = ORPHAN_NOTEBOOK_FILE_BATCH,
): Promise<{ retried: number; deleted: number }> {
  const rows = await prisma.$queryRaw<{ id: string; storageKey: string }[]>`
    SELECT f."id", f."storageKey"
    FROM "NotebookFile" f
    WHERE f."storageKey" IS NOT NULL
      AND (f."notebookId" IS NULL OR EXISTS (SELECT 1 FROM "DeletedAccount" d WHERE d."userId" = f."ownerId"))
    ORDER BY f."createdAt" ASC
    LIMIT ${limit}`;
  if (rows.length === 0) return { retried: 0, deleted: 0 };
  const { deleted } = await deletePdfObjects(rows.map((r) => r.storageKey));
  const gone = new Set(deleted);
  const ids = rows.filter((r) => gone.has(r.storageKey)).map((r) => r.id);
  if (ids.length > 0) await prisma.notebookFile.deleteMany({ where: { id: { in: ids } } });
  return { retried: rows.length, deleted: ids.length };
}

// ---- Folders ------------------------------------------------------------------------

/**
 * Create a folder. Idempotent for a retried create with the same id; an id
 * taken by another student is refused (409 invalid).
 */
export async function createFolder(ownerId: string, input: { id?: string; name: string }): Promise<NotebookFolder> {
  const id = input.id ?? newId();
  return withLocks([userNotebooksLockKey(ownerId)], async (tx) => {
    const existing = await tx.notebookFolder.findUnique({
      where: { id },
      select: { id: true, ownerId: true, name: true, createdAt: true },
    });
    if (existing) {
      if (existing.ownerId === ownerId) return toFolder(existing);
      throw new NotebookError("invalid", 409, { field: "id" });
    }
    if ((await tx.notebookFolder.count({ where: { ownerId } })) >= MAX_FOLDERS_PER_USER) {
      throw new NotebookError("limit", 422, { limit: "folders" });
    }
    const row = await tx.notebookFolder.create({
      data: { id, ownerId, name: input.name },
      select: { id: true, name: true, createdAt: true },
    });
    return toFolder(row);
  });
}

export async function renameFolder(ownerId: string, folderId: string, name: string): Promise<NotebookFolder | null> {
  const updated = await prisma.notebookFolder.updateMany({ where: { id: folderId, ownerId }, data: { name } });
  if (updated.count === 0) return null;
  const row = await prisma.notebookFolder.findFirst({
    where: { id: folderId, ownerId },
    select: { id: true, name: true, createdAt: true },
  });
  return row ? toFolder(row) : null;
}

/** Delete a folder; its notebooks (live and trashed) move to the shelf's root. */
export async function deleteFolder(ownerId: string, folderId: string): Promise<boolean> {
  const [, deleted] = await prisma.$transaction([
    prisma.notebook.updateMany({ where: { ownerId, folderId }, data: { folderId: null } }),
    prisma.notebookFolder.deleteMany({ where: { id: folderId, ownerId } }),
  ]);
  return deleted.count > 0;
}

// ---- Ink, texts and files -------------------------------------------------------------

/**
 * The stored ink of up to MAX_INK_PAGES_PER_READ pages of a live notebook
 * (pages not in it are left out), or null when the notebook is not the
 * student's live notebook.
 */
export async function readInk(
  ownerId: string,
  notebookId: string,
  pageIds: readonly string[],
): Promise<{ id: string; inkVersion: number; ink: string }[] | null> {
  if (!(await findLiveNotebook(prisma, ownerId, notebookId))) return null;
  if (pageIds.length === 0) return [];
  const rows = await prisma.notebookPage.findMany({
    where: { id: { in: [...pageIds] }, notebookId, ownerId },
    select: { id: true, inkVersion: true, ink: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return pageIds.flatMap((pid) => {
    const r = byId.get(pid);
    if (!r) return [];
    return [{ id: r.id, inkVersion: r.inkVersion, ink: Buffer.from(r.ink.buffer, r.ink.byteOffset, r.ink.byteLength).toString("base64") }];
  });
}

export interface PageTexts {
  id: string;
  position: number;
  pdfText: string;
  inkText: string;
  inkVersion: number;
  inkTextVersion: number;
  strokeCount: number;
}

/** Every page's PDF and handwriting text, in page order, or null (not the student's live notebook). */
export async function readTexts(ownerId: string, notebookId: string): Promise<PageTexts[] | null> {
  if (!(await findLiveNotebook(prisma, ownerId, notebookId))) return null;
  return prisma.notebookPage.findMany({
    where: { notebookId, ownerId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      id: true,
      position: true,
      pdfText: true,
      inkText: true,
      inkVersion: true,
      inkTextVersion: true,
      strokeCount: true,
    },
  });
}

/**
 * Keep a page's recognised handwriting, recorded as recognised at
 * `inkVersion`. Written only when the page is still in the student's live
 * notebook, its ink is at least that version (a client cannot claim a future
 * version), and no newer recognition was stored meanwhile. Returns whether it
 * was stored.
 */
export async function storeInkText(
  ownerId: string,
  notebookId: string,
  pageId: string,
  inkVersion: number,
  text: string,
): Promise<boolean> {
  const updated = await prisma.notebookPage.updateMany({
    where: {
      id: pageId,
      notebookId,
      ownerId,
      inkVersion: { gte: inkVersion },
      inkTextVersion: { lte: inkVersion },
      notebook: { ownerId, deletedAt: null },
    },
    data: { inkText: text, inkTextVersion: inkVersion },
  });
  return updated.count > 0;
}

/** Whether `pageId` is a page of the student's live notebook. */
export async function pageExists(ownerId: string, notebookId: string, pageId: string): Promise<boolean> {
  const row = await prisma.notebookPage.findFirst({
    where: { id: pageId, notebookId, ownerId, notebook: { ownerId, deletedAt: null } },
    select: { id: true },
  });
  return row !== null;
}

/** An imported PDF of the student, with its bytes, or null. */
export async function readNotebookFile(
  ownerId: string,
  fileId: string,
): Promise<{ name: string; sha256: string; bytes: Uint8Array } | null> {
  const row = await prisma.notebookFile.findFirst({
    where: { id: fileId, ownerId },
    select: { name: true, sha256: true, storageKey: true, data: true },
  });
  if (!row) return null;
  const bytes = await readPdfBytes(row);
  return bytes ? { name: row.name, sha256: row.sha256, bytes } : null;
}
