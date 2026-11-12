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

const mocks = vi.hoisted(() => ({ rows: [] as Row[], findMany: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { workspace: { findMany: mocks.findMany } } }));

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

beforeEach(() => {
  clearSearchCache();
  mocks.rows.length = 0;
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
