// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    notebook: { findFirst: fn(), findUnique: fn(), findMany: fn(), count: fn(), create: fn(), update: fn(), updateMany: fn(), deleteMany: fn() },
    notebookPage: { findMany: fn(), createMany: fn(), updateMany: fn(), findFirst: fn() },
    notebookFolder: { findFirst: fn(), findUnique: fn(), findMany: fn(), count: fn(), create: fn(), updateMany: fn(), deleteMany: fn() },
    notebookFile: { findMany: fn(), findFirst: fn(), aggregate: fn(), create: fn(), updateMany: fn(), deleteMany: fn() },
    workspace: { findFirst: fn() },
    $queryRaw: fn(),
    pdfDelete: fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    ...m,
    $transaction: async (arg: unknown) =>
      typeof arg === "function" ? (arg as (tx: unknown) => unknown)({ ...m }) : Promise.all(arg as unknown[]),
  },
}));
vi.mock("./file-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./file-store")>()),
  deletePdfObjects: m.pdfDelete,
}));

import { MAX_NOTEBOOKS_PER_USER, MAX_FOLDERS_PER_USER, DEFAULT_PAPER } from "../model";
import {
  createFolder,
  createNotebook,
  deleteFolder,
  deleteNotebookForever,
  getNotebook,
  listNotebooks,
  purgeNotebook,
  readInk,
  spreadPositions,
  storeInkText,
  updateNotebook,
} from "./store";

const OWNER = "user_alice";
const row = {
  id: "notebook0001",
  title: "Bio",
  cover: "teal",
  folderId: null,
  workspaceId: null,
  pageCount: 1,
  updatedAt: new Date(0),
  deletedAt: null,
  paper: JSON.stringify(DEFAULT_PAPER),
  version: 4,
};
const pageRow = {
  id: "page00000001",
  position: 1,
  template: '{"kind":"grid","paper":"cream"}',
  width: 794,
  height: 1123,
  pdfFileId: null,
  pdfPage: null,
  inkVersion: 2,
  strokeCount: 5,
};

beforeEach(() => {
  m.notebook.findFirst.mockResolvedValue(row);
  m.notebook.findUnique.mockResolvedValue(null);
  m.notebook.findMany.mockResolvedValue([row]);
  m.notebook.count.mockResolvedValue(0);
  m.notebook.updateMany.mockResolvedValue({ count: 1 });
  m.notebook.deleteMany.mockResolvedValue({ count: 1 });
  m.notebookPage.findMany.mockResolvedValue([pageRow]);
  m.notebookPage.updateMany.mockResolvedValue({ count: 1 });
  m.notebookFolder.findFirst.mockResolvedValue({ id: "folder000001" });
  m.notebookFolder.count.mockResolvedValue(0);
  m.notebookFolder.findMany.mockResolvedValue([{ id: "folder000001", name: "Sem 1", createdAt: new Date(0) }]);
  m.notebookFolder.create.mockImplementation(async ({ data }: { data: { id: string; name: string } }) => ({ ...data, createdAt: new Date(0) }));
  m.notebookFolder.updateMany.mockResolvedValue({ count: 1 });
  m.notebookFolder.deleteMany.mockResolvedValue({ count: 1 });
  m.notebookFile.findMany.mockResolvedValue([]);
  m.notebookFile.updateMany.mockResolvedValue({ count: 0 });
  m.notebookFile.deleteMany.mockResolvedValue({ count: 0 });
  m.workspace.findFirst.mockResolvedValue({ id: "ws-1" });
  m.$queryRaw.mockResolvedValue([{ notebookId: "notebook0001", id: "page00000001" }]);
  m.pdfDelete.mockImplementation(async (keys: string[]) => ({ deleted: keys, failed: 0 }));
});

describe("reading", () => {
  it("lists the student's notebooks (live and trashed) with their first page, and folders", async () => {
    const shelf = await listNotebooks(OWNER);
    expect(m.notebook.findMany.mock.calls[0][0].where).toEqual({ ownerId: OWNER });
    expect(m.notebookFolder.findMany.mock.calls[0][0].where).toEqual({ ownerId: OWNER });
    expect(m.$queryRaw.mock.calls[0][1]).toBe(OWNER);
    expect(shelf.notebooks[0]).toMatchObject({ id: "notebook0001", firstPageId: "page00000001", cover: "teal", deletedAt: null });
    expect(shelf.folders).toEqual([{ id: "folder000001", name: "Sem 1", createdAt: new Date(0).toISOString() }]);
  });

  it("opens only a live notebook of the student, pages in order with parsed templates", async () => {
    const detail = await getNotebook(OWNER, "notebook0001");
    expect(m.notebook.findFirst.mock.calls[0][0].where).toEqual({ id: "notebook0001", ownerId: OWNER, deletedAt: null });
    expect(m.notebookPage.findMany.mock.calls[0][0].where).toEqual({ notebookId: "notebook0001", ownerId: OWNER });
    expect(detail?.pages).toEqual([
      {
        id: "page00000001",
        position: 1,
        template: { kind: "grid", paper: "cream" },
        width: 794,
        height: 1123,
        pdf: null,
        inkVersion: 2,
        strokeCount: 5,
      },
    ]);
    expect(detail?.paper).toEqual(DEFAULT_PAPER);
    m.notebook.findFirst.mockResolvedValue(null);
    expect(await getNotebook("user_bob", "notebook0001")).toBeNull();
  });

  it("reads ink only from the student's live notebook, in the order asked, leaving out unknown pages", async () => {
    m.notebookPage.findMany.mockResolvedValue([
      { id: "page00000002", inkVersion: 1, ink: new Uint8Array([1, 2, 3]) },
      { id: "page00000001", inkVersion: 4, ink: new Uint8Array([0x53, 0x4e, 0x01]) },
    ]);
    const pages = await readInk(OWNER, "notebook0001", ["page00000001", "page00000002", "pageUnknown1"]);
    expect(pages).toEqual([
      { id: "page00000001", inkVersion: 4, ink: "U04B" },
      { id: "page00000002", inkVersion: 1, ink: "AQID" },
    ]);
    expect(m.notebookPage.findMany.mock.calls[0][0].where).toMatchObject({ notebookId: "notebook0001", ownerId: OWNER });
    m.notebook.findFirst.mockResolvedValue(null);
    expect(await readInk(OWNER, "notebook0001", ["page00000001"])).toBeNull();
  });
});

describe("creating", () => {
  const input = { title: "Chem", cover: "red", paper: DEFAULT_PAPER, id: "notebookNew1", firstPageId: "pageFirst001" };

  it("creates a notebook with one first page of its paper under the student's lock", async () => {
    m.notebookPage.findMany.mockResolvedValueOnce([]); // the id-collision check
    const { created } = await createNotebook(OWNER, input);
    expect(created).toBe(true);
    expect(m.$queryRaw.mock.calls[0][1]).toBe(`studyos:limit:notebooks:${OWNER}`);
    expect(m.notebook.create.mock.calls[0][0].data).toMatchObject({ id: "notebookNew1", ownerId: OWNER, pageCount: 1 });
    const page = m.notebookPage.createMany.mock.calls[0][0].data[0];
    expect(page).toMatchObject({ id: "pageFirst001", ownerId: OWNER, width: 794, height: 1123, template: '{"kind":"ruled","paper":"white"}' });
  });

  it("returns the existing notebook for a retried create, refuses someone else's id", async () => {
    m.notebook.findUnique.mockResolvedValue({ ownerId: OWNER, deletedAt: null });
    expect((await createNotebook(OWNER, input)).created).toBe(false);
    expect(m.notebook.create).not.toHaveBeenCalled();
    m.notebook.findUnique.mockResolvedValue({ ownerId: "user_bob", deletedAt: null });
    await expect(createNotebook(OWNER, input)).rejects.toMatchObject({ code: "invalid", status: 409 });
  });

  it("refuses a first page id that exists anywhere", async () => {
    m.notebookPage.findMany.mockResolvedValueOnce([{ id: "pageFirst001" }]);
    await expect(createNotebook(OWNER, input)).rejects.toMatchObject({ code: "invalid", status: 409 });
    expect(m.notebook.create).not.toHaveBeenCalled();
  });

  it("caps notebooks per student and checks folder and workspace ownership", async () => {
    m.notebook.count.mockResolvedValue(MAX_NOTEBOOKS_PER_USER);
    await expect(createNotebook(OWNER, input)).rejects.toMatchObject({ code: "limit", status: 422 });
    m.notebook.count.mockResolvedValue(0);
    m.notebookFolder.findFirst.mockResolvedValue(null);
    await expect(createNotebook(OWNER, { ...input, folderId: "folderOfBob1" })).rejects.toMatchObject({ code: "not_found" });
    expect(m.notebookFolder.findFirst.mock.calls[0][0].where).toEqual({ id: "folderOfBob1", ownerId: OWNER });
    m.notebookFolder.findFirst.mockResolvedValue({ id: "f" });
    m.workspace.findFirst.mockResolvedValue(null);
    await expect(createNotebook(OWNER, { ...input, workspaceId: "ws-bob" })).rejects.toMatchObject({ code: "not_found" });
    expect(m.workspace.findFirst.mock.calls[0][0].where).toEqual({ id: "ws-bob", ownerId: OWNER, deletedAt: null });
  });

  it("caps folders per student", async () => {
    m.notebookFolder.count.mockResolvedValue(MAX_FOLDERS_PER_USER);
    await expect(createFolder(OWNER, { name: "More" })).rejects.toMatchObject({ code: "limit", status: 422 });
    m.notebookFolder.count.mockResolvedValue(0);
    expect(await createFolder(OWNER, { id: "folderNew001", name: "Sem 1" })).toEqual({
      id: "folderNew001",
      name: "Sem 1",
      createdAt: new Date(0).toISOString(),
    });
  });
});

describe("changing, trash and deleting", () => {
  it("trashes and restores; a trashed notebook accepts nothing but a restore", async () => {
    await updateNotebook(OWNER, "notebook0001", { trashed: true });
    expect(m.notebook.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "notebook0001", ownerId: OWNER },
      data: { deletedAt: expect.any(Date) },
    });
    m.notebook.findFirst.mockResolvedValue({ ...row, deletedAt: new Date() });
    expect(await updateNotebook(OWNER, "notebook0001", { title: "Renamed" })).toBeNull();
    await updateNotebook(OWNER, "notebook0001", { trashed: false, title: "Back" });
    expect(m.notebook.updateMany.mock.calls[1][0].data).toEqual({ deletedAt: null, title: "Back" });
  });

  it("is not found for someone else's notebook", async () => {
    m.notebook.findFirst.mockResolvedValue(null);
    expect(await updateNotebook("user_bob", "notebook0001", { title: "x" })).toBeNull();
    expect(m.notebook.findFirst.mock.calls[0][0].where).toEqual({ id: "notebook0001", ownerId: "user_bob" });
  });

  it("deletes permanently only from the trash", async () => {
    m.notebook.findFirst.mockResolvedValue(null);
    expect(await deleteNotebookForever(OWNER, "notebook0001")).toBe(false);
    expect(m.notebook.findFirst.mock.calls[0][0].where).toEqual({ id: "notebook0001", ownerId: OWNER, deletedAt: { not: null } });
    expect(m.notebook.deleteMany).not.toHaveBeenCalled();
    m.notebook.findFirst.mockResolvedValue({ id: "notebook0001" });
    expect(await deleteNotebookForever(OWNER, "notebook0001")).toBe(true);
    expect(m.notebook.deleteMany).toHaveBeenCalledWith({ where: { id: "notebook0001", ownerId: OWNER } });
  });

  it("purges a notebook's PDFs, hands one still shown elsewhere to that notebook, keeps undeletable ones for retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.notebookFile.findMany.mockResolvedValue([
      { id: "fileInline01", storageKey: null },
      { id: "fileShared01", storageKey: "k-shared" },
      { id: "fileGone0001", storageKey: "k-gone" },
      { id: "fileStuck001", storageKey: "k-stuck" },
    ]);
    m.notebookPage.findMany.mockResolvedValue([{ pdfFileId: "fileShared01", notebookId: "notebookOth1" }]);
    m.pdfDelete.mockResolvedValue({ deleted: ["k-gone"], failed: 1 });
    await purgeNotebook(OWNER, "notebook0001");
    expect(m.pdfDelete).toHaveBeenCalledWith(["k-gone", "k-stuck"]);
    expect(m.notebookFile.updateMany).toHaveBeenCalledWith({ where: { id: "fileShared01", ownerId: OWNER }, data: { notebookId: "notebookOth1" } });
    expect(m.notebookFile.deleteMany).toHaveBeenCalledWith({ where: { ownerId: OWNER, id: { in: ["fileInline01", "fileGone0001"] } } });
    expect(m.notebookFile.updateMany).toHaveBeenCalledWith({ where: { ownerId: OWNER, id: { in: ["fileStuck001"] } }, data: { notebookId: null } });
    expect(m.notebook.deleteMany).toHaveBeenCalledWith({ where: { id: "notebook0001", ownerId: OWNER } });
  });

  it("deleting a folder moves its notebooks to the root, only the student's", async () => {
    expect(await deleteFolder(OWNER, "folder000001")).toBe(true);
    expect(m.notebook.updateMany).toHaveBeenCalledWith({ where: { ownerId: OWNER, folderId: "folder000001" }, data: { folderId: null } });
    expect(m.notebookFolder.deleteMany).toHaveBeenCalledWith({ where: { id: "folder000001", ownerId: OWNER } });
  });

  it("stores recognised handwriting only for a live page at or below its ink version, never over a newer one", async () => {
    expect(await storeInkText(OWNER, "notebook0001", "page00000001", 3, "hello")).toBe(true);
    expect(m.notebookPage.updateMany.mock.calls[0][0]).toEqual({
      where: {
        id: "page00000001",
        notebookId: "notebook0001",
        ownerId: OWNER,
        inkVersion: { gte: 3 },
        inkTextVersion: { lte: 3 },
        notebook: { ownerId: OWNER, deletedAt: null },
      },
      data: { inkText: "hello", inkTextVersion: 3 },
    });
  });
});

describe("spreadPositions", () => {
  it("places inserted pages strictly between their neighbours, or after the end", () => {
    expect(spreadPositions(1, 2, 3)).toEqual([1.25, 1.5, 1.75]);
    expect(spreadPositions(4, null, 2)).toEqual([5, 6]);
    expect(spreadPositions(null, 1, 2)).toEqual([-1, 0]);
    expect(spreadPositions(null, null, 2)).toEqual([1, 2]);
  });
});
