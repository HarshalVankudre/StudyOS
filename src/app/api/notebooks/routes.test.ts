// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listNotebooks: vi.fn(),
  createNotebook: vi.fn(),
  getNotebook: vi.fn(),
  updateNotebook: vi.fn(),
  deleteNotebookForever: vi.fn(),
  readInk: vi.fn(),
  readTexts: vi.fn(),
  readNotebookFile: vi.fn(),
  pageExists: vi.fn(),
  storeInkText: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  applyBatch: vi.fn(),
  importPdfAsNotebook: vi.fn(),
  importPdfIntoNotebook: vi.fn(),
  recognizeHandwriting: vi.fn(),
  checkUsageLimit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/notebooks/server/store", () => ({
  listNotebooks: mocks.listNotebooks,
  createNotebook: mocks.createNotebook,
  getNotebook: mocks.getNotebook,
  updateNotebook: mocks.updateNotebook,
  deleteNotebookForever: mocks.deleteNotebookForever,
  readInk: mocks.readInk,
  readTexts: mocks.readTexts,
  readNotebookFile: mocks.readNotebookFile,
  pageExists: mocks.pageExists,
  storeInkText: mocks.storeInkText,
  createFolder: mocks.createFolder,
  renameFolder: mocks.renameFolder,
  deleteFolder: mocks.deleteFolder,
}));
vi.mock("@/lib/notebooks/server/apply-batch", () => ({ applyBatch: mocks.applyBatch }));
vi.mock("@/lib/notebooks/server/pdf-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notebooks/server/pdf-import")>()),
  importPdfAsNotebook: mocks.importPdfAsNotebook,
  importPdfIntoNotebook: mocks.importPdfIntoNotebook,
}));
vi.mock("@/lib/notebooks/server/recognize", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notebooks/server/recognize")>()),
  recognizeHandwriting: mocks.recognizeHandwriting,
}));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: mocks.checkUsageLimit }));

import { encodeStroke, toBase64 } from "@/lib/notebooks/codec";
import { DEFAULT_PAPER, MAX_PDF_BYTES } from "@/lib/notebooks/model";
import { CodecError, InkLimitError, MAX_OPS_BODY_BYTES } from "@/lib/notebooks/ops";
import { NotebookError } from "@/lib/notebooks/server/errors";
import { HandwritingRefusedError } from "@/lib/notebooks/server/recognize";
import { GET as LIST, POST as CREATE } from "./route";
import { DELETE as REMOVE, GET as DETAIL, PATCH } from "./[id]/route";
import { POST as OPS } from "./[id]/ops/route";
import { GET as INK } from "./[id]/ink/route";
import { GET as TEXT } from "./[id]/text/route";
import { POST as INSERT_PDF } from "./[id]/pdf/route";
import { POST as RECOGNIZE } from "./[id]/recognize/route";
import { POST as IMPORT_PDF } from "./import-pdf/route";
import { GET as FILE } from "./files/[fileId]/route";
import { POST as CREATE_FOLDER } from "./folders/route";
import { DELETE as DELETE_FOLDER, PATCH as RENAME_FOLDER } from "./folders/[folderId]/route";

const NB = "notebook0001";
const PAGE = "page00000001";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, body: unknown, init: RequestInit = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...init });
const detail = { id: NB, title: "Bio", pages: [] };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalModel = process.env.STUDYOS_HANDWRITING_MODEL;

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user_alice" });
  mocks.listNotebooks.mockResolvedValue({ notebooks: [], folders: [] });
  mocks.createNotebook.mockResolvedValue({ notebook: detail, created: true });
  mocks.getNotebook.mockImplementation(async (user: string, id: string) => (user === "user_alice" && id === NB ? detail : null));
  mocks.updateNotebook.mockResolvedValue(detail);
  mocks.deleteNotebookForever.mockResolvedValue(true);
  mocks.readInk.mockResolvedValue([{ id: PAGE, inkVersion: 1, ink: "U04B" }]);
  mocks.readTexts.mockResolvedValue([]);
  mocks.pageExists.mockResolvedValue(true);
  mocks.storeInkText.mockResolvedValue(true);
  mocks.applyBatch.mockResolvedValue({ version: 2, pages: [], dropped: 0 });
  mocks.importPdfAsNotebook.mockResolvedValue(detail);
  mocks.importPdfIntoNotebook.mockResolvedValue(detail);
  mocks.recognizeHandwriting.mockResolvedValue("x^2 + y^2");
  mocks.checkUsageLimit.mockResolvedValue({ allowed: true, remaining: 5 });
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  delete process.env.STUDYOS_HANDWRITING_MODEL;
});

afterEach(() => {
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  if (originalModel === undefined) delete process.env.STUDYOS_HANDWRITING_MODEL;
  else process.env.STUDYOS_HANDWRITING_MODEL = originalModel;
});

describe("auth and cross-site protection", () => {
  it("every route needs a signed-in student", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const responses = await Promise.all([
      LIST(),
      CREATE(json("http://x/api/notebooks", {})),
      DETAIL(new Request("http://x"), ctx(NB)),
      OPS(json("http://x", { ops: [] }), ctx(NB)),
      INK(new Request(`http://x?pages=${PAGE}`), ctx(NB)),
      TEXT(new Request("http://x"), ctx(NB)),
      RECOGNIZE(json("http://x", {}), ctx(NB)),
      IMPORT_PDF(new Request("http://x", { method: "POST" })),
      FILE(new Request("http://x"), { params: Promise.resolve({ fileId: "file00000001" }) }),
      CREATE_FOLDER(json("http://x", { name: "a" })),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: "not_authenticated" });
    }
  });

  it("refuses state changes from another site before doing anything", async () => {
    const evil = { headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site" } };
    const responses = await Promise.all([
      CREATE(json("http://x/api/notebooks", {}, evil)),
      OPS(json("http://x", { ops: [] }, evil), ctx(NB)),
      PATCH(json("http://x", { title: "x" }, { ...evil, method: "PATCH" }), ctx(NB)),
      REMOVE(new Request("http://x", { method: "DELETE", ...evil }), ctx(NB)),
      RECOGNIZE(json("http://x", {}, evil), ctx(NB)),
      IMPORT_PDF(new Request("http://x", { method: "POST", ...evil })),
      INSERT_PDF(new Request("http://x", { method: "POST", ...evil }), ctx(NB)),
      CREATE_FOLDER(json("http://x", { name: "a" }, evil)),
      RENAME_FOLDER(json("http://x", { name: "a" }, { ...evil, method: "PATCH" }), { params: Promise.resolve({ folderId: "folder000001" }) }),
      DELETE_FOLDER(new Request("http://x", { method: "DELETE", ...evil }), { params: Promise.resolve({ folderId: "folder000001" }) }),
    ]);
    for (const res of responses) expect(res.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});

describe("notebooks", () => {
  it("lists the shelf without caching", async () => {
    const res = await LIST();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.listNotebooks).toHaveBeenCalledWith("user_alice");
  });

  it("validates a create and answers 201 (200 for a retried create)", async () => {
    const body = { title: "  Chem  ", cover: "red", paper: DEFAULT_PAPER, id: "notebookNew1", firstPageId: "pageFirst001" };
    expect((await CREATE(json("http://x", { ...body, cover: "plaid" }))).status).toBe(400);
    expect((await CREATE(json("http://x", { ...body, id: "../x" }))).status).toBe(400);
    expect((await CREATE(json("http://x", { ...body, paper: { ...DEFAULT_PAPER, size: "a3" } }))).status).toBe(400);
    const res = await CREATE(json("http://x", body));
    expect(res.status).toBe(201);
    expect(mocks.createNotebook).toHaveBeenCalledWith("user_alice", expect.objectContaining({ title: "Chem", cover: "red" }));
    mocks.createNotebook.mockResolvedValue({ notebook: detail, created: false });
    expect((await CREATE(json("http://x", body))).status).toBe(200);
  });

  it("maps store errors to their codes", async () => {
    const body = { title: "Chem", cover: "red", paper: DEFAULT_PAPER };
    mocks.createNotebook.mockRejectedValue(new NotebookError("limit", 422, { limit: "notebooks" }));
    const res = await CREATE(json("http://x", body));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ code: "limit", limit: "notebooks" });
  });

  it("shows a notebook only to its owner (404, never 403), and 404s malformed ids unread", async () => {
    expect((await DETAIL(new Request("http://x"), ctx(NB))).status).toBe(200);
    mocks.auth.mockResolvedValue({ userId: "user_bob" });
    expect((await DETAIL(new Request("http://x"), ctx(NB))).status).toBe(404);
    expect(mocks.getNotebook).toHaveBeenLastCalledWith("user_bob", NB);
    mocks.getNotebook.mockClear();
    expect((await DETAIL(new Request("http://x"), ctx("../../etc"))).status).toBe(404);
    expect(mocks.getNotebook).not.toHaveBeenCalled();
  });

  it("patches known fields only, and 404s what the store does not find", async () => {
    const patch = (body: unknown) => PATCH(json("http://x", body, { method: "PATCH" }), ctx(NB));
    expect((await patch({})).status).toBe(400);
    expect((await patch({ ownerId: "user_bob" })).status).toBe(400);
    expect((await patch({ trashed: "yes" })).status).toBe(400);
    expect((await patch({ trashed: true })).status).toBe(200);
    expect(mocks.updateNotebook).toHaveBeenLastCalledWith("user_alice", NB, { trashed: true });
    mocks.updateNotebook.mockResolvedValue(null);
    expect((await patch({ title: "x" })).status).toBe(404);
  });

  it("deletes permanently only what the store deletes (the trash)", async () => {
    expect((await REMOVE(new Request("http://x", { method: "DELETE" }), ctx(NB))).status).toBe(200);
    mocks.deleteNotebookForever.mockResolvedValue(false);
    expect((await REMOVE(new Request("http://x", { method: "DELETE" }), ctx(NB))).status).toBe(404);
  });
});

describe("ops", () => {
  const op = { t: "ink.put", page: PAGE, s: toBase64(encodeStroke({ id: "strokeA0001", kind: "fountain", color: "#000000", width: 2, points: [1, 1, 0.5] })) };

  it("validates the batch and passes it on for the signed-in student", async () => {
    expect((await OPS(json("http://x", { ops: [] }), ctx(NB))).status).toBe(400);
    expect((await OPS(json("http://x", { ops: [{ t: "page.explode", id: PAGE }] }), ctx(NB))).status).toBe(400);
    const res = await OPS(json("http://x", { ops: [op] }), ctx(NB));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 2, pages: [], dropped: 0 });
    expect(mocks.applyBatch).toHaveBeenCalledWith("user_alice", NB, [op]);
  });

  it("refuses an oversized body before reading it", async () => {
    const res = await OPS(
      json("http://x", { ops: [op] }, { headers: { "content-type": "application/json", "content-length": String(MAX_OPS_BODY_BYTES + 1) } }),
      ctx(NB),
    );
    expect(res.status).toBe(413);
    expect(mocks.applyBatch).not.toHaveBeenCalled();
  });

  it("answers codec and ink-limit failures with their codes", async () => {
    mocks.applyBatch.mockRejectedValueOnce(new CodecError("bad"));
    expect(await (await OPS(json("http://x", { ops: [op] }), ctx(NB))).json()).toEqual({ code: "invalid" });
    mocks.applyBatch.mockRejectedValueOnce(new InkLimitError("too_many_strokes"));
    const res = await OPS(json("http://x", { ops: [op] }), ctx(NB));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ code: "too_many_strokes" });
    mocks.applyBatch.mockRejectedValueOnce(new NotebookError("not_found", 404));
    expect((await OPS(json("http://x", { ops: [op] }), ctx(NB))).status).toBe(404);
    mocks.applyBatch.mockRejectedValueOnce(Object.assign(new Error("tx timeout"), { code: "P2028" }));
    expect(await (await OPS(json("http://x", { ops: [op] }), ctx(NB))).json()).toEqual({ code: "busy" });
  });
});

describe("ink and text", () => {
  it("reads up to 20 well-formed page ids, never cached", async () => {
    const ink = (q: string) => INK(new Request(`http://x/api/notebooks/${NB}/ink?pages=${q}`), ctx(NB));
    expect((await ink("")).status).toBe(400);
    expect((await ink("bad id")).status).toBe(400);
    expect((await ink(Array.from({ length: 21 }, (_, i) => `pageId${String(i).padStart(4, "0")}`).join(","))).status).toBe(400);
    const res = await ink(`${PAGE},${PAGE},page00000002`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.readInk).toHaveBeenCalledWith("user_alice", NB, [PAGE, "page00000002"]);
    mocks.readInk.mockResolvedValue(null);
    expect((await ink(PAGE)).status).toBe(404);
  });

  it("reads page texts of the student's notebook only", async () => {
    expect((await TEXT(new Request("http://x"), ctx(NB))).status).toBe(200);
    mocks.readTexts.mockResolvedValue(null);
    expect((await TEXT(new Request("http://x"), ctx(NB))).status).toBe(404);
  });
});

describe("PDF import", () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.4\n%fake\n");
  const form = (fields: Record<string, string | File>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return new Request("http://x/api/notebooks/import-pdf", { method: "POST", body: f });
  };

  it("imports a PDF as a notebook, rate-limited", async () => {
    const res = await IMPORT_PDF(form({ file: new File([pdfBytes], "Lecture_3.pdf", { type: "application/pdf" }), title: "Week 3" }));
    expect(res.status).toBe(201);
    expect(mocks.importPdfAsNotebook).toHaveBeenCalledWith("user_alice", {
      bytes: expect.any(Uint8Array),
      fileName: "Lecture_3.pdf",
      title: "Week 3",
      folderId: null,
    });
    expect(mocks.checkUsageLimit).toHaveBeenCalledWith("user_alice", "notebook_pdf");
    mocks.checkUsageLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    expect((await IMPORT_PDF(form({ file: new File([pdfBytes], "a.pdf") }))).status).toBe(429);
  });

  it("refuses a missing file, a bad folder id and an oversized body", async () => {
    expect((await IMPORT_PDF(form({ title: "x" }))).status).toBe(400);
    expect((await IMPORT_PDF(form({ file: new File([pdfBytes], "a.pdf"), folderId: "../x" }))).status).toBe(400);
    const big = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_PDF_BYTES * 2) },
      body: "--x--",
    });
    const res = await IMPORT_PDF(big);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ code: "too_large", limit: "bytes" });
    expect(mocks.importPdfAsNotebook).not.toHaveBeenCalled();
  });

  it("answers what the import refuses with its code", async () => {
    mocks.importPdfAsNotebook.mockRejectedValue(new NotebookError("unsupported", 415));
    const res = await IMPORT_PDF(form({ file: new File([new Uint8Array([1, 2, 3])], "a.pdf") }));
    expect(res.status).toBe(415);
  });

  it("inserts a PDF into a notebook after a page", async () => {
    const f = new FormData();
    f.append("file", new File([pdfBytes], "more.pdf"));
    f.append("afterPageId", PAGE);
    const res = await INSERT_PDF(new Request("http://x", { method: "POST", body: f }), ctx(NB));
    expect(res.status).toBe(200);
    expect(mocks.importPdfIntoNotebook).toHaveBeenCalledWith("user_alice", NB, expect.objectContaining({ afterPageId: PAGE }));
  });
});

describe("PDF bytes", () => {
  const params = { params: Promise.resolve({ fileId: "file00000001" }) };

  it("serves the owner's file, immutable, sniff-proof, as a download; 304 on a matching ETag", async () => {
    mocks.readNotebookFile.mockResolvedValue({ name: "Lecture 3.pdf", sha256: "abc123", bytes: new Uint8Array([37, 80, 68, 70]) });
    const res = await FILE(new Request("http://x"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''Lecture%203.pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(mocks.readNotebookFile).toHaveBeenCalledWith("user_alice", "file00000001");
    const cached = await FILE(new Request("http://x", { headers: { "if-none-match": '"abc123"' } }), params);
    expect(cached.status).toBe(304);
  });

  it("is a 404 for anyone else", async () => {
    mocks.readNotebookFile.mockResolvedValue(null);
    expect((await FILE(new Request("http://x"), params)).status).toBe(404);
  });
});

describe("handwriting recognition", () => {
  const recognize = (body: Record<string, unknown>) =>
    RECOGNIZE(json("http://x", { pageId: PAGE, inkVersion: 3, image: b64(PNG), mime: "image/png", ...body }), ctx(NB));

  it("recognises a page, stores it at the ink version sent, uses the daily limit", async () => {
    const res = await recognize({});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "x^2 + y^2", stored: true });
    expect(mocks.recognizeHandwriting).toHaveBeenCalledWith("claude-haiku-5-5", PNG, "image/png");
    expect(mocks.storeInkText).toHaveBeenCalledWith("user_alice", NB, PAGE, 3, "x^2 + y^2");
    expect(mocks.checkUsageLimit).toHaveBeenCalledWith("user_alice", "handwriting");
    expect((await recognize({ image: b64(JPEG), mime: "image/jpeg" })).status).toBe(200);
  });

  it("validates the body, the base64, the image type and its size", async () => {
    expect((await recognize({ inkVersion: -1 })).status).toBe(400);
    expect((await recognize({ mime: "image/gif" })).status).toBe(400);
    expect((await recognize({ image: `data:image/png;base64,${b64(PNG)}` })).status).toBe(400);
    expect((await recognize({ image: b64(JPEG) })).status).toBe(415); // declared PNG, is JPEG
    expect((await recognize({ image: b64(new Uint8Array(64).fill(65)) })).status).toBe(415);
    const big = new Uint8Array(2 * 1024 * 1024 + 10);
    big.set(PNG);
    expect((await recognize({ image: b64(big) })).status).toBe(413);
    expect(mocks.recognizeHandwriting).not.toHaveBeenCalled();
  });

  it("is a 404 for a page not in the student's live notebook, before any model call", async () => {
    mocks.pageExists.mockResolvedValue(false);
    expect((await recognize({})).status).toBe(404);
    expect(mocks.checkUsageLimit).not.toHaveBeenCalled();
    expect(mocks.recognizeHandwriting).not.toHaveBeenCalled();
  });

  it("is unavailable without a usable model, rate-limited past the daily cap", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await recognize({});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "unavailable" });
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mocks.checkUsageLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    expect((await recognize({})).status).toBe(429);
  });

  it("answers a refusal as unreadable and an upstream failure as unavailable", async () => {
    mocks.recognizeHandwriting.mockRejectedValueOnce(new HandwritingRefusedError());
    expect((await recognize({})).status).toBe(422);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.recognizeHandwriting.mockRejectedValueOnce(new Error("upstream 500"));
    const res = await recognize({});
    expect(res.status).toBe(502);
    expect(mocks.storeInkText).not.toHaveBeenCalled();
  });
});

describe("folders", () => {
  const params = { params: Promise.resolve({ folderId: "folder000001" }) };

  it("creates, renames and deletes the student's folders", async () => {
    mocks.createFolder.mockResolvedValue({ id: "folder000001", name: "Sem 1", createdAt: "x" });
    expect((await CREATE_FOLDER(json("http://x", { name: "   " }))).status).toBe(400);
    expect((await CREATE_FOLDER(json("http://x", { name: " Sem 1 " }))).status).toBe(201);
    expect(mocks.createFolder).toHaveBeenCalledWith("user_alice", { name: "Sem 1" });
    mocks.renameFolder.mockResolvedValue(null);
    expect((await RENAME_FOLDER(json("http://x", { name: "x" }, { method: "PATCH" }), params)).status).toBe(404);
    mocks.deleteFolder.mockResolvedValue(true);
    expect((await DELETE_FOLDER(new Request("http://x", { method: "DELETE" }), params)).status).toBe(200);
    expect(mocks.deleteFolder).toHaveBeenCalledWith("user_alice", "folder000001");
  });
});
