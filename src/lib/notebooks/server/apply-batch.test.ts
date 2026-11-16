// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A small in-memory stand-in for the four Prisma delegates applyBatch uses,
 * with the `where` shapes it sends (equality, `in`, deletedAt null), so the
 * tests check what ends up stored rather than which calls were made.
 */
interface PageRow {
  id: string;
  notebookId: string;
  ownerId: string;
  position: number;
  template: string;
  width: number;
  height: number;
  pdfFileId: string | null;
  pdfPage: number | null;
  ink: Uint8Array;
  inkVersion: number;
  strokeCount: number;
}
interface NotebookRow {
  id: string;
  ownerId: string;
  version: number;
  pageCount: number;
  deletedAt: Date | null;
}

const db = vi.hoisted(() => ({
  notebooks: [] as NotebookRow[],
  pages: [] as PageRow[],
  files: [] as { id: string; ownerId: string; pageCount: number }[],
  locks: [] as string[],
}));

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === "object" && !(cond instanceof Date) && "in" in cond) {
      return (cond as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === cond;
  });
}

function pick<T extends object>(row: T, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).map((k) => [k, (row as Record<string, unknown>)[k]]));
}

vi.mock("@/lib/db", () => {
  const tx = {
    $queryRaw: async (_sql: TemplateStringsArray, key: string) => {
      db.locks.push(key);
      return [];
    },
    notebook: {
      findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const row = db.notebooks.find((n) => matches(n as never, where));
        return row ? pick(row, select) : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: { version: { increment: number }; pageCount: number } }) => {
        const row = db.notebooks.find((n) => n.id === where.id)!;
        row.version += data.version.increment;
        row.pageCount = data.pageCount;
        return { version: row.version };
      },
    },
    notebookPage: {
      findMany: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) =>
        db.pages.filter((p) => matches(p as never, where)).map((p) => pick(p, select)),
      findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const row = db.pages.find((p) => matches(p as never, where));
        return row ? pick(row, select) : null;
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const before = db.pages.length;
        db.pages = db.pages.filter((p) => !matches(p as never, where));
        return { count: before - db.pages.length };
      },
      createMany: async ({ data }: { data: PageRow[] }) => {
        for (const row of data) if (!db.pages.some((p) => p.id === row.id)) db.pages.push({ ...row });
        return { count: data.length };
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<PageRow> }) => {
        const rows = db.pages.filter((p) => matches(p as never, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    },
    notebookFile: {
      findMany: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) =>
        db.files.filter((f) => matches(f as never, where)).map((f) => pick(f, select)),
    },
  };
  return { prisma: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

import { decodePage, encodePage, encodeStroke, EMPTY_PAGE, toBase64 } from "../codec";
import { MAX_PAGES_PER_NOTEBOOK, type Stroke } from "../model";
import { CodecError, InkLimitError, type Op } from "../ops";
import { applyBatch } from "./apply-batch";
import { NotebookError } from "./errors";

const OWNER = "user_alice";
const NB = "notebook0001";
const TEMPLATE = { kind: "ruled", paper: "white" } as const;

const stroke = (id: string, x = 10): Stroke => ({
  id,
  kind: "ballpoint",
  color: "#112233",
  width: 2,
  points: [x, 10, 0.5, x + 5, 12, 0.6],
});
const put = (page: string, s: Stroke): Op => ({ t: "ink.put", page, s: toBase64(encodeStroke(s)) });
const add = (id: string, position = 10, pdf?: { fileId: string; page: number }): Op => ({
  t: "page.add",
  id,
  position,
  template: TEMPLATE,
  width: 794,
  height: 1123,
  ...(pdf ? { pdf } : {}),
});

function storedPage(id: string, strokes: Stroke[] = [], extra: Partial<PageRow> = {}): PageRow {
  return {
    id,
    notebookId: NB,
    ownerId: OWNER,
    position: 1,
    template: JSON.stringify(TEMPLATE),
    width: 794,
    height: 1123,
    pdfFileId: null,
    pdfPage: null,
    ink: strokes.length ? encodePage(strokes) : new Uint8Array(EMPTY_PAGE),
    inkVersion: 3,
    strokeCount: strokes.length,
    ...extra,
  };
}

const page = (id: string) => db.pages.find((p) => p.id === id);
const notebook = () => db.notebooks.find((n) => n.id === NB)!;

beforeEach(() => {
  db.notebooks = [{ id: NB, ownerId: OWNER, version: 7, pageCount: 1, deletedAt: null }];
  db.pages = [storedPage("page00000001", [stroke("strokeA0001")])];
  db.files = [
    { id: "file00000001", ownerId: OWNER, pageCount: 3 },
    { id: "fileOther001", ownerId: "user_bob", pageCount: 3 },
  ];
  db.locks = [];
});

describe("applyBatch", () => {
  it("runs under the notebook's own advisory lock", async () => {
    await applyBatch(OWNER, NB, [put("page00000001", stroke("strokeB0001"))]);
    expect(db.locks).toEqual([`studyos:notebook:${NB}`]);
  });

  it("refuses a notebook that is someone else's or in the trash (404, nothing written)", async () => {
    await expect(applyBatch("user_bob", NB, [add("page00000002")])).rejects.toMatchObject({ code: "not_found", status: 404 });
    notebook().deletedAt = new Date();
    await expect(applyBatch(OWNER, NB, [add("page00000002")])).rejects.toBeInstanceOf(NotebookError);
    expect(db.pages).toHaveLength(1);
  });

  it("applies ops in order: a page added in the batch takes ink in the same batch", async () => {
    const result = await applyBatch(OWNER, NB, [
      add("page00000002", 2),
      put("page00000002", stroke("strokeN0001")),
      put("page00000002", stroke("strokeN0002", 40)),
    ]);
    const created = page("page00000002")!;
    expect(decodePage(created.ink).map((s) => s.id)).toEqual(["strokeN0001", "strokeN0002"]);
    expect(created).toMatchObject({ inkVersion: 1, strokeCount: 2, position: 2, ownerId: OWNER });
    expect(result).toEqual({ version: 8, pages: [{ id: "page00000002", inkVersion: 1, strokeCount: 2 }], dropped: 0 });
    expect(notebook()).toMatchObject({ version: 8, pageCount: 2 });
  });

  it("merges ink on a stored page by stroke id and bumps its inkVersion once per batch", async () => {
    const moved = stroke("strokeA0001", 99);
    const result = await applyBatch(OWNER, NB, [
      put("page00000001", stroke("strokeB0001")),
      put("page00000001", moved), // a lasso move rewrites the stroke in place
      { t: "ink.del", page: "page00000001", id: "strokeB0001" },
      { t: "ink.del", page: "page00000001", id: "strokeMissing" },
    ]);
    const strokes = decodePage(page("page00000001")!.ink);
    expect(strokes.map((s) => s.id)).toEqual(["strokeA0001"]);
    expect(strokes[0].points[0]).toBe(99);
    expect(result.pages).toEqual([{ id: "page00000001", inkVersion: 4, strokeCount: 1 }]);
    expect(notebook().version).toBe(8);
  });

  it("drops (and counts) ops naming pages that are not in the notebook", async () => {
    const result = await applyBatch(OWNER, NB, [
      put("pageDeleted01", stroke("strokeX0001")),
      { t: "page.move", id: "pageDeleted01", position: 3 },
      { t: "page.template", id: "pageDeleted01", template: TEMPLATE },
      { t: "page.del", id: "pageDeleted01" }, // already gone: a no-op, not "dropped"
    ]);
    expect(result).toEqual({ version: 7, pages: [], dropped: 3 });
    expect(notebook().version).toBe(7);
  });

  it("never lets a client-chosen page id land on another student's page", async () => {
    db.notebooks.push({ id: "notebookBob1", ownerId: "user_bob", version: 1, pageCount: 1, deletedAt: null });
    db.pages.push({ ...storedPage("pageOfBob001", [stroke("strokeBob001")]), notebookId: "notebookBob1", ownerId: "user_bob" });
    const result = await applyBatch(OWNER, NB, [add("pageOfBob001"), put("pageOfBob001", stroke("strokeEvil01"))]);
    expect(result.dropped).toBe(2);
    const bobs = page("pageOfBob001")!;
    expect(bobs.ownerId).toBe("user_bob");
    expect(decodePage(bobs.ink).map((s) => s.id)).toEqual(["strokeBob001"]);
  });

  it("treats a page.add whose id is already in the notebook as a retry", async () => {
    const result = await applyBatch(OWNER, NB, [add("page00000001", 50)]);
    expect(result).toEqual({ version: 7, pages: [], dropped: 0 });
    expect(page("page00000001")!.position).toBe(1);
  });

  it("only accepts PDF backgrounds from the student's own files, within their page count", async () => {
    const result = await applyBatch(OWNER, NB, [
      add("pagePdfOk001", 2, { fileId: "file00000001", page: 3 }),
      add("pagePdfPast1", 3, { fileId: "file00000001", page: 4 }),
      add("pagePdfBob01", 4, { fileId: "fileOther001", page: 1 }),
      add("pagePdfNone1", 5, { fileId: "fileMissing1", page: 1 }),
    ]);
    expect(result.dropped).toBe(3);
    expect(page("pagePdfOk001")).toMatchObject({ pdfFileId: "file00000001", pdfPage: 3 });
    expect(db.pages.map((p) => p.id).sort()).toEqual(["page00000001", "pagePdfOk001"]);
  });

  it("moves pages and changes templates, deletes pages, and keeps pageCount exact", async () => {
    db.pages.push(storedPage("page00000002", [], { position: 2 }));
    notebook().pageCount = 2;
    const result = await applyBatch(OWNER, NB, [
      { t: "page.move", id: "page00000002", position: 0.5 },
      { t: "page.template", id: "page00000002", template: { kind: "grid", paper: "dark" } },
      { t: "page.del", id: "page00000001" },
    ]);
    expect(page("page00000001")).toBeUndefined();
    expect(page("page00000002")).toMatchObject({ position: 0.5, template: '{"kind":"grid","paper":"dark"}', inkVersion: 3 });
    expect(result.pages).toEqual([{ id: "page00000002", inkVersion: 3, strokeCount: 0 }]);
    expect(notebook().pageCount).toBe(1);
  });

  it("discards ink queued for a page deleted later in the batch; a re-added page starts empty", async () => {
    const result = await applyBatch(OWNER, NB, [
      put("page00000001", stroke("strokeB0001")),
      { t: "page.del", id: "page00000001" },
      put("page00000001", stroke("strokeC0001")), // the page is gone: dropped
      add("page00000001", 9),
      put("page00000001", stroke("strokeD0001")),
    ]);
    expect(result.dropped).toBe(1);
    const fresh = page("page00000001")!;
    expect(decodePage(fresh.ink).map((s) => s.id)).toEqual(["strokeD0001"]);
    expect(fresh).toMatchObject({ position: 9, inkVersion: 1, strokeCount: 1 });
  });

  it("refuses the whole batch on a malformed stroke record or bad base64 (nothing written)", async () => {
    const before = page("page00000001")!.ink;
    const record = encodeStroke(stroke("strokeB0001"));
    const truncated = record.subarray(0, record.length - 2); // a record cut short
    await expect(
      applyBatch(OWNER, NB, [add("page00000002"), { t: "ink.put", page: "page00000001", s: toBase64(truncated) }]),
    ).rejects.toBeInstanceOf(CodecError);
    await expect(applyBatch(OWNER, NB, [{ t: "ink.put", page: "page00000001", s: "not base64!!" }])).rejects.toBeInstanceOf(
      CodecError,
    );
    expect(page("page00000002")).toBeUndefined();
    expect(page("page00000001")!.ink).toBe(before);
    expect(notebook().version).toBe(7);
  });

  it("refuses the batch past the page cap (422 limit)", async () => {
    db.pages = Array.from({ length: MAX_PAGES_PER_NOTEBOOK }, (_, i) => storedPage(`pageFull${String(i).padStart(5, "0")}`));
    await expect(applyBatch(OWNER, NB, [add("pageOneMore1")])).rejects.toMatchObject({ code: "limit", status: 422 });
    expect(page("pageOneMore1")).toBeUndefined();
  });

  it("surfaces the ink limits of applyInkOps", async () => {
    const big = stroke("strokeBig001");
    big.points = Array.from({ length: 20_000 * 3 }, (_, i) => (i % 3 === 2 ? 0.5 : (i * 997) % 4000));
    const ops: Op[] = [];
    // 6 MB of ink in one page: each record is ~70 KB.
    for (let i = 0; i < 100; i++) ops.push(put("page00000001", { ...big, id: `strokeBig${String(i).padStart(3, "0")}` }));
    await expect(applyBatch(OWNER, NB, ops)).rejects.toBeInstanceOf(InkLimitError);
  });
});
