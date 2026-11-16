// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { multiPagePdf } from "@/lib/materials/__fixtures__/pdf";

const m = vi.hoisted(() => ({
  extract: vi.fn(),
  notebookCount: vi.fn(),
  pageCount: vi.fn(),
  folderFindFirst: vi.fn(),
  storageUsed: vi.fn(),
  findLiveNotebook: vi.fn(),
  createNotebook: vi.fn(),
  insertPdfPages: vi.fn(),
  putPdfBytes: vi.fn(),
  deletePdfObjects: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    notebook: { count: m.notebookCount },
    notebookPage: { count: m.pageCount },
    notebookFolder: { findFirst: m.folderFindFirst },
  },
}));
vi.mock("@/lib/import/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/import/extract")>()),
  extractPdfLayout: m.extract,
}));
vi.mock("./store", () => ({
  createNotebook: m.createNotebook,
  insertPdfPages: m.insertPdfPages,
  findLiveNotebook: m.findLiveNotebook,
  pdfStorageUsed: m.storageUsed,
}));
vi.mock("./file-store", () => ({ putPdfBytes: m.putPdfBytes, deletePdfObjects: m.deletePdfObjects }));

import { ExtractError } from "@/lib/import/extract";
import { MAX_PDF_BYTES } from "../model";
import { MAX_PDF_STORAGE_BYTES_PER_USER } from "./limits";
import { importPdfAsNotebook, importPdfIntoNotebook, isPdf, pdfPageSize, titleFromFileName } from "./pdf-import";

const OWNER = "user_alice";
const PDF = new TextEncoder().encode("%PDF-1.7\n...");

beforeEach(() => {
  m.extract.mockResolvedValue({
    kind: "pdf",
    pageCount: 2,
    pages: [
      { width: 612, height: 792, text: "Cells" },
      { width: 792, height: 612, text: "" },
    ],
    textTruncated: false,
  });
  m.notebookCount.mockResolvedValue(0);
  m.pageCount.mockResolvedValue(3);
  m.folderFindFirst.mockResolvedValue({ id: "folder000001" });
  m.storageUsed.mockResolvedValue(0);
  m.findLiveNotebook.mockResolvedValue({ id: "notebook0001", version: 1 });
  m.createNotebook.mockImplementation(async (_owner: string, input: { pages: unknown[] }) => ({
    notebook: { id: "notebookNew1", pages: input.pages },
    created: true,
  }));
  m.insertPdfPages.mockResolvedValue({ id: "notebook0001" });
  m.putPdfBytes.mockResolvedValue({ storageKey: "notebooks/user_alice/x.pdf", data: null });
  m.deletePdfObjects.mockResolvedValue({ deleted: ["notebooks/user_alice/x.pdf"], failed: 0 });
});

describe("page geometry and names", () => {
  it("turns PDF points into page units (96/72), scaled to fit and clamped", () => {
    expect(pdfPageSize(612, 792)).toEqual({ width: 816, height: 1056 }); // US Letter = PAGE_SIZES.letter
    expect(pdfPageSize(595.28, 841.89)).toEqual({ width: 794, height: 1123 }); // A4
    // A poster: scaled down uniformly to the 5000 cap, keeping its shape.
    expect(pdfPageSize(7200, 3600)).toEqual({ width: 5000, height: 2500 });
    // A sliver: each side at least 100.
    expect(pdfPageSize(10, 500)).toEqual({ width: 100, height: 667 });
    expect(pdfPageSize(0, Number.NaN)).toEqual({ width: 794, height: 1123 });
  });

  it("recognises a PDF by its header within the first KB", () => {
    expect(isPdf(PDF)).toBe(true);
    expect(isPdf(new TextEncoder().encode(`${" ".repeat(500)}%PDF-1.4`))).toBe(true);
    expect(isPdf(new TextEncoder().encode("<html>%PDF-"))).toBe(true); // as PDF readers accept it
    expect(isPdf(new TextEncoder().encode("PK\u0003\u0004 word"))).toBe(false);
  });

  it("makes a title from the file name", () => {
    expect(titleFromFileName("Lecture_3__Cells.pdf")).toBe("Lecture 3 Cells");
    expect(titleFromFileName(".pdf")).toBe("PDF"); // nothing left of the name
  });
});

describe("importPdfAsNotebook", () => {
  it("creates a notebook of the PDF's pages, sized and with their text, after storing the bytes", async () => {
    const notebook = await importPdfAsNotebook(OWNER, { bytes: PDF, fileName: "Lecture_3.pdf", folderId: "folder000001" });
    expect(m.extract).toHaveBeenCalledWith(PDF, expect.objectContaining({ maxPdfPages: 500, owner: OWNER, maxPageChars: 20_000 }));
    const input = m.createNotebook.mock.calls[0][1];
    expect(input).toMatchObject({ title: "Lecture 3", folderId: "folder000001", paper: { template: { kind: "blank", paper: "white" } } });
    expect(input.file).toMatchObject({ mime: "application/pdf", sizeBytes: PDF.length, pageCount: 2, storageKey: "notebooks/user_alice/x.pdf" });
    expect(input.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(input.pages).toEqual([
      expect.objectContaining({ position: 1, width: 816, height: 1056, pdfFileId: input.file.id, pdfPage: 1, pdfText: "Cells", template: { kind: "blank", paper: "white" } }),
      expect.objectContaining({ position: 2, width: 1056, height: 816, pdfPage: 2, pdfText: "" }),
    ]);
    expect(notebook).toMatchObject({ id: "notebookNew1" });
  });

  it("refuses what is not a PDF, or too big, before any work", async () => {
    await expect(importPdfAsNotebook(OWNER, { bytes: new Uint8Array([1, 2, 3]), fileName: "a.pdf" })).rejects.toMatchObject({
      code: "unsupported",
      status: 415,
    });
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    big.set(PDF);
    await expect(importPdfAsNotebook(OWNER, { bytes: big, fileName: "a.pdf" })).rejects.toMatchObject({ code: "too_large", status: 413 });
    expect(m.extract).not.toHaveBeenCalled();
  });

  it("checks the folder, the notebook cap and the storage cap before extracting", async () => {
    m.folderFindFirst.mockResolvedValueOnce(null);
    await expect(importPdfAsNotebook(OWNER, { bytes: PDF, fileName: "a.pdf", folderId: "folderOfBob1" })).rejects.toMatchObject({ code: "not_found" });
    m.storageUsed.mockResolvedValueOnce(MAX_PDF_STORAGE_BYTES_PER_USER - 5);
    await expect(importPdfAsNotebook(OWNER, { bytes: PDF, fileName: "a.pdf" })).rejects.toMatchObject({
      code: "limit",
      extra: { limit: "storage" },
    });
    expect(m.extract).not.toHaveBeenCalled();
  });

  it("maps extraction failures: too many pages, damaged, busy", async () => {
    m.extract.mockRejectedValueOnce(new ExtractError("too_large", "too many pages"));
    await expect(importPdfAsNotebook(OWNER, { bytes: PDF, fileName: "a.pdf" })).rejects.toMatchObject({
      code: "too_large",
      status: 413,
      extra: { limit: "pages" },
    });
    m.extract.mockRejectedValueOnce(new ExtractError("unreadable", "PasswordException"));
    await expect(importPdfAsNotebook(OWNER, { bytes: PDF, fileName: "a.pdf" })).rejects.toMatchObject({ code: "unreadable", status: 422 });
    m.extract.mockRejectedValueOnce(new ExtractError("busy"));
    await expect(importPdfAsNotebook(OWNER, { bytes: PDF, fileName: "a.pdf" })).rejects.toMatchObject({ code: "busy", status: 503 });
    expect(m.putPdfBytes).not.toHaveBeenCalled();
  });

  it("deletes the stored bytes again when the notebook cannot be created", async () => {
    m.createNotebook.mockRejectedValueOnce(new Error("db down"));
    await expect(importPdfAsNotebook(OWNER, { bytes: PDF, fileName: "a.pdf" })).rejects.toThrow("db down");
    expect(m.deletePdfObjects).toHaveBeenCalledWith(["notebooks/user_alice/x.pdf"]);
  });
});

describe("importPdfIntoNotebook", () => {
  it("inserts after the given page, in a live notebook of the student only", async () => {
    await importPdfIntoNotebook(OWNER, "notebook0001", { bytes: PDF, fileName: "more.pdf", afterPageId: "page00000001" });
    const [owner, id, after, pages, file] = m.insertPdfPages.mock.calls[0];
    expect([owner, id, after]).toEqual([OWNER, "notebook0001", "page00000001"]);
    expect(pages).toHaveLength(2);
    expect(file.pageCount).toBe(2);
    m.findLiveNotebook.mockResolvedValueOnce(null);
    await expect(importPdfIntoNotebook(OWNER, "notebook0001", { bytes: PDF, fileName: "x.pdf" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("layout extraction (the real isolated child process)", () => {
  it("lists every page's size and text, a page without text included", async () => {
    const actual = await vi.importActual<typeof import("@/lib/import/extract")>("@/lib/import/extract");
    const bytes = multiPagePdf([["Page one is about cells and membranes."], [], ["Enzymes and catalysis."]]);
    const layout = await actual.extractPdfLayout(bytes, { maxBytes: MAX_PDF_BYTES, maxPdfPages: 500, maxPageChars: 10, timeoutMs: 20_000 });
    expect(layout.pageCount).toBe(3);
    expect(layout.pages.map((p) => [p.width, p.height])).toEqual([
      [612, 792],
      [612, 792],
      [612, 792],
    ]);
    expect(layout.pages[0].text).toBe("Page one i"); // capped per page
    expect(layout.pages[1].text).toBe("");
    await expect(actual.extractPdfLayout(bytes, { maxBytes: MAX_PDF_BYTES, maxPdfPages: 2 })).rejects.toMatchObject({
      code: "too_large",
      message: expect.stringMatching(/too many pages/),
    });
  }, 30_000);
});
