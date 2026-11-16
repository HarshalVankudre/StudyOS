import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/workspace/types";

/** A tiny Workspace table with the filters the search layer uses. */
interface Row {
  id: string;
  ownerId: string;
  name: string;
  data: string;
  version: number;
  deletedAt: Date | null;
  updatedAt: Date;
}

/** A notebook with its pages' texts (what notebook search reads). */
interface NotebookRow {
  id: string;
  ownerId: string;
  title: string;
  version: number;
  updatedAt: Date;
  deletedAt: Date | null;
  pages: { id: string; inkText: string; pdfText: string; updatedAt: Date }[];
}

const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  notebooks: [] as NotebookRow[],
  findMany: vi.fn(),
  notebookFindMany: vi.fn(),
  groupBy: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: { findMany: mocks.findMany },
    notebook: { findMany: mocks.notebookFindMany },
    notebookPage: { groupBy: mocks.groupBy },
    $queryRaw: mocks.queryRaw,
  },
}));

import { clearSearchCache, estimateEntryBytes, searchCacheStats, searchForOwner } from "./server";
import { buildSearchEntries } from "./index";

function matches(row: Row, where: Record<string, unknown>): boolean {
  if (where.ownerId !== undefined && row.ownerId !== where.ownerId) return false;
  if ("deletedAt" in where && where.deletedAt === null && row.deletedAt !== null) return false;
  const id = where.id as { in?: string[] } | undefined;
  if (id?.in && !id.in.includes(row.id)) return false;
  return true;
}

function add(ownerId: string, ws: Workspace, opts: { trashed?: boolean; version?: number; at?: number } = {}) {
  mocks.rows.push({
    id: ws.id,
    ownerId,
    name: ws.name,
    data: JSON.stringify(ws),
    version: opts.version ?? 1,
    deletedAt: opts.trashed ? new Date() : null,
    updatedAt: new Date(opts.at ?? 1_000),
  });
}

const workspace = (id: string, name: string, pageTitle: string): Workspace => ({
  id,
  name,
  pages: [{ id: `${id}-p`, title: pageTitle, blocks: [{ id: `${id}-b`, type: "paragraph", text: `About ${pageTitle}` }] }],
  databases: [],
});

const liveNotebooks = (where: { ownerId: string; id?: { in: string[] } }) =>
  mocks.notebooks.filter(
    (n) => n.ownerId === where.ownerId && n.deletedAt === null && (!where.id || where.id.in.includes(n.id)),
  );

beforeEach(() => {
  clearSearchCache();
  mocks.rows.length = 0;
  mocks.notebooks.length = 0;
  mocks.notebookFindMany.mockReset().mockImplementation(async (args: { where: { ownerId: string; id?: { in: string[] } } }) =>
    liveNotebooks(args.where).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
  );
  mocks.groupBy.mockReset().mockImplementation(async (args: { where: { ownerId: string; notebookId: { in: string[] } } }) =>
    mocks.notebooks
      .filter((n) => n.ownerId === args.where.ownerId && args.where.notebookId.in.includes(n.id) && n.pages.length > 0)
      .map((n) => ({ notebookId: n.id, _max: { updatedAt: new Date(Math.max(...n.pages.map((p) => p.updatedAt.getTime()))) } })),
  );
  // The page-text query: (template, ownerId-free values..., ownerId, ids) as Prisma passes them.
  mocks.queryRaw.mockReset().mockImplementation(async (_sql: TemplateStringsArray, ...values: unknown[]) => {
    const ownerId = values[2] as string;
    const ids = values[3] as string[];
    return mocks.notebooks
      .filter((n) => n.ownerId === ownerId && ids.includes(n.id))
      .flatMap((n) =>
        n.pages
          .map((p, i) => ({ notebookId: n.id, id: p.id, n: BigInt(i + 1), inkText: p.inkText, pdfText: p.pdfText }))
          .filter((p) => p.inkText || p.pdfText),
      );
  });
  mocks.findMany.mockReset().mockImplementation(async (args: { where: Record<string, unknown> }) =>
    mocks.rows
      .filter((r) => matches(r, args.where))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
  );
});

describe("searchForOwner", () => {
  it("only searches the owner's own workspaces", async () => {
    add("alice", workspace("a1", "Alice biology", "Cells"));
    add("bob", workspace("b1", "Bob biology", "Cells"));
    const r = await searchForOwner("alice", "cells");
    const hrefs = r.groups.flatMap((g) => g.hits.map((h) => h.href));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((h) => h.startsWith("/app/a1"))).toBe(true);
    for (const call of mocks.findMany.mock.calls) {
      expect(call[0].where.ownerId).toBe("alice");
      expect(call[0].where.deletedAt).toBeNull();
    }
  });

  it("excludes trashed workspaces", async () => {
    add("alice", workspace("live", "Live", "Genetics"));
    add("alice", workspace("gone", "Gone", "Genetics"), { trashed: true });
    const r = await searchForOwner("alice", "genetics");
    const ids = new Set(r.groups.flatMap((g) => g.hits.map((h) => h.workspaceId)));
    expect([...ids]).toEqual(["live"]);
  });

  it("drops a cached workspace once it is trashed", async () => {
    add("alice", workspace("w", "W", "Optics"));
    expect((await searchForOwner("alice", "optics")).total).toBeGreaterThan(0);
    mocks.rows[0].deletedAt = new Date();
    expect((await searchForOwner("alice", "optics")).total).toBe(0);
  });

  it("reuses parsed workspaces until their version changes", async () => {
    add("alice", workspace("w", "W", "Optics"));
    await searchForOwner("alice", "optics");
    await searchForOwner("alice", "optics");
    // First query: list + load. Second: list only.
    expect(mocks.findMany).toHaveBeenCalledTimes(3);

    const row = mocks.rows[0];
    row.data = JSON.stringify(workspace("w", "W", "Acoustics"));
    row.version = 2;
    row.updatedAt = new Date(2_000);
    const r = await searchForOwner("alice", "acoustics");
    expect(r.total).toBeGreaterThan(0);
    expect((await searchForOwner("alice", "optics")).total).toBe(0);
  });

  it("does not share cache entries between owners", async () => {
    add("alice", workspace("same", "Shared id", "Thermodynamics"));
    await searchForOwner("alice", "thermo");
    mocks.rows[0].ownerId = "bob";
    expect((await searchForOwner("alice", "thermo")).total).toBe(0);
  });

  it("lists workspaces most recent first for an empty query", async () => {
    add("alice", workspace("old", "Old", "x"), { at: 1 });
    add("alice", workspace("new", "New", "y"), { at: 5 });
    const r = await searchForOwner("alice", "");
    expect(r.groups[0].hits.map((h) => h.href)).toEqual(["/app/new", "/app/old"]);
  });

  it("bounds the cache by estimated bytes, not only by count, and still answers in full", async () => {
    const big = (id: string, word: string): Workspace => ({
      id,
      name: id,
      pages: [
        {
          id: `${id}-p`,
          title: word,
          blocks: Array.from({ length: 200 }, (_, i) => ({ id: `${id}-${i}`, type: "paragraph" as const, text: `${word} ${"x".repeat(3000)}` })),
        },
      ],
      databases: [],
    });
    const one = estimateEntryBytes(buildSearchEntries(big("probe", "probe")));
    // Room for about three of these workspaces.
    clearSearchCache(one * 3.5);
    for (let i = 0; i < 10; i++) add("alice", big(`w${i}`, `topic${i}`), { at: i });
    const r = await searchForOwner("alice", "topic");
    // Every workspace answers this query even though most were evicted at once.
    expect(new Set(r.groups.flatMap((g) => g.hits.map((h) => h.workspaceId))).size).toBeGreaterThan(3);
    expect(r.total).toBe(10 * 201);
    const stats = searchCacheStats();
    expect(stats.bytes).toBeLessThanOrEqual(one * 3.5);
    expect(stats.items).toBeLessThanOrEqual(3);
  });
});

describe("searchForOwner: handwritten notebooks", () => {
  const notebook = (id: string, ownerId: string, title: string, pages: NotebookRow["pages"], extra: Partial<NotebookRow> = {}) =>
    mocks.notebooks.push({ id, ownerId, title, version: 1, updatedAt: new Date(1_000), deletedAt: null, pages, ...extra });
  const page = (id: string, inkText: string, pdfText = "", at = 1_000) => ({ id, inkText, pdfText, updatedAt: new Date(at) });

  it("finds a notebook by title and a page by its handwriting or PDF text, with deep links", async () => {
    notebook("nb1", "alice", "Biology notes", [page("p1", ""), page("p2", "mitochondria make ATP"), page("p3", "", "Krebs cycle slide")]);
    const r = await searchForOwner("alice", "mitochondria");
    const hit = r.groups.find((g) => g.kind === "notebookPage")?.hits[0];
    expect(hit).toMatchObject({ href: "/app/notebooks/nb1?page=p2", context: "p. 2", workspaceName: "Biology notes" });

    const byTitle = await searchForOwner("alice", "biology");
    expect(byTitle.groups.find((g) => g.kind === "notebook")?.hits[0].href).toBe("/app/notebooks/nb1");
    expect((await searchForOwner("alice", "krebs")).groups[0].hits[0].href).toBe("/app/notebooks/nb1?page=p3");
  });

  it("never searches another student's notebooks or the trash", async () => {
    notebook("mine", "alice", "Chemistry", [page("a", "titration")]);
    notebook("theirs", "bob", "Chemistry", [page("b", "titration")]);
    notebook("trashed", "alice", "Old chemistry", [page("c", "titration")], { deletedAt: new Date() });
    const r = await searchForOwner("alice", "titration");
    expect(r.groups.flatMap((g) => g.hits.map((h) => h.href))).toEqual(["/app/notebooks/mine?page=a"]);
    for (const call of mocks.notebookFindMany.mock.calls) {
      expect(call[0].where).toMatchObject({ ownerId: "alice", deletedAt: null });
    }
    expect(mocks.queryRaw.mock.calls[0][3]).toBe("alice");
  });

  it("reuses a notebook's entries until it or one of its pages changes (a recognition included)", async () => {
    notebook("nb", "alice", "Physics", [page("p1", "momentum")]);
    await searchForOwner("alice", "momentum");
    await searchForOwner("alice", "momentum");
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);

    // Handwriting recognised: the page changed, the notebook's version did not.
    mocks.notebooks[0].pages[0] = page("p1", "momentum and impulse", "", 5_000);
    const r = await searchForOwner("alice", "impulse");
    expect(r.total).toBe(1);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("still answers from workspaces when notebook search fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    add("alice", workspace("w", "W", "Optics"));
    mocks.notebookFindMany.mockRejectedValue(new Error("db hiccup"));
    expect((await searchForOwner("alice", "optics")).total).toBeGreaterThan(0);
  });
});
