import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "./types";

/**
 * A tiny in-memory stand-in for the Workspace table that understands the
 * filters the store uses (owner, version, deletedAt null / not null / ranges).
 */
interface Row {
  id: string;
  ownerId: string;
  name: string;
  icon: string | null;
  data: string;
  version: number;
  deletedAt: Date | null;
  updatedAt: Date;
}

const db = vi.hoisted(() => ({ rows: [] as Row[] }));
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));

type Where = Record<string, unknown>;

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key as keyof Row];
    if (cond === null) return value === null;
    if (cond instanceof Date || typeof cond !== "object") return value === cond;
    const c = cond as { not?: null; gte?: Date; lt?: Date };
    if ("not" in c && c.not === null && value === null) return false;
    if (c.gte && !(value instanceof Date && value >= c.gte)) return false;
    if (c.lt && !(value instanceof Date && value < c.lt)) return false;
    return true;
  });
}

function pick(row: Row, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.keys(select).map((k) => [k, row[k as keyof Row]]),
  );
}

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        const row = Object.assign(
          { version: 1, deletedAt: null, icon: null, updatedAt: new Date() },
          data,
        ) as Row;
        db.rows.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
        const row = db.rows.find((r) => matches(r, where));
        return row ? pick(row, select) : null;
      }),
      findMany: vi.fn(async ({ where, select }: { where: Where; select?: Record<string, boolean> }) =>
        db.rows.filter((r) => matches(r, where)).map((r) => pick(r, select)),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
        const hits = db.rows.filter((r) => matches(r, where));
        for (const row of hits) {
          for (const [k, v] of Object.entries(data)) {
            if (k === "version" && typeof v === "object" && v) row.version += 1;
            else (row as unknown as Record<string, unknown>)[k] = v;
          }
        }
        return { count: hits.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Where }) => {
        const before = db.rows.length;
        db.rows = db.rows.filter((r) => !matches(r, where));
        return { count: before - db.rows.length };
      }),
    },
  },
}));

import {
  deleteWorkspacePermanently,
  duplicateWorkspace,
  getWorkspace,
  getWorkspaceState,
  getWorkspaceVersion,
  listTrashedWorkspaces,
  listWorkspaces,
  restoreWorkspace,
  saveWorkspace,
  trashWorkspace,
} from "./store";

function ws(id: string, name = "Semester"): Workspace {
  return {
    id,
    name,
    pages: [{ id: "p1", title: "Home", blocks: [{ id: "b1", type: "paragraph", text: "hi" }] }],
    databases: [],
  };
}

function seed(id: string, extra: Partial<Row> = {}) {
  db.rows.push({
    id,
    ownerId: "user-1",
    name: id,
    icon: null,
    data: JSON.stringify(ws(id, id)),
    version: 1,
    deletedAt: null,
    updatedAt: new Date(),
    ...extra,
  });
}

beforeEach(() => {
  db.rows = [];
  mocks.auth.mockResolvedValue({ userId: "user-1" });
});

describe("tolerant load", () => {
  it("loads a workspace whose stored data has one invalid block", async () => {
    const doc = ws("a") as unknown as { pages: { blocks: unknown[] }[] };
    doc.pages[0].blocks.push({ id: "bad", type: "flashcards", cards: "oops" });
    seed("a", { data: JSON.stringify(doc), version: 4 });
    const state = await getWorkspaceState("a");
    expect(state?.version).toBe(4);
    expect(state?.workspace.pages[0].blocks).toEqual([
      { id: "b1", type: "paragraph", text: "hi" },
      { id: "bad", type: "flashcards", cards: [] },
    ]);
  });

  it("is null only for unreadable data or someone else's workspace", async () => {
    seed("broken", { data: "{nope" });
    seed("theirs", { ownerId: "user-2" });
    expect(await getWorkspace("broken")).toBeNull();
    expect(await getWorkspace("theirs")).toBeNull();
  });
});

describe("version-checked saves", () => {
  it("saves against the current version and advances it", async () => {
    seed("a");
    const result = await saveWorkspace("a", ws("a", "Renamed"), 1);
    expect(result).toEqual({ status: "saved", version: 2 });
    expect((await getWorkspace("a"))?.name).toBe("Renamed");
  });

  it("rejects a stale-version save without writing", async () => {
    seed("a", { version: 3 });
    const result = await saveWorkspace("a", ws("a", "Stale"), 2);
    expect(result).toEqual({ status: "conflict", version: 3 });
    expect((await getWorkspace("a"))?.name).toBe("a");
  });

  it("round-trips a blank flashcard side", async () => {
    seed("a");
    const doc = ws("a");
    doc.pages[0].blocks.push({ id: "d", type: "flashcards", cards: [{ id: "c", front: "", back: "" }] });
    await saveWorkspace("a", doc, 1);
    expect(await getWorkspace("a")).toEqual(doc);
  });

  it("reports not_found for a trashed workspace", async () => {
    seed("a", { deletedAt: new Date() });
    expect(await saveWorkspace("a", ws("a"), 1)).toEqual({ status: "not_found" });
  });
});

describe("trash", () => {
  it("trashed workspaces disappear from every listing and read, and can be restored", async () => {
    seed("a");
    seed("b");
    expect(await trashWorkspace("a")).toBe(true);

    expect((await listWorkspaces()).map((w) => w.id)).toEqual(["b"]);
    expect(await getWorkspace("a")).toBeNull();
    expect(await getWorkspaceVersion("a")).toBeNull();
    const trash = await listTrashedWorkspaces();
    expect(trash.map((w) => w.id)).toEqual(["a"]);
    expect(trash[0].purgeAt.getTime() - trash[0].deletedAt.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );

    expect(await restoreWorkspace("a")).toBe(true);
    expect((await listWorkspaces()).map((w) => w.id).sort()).toEqual(["a", "b"]);
    expect(await listTrashedWorkspaces()).toEqual([]);
  });

  it("only deletes permanently from the trash", async () => {
    seed("a");
    expect(await deleteWorkspacePermanently("a")).toBe(false);
    await trashWorkspace("a");
    expect(await deleteWorkspacePermanently("a")).toBe(true);
    expect(db.rows).toHaveLength(0);
  });

  it("purges items older than 30 days and cannot restore them", async () => {
    seed("old", { deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) });
    expect(await restoreWorkspace("old")).toBe(false);
    expect(await listTrashedWorkspaces()).toEqual([]);
    expect(db.rows).toHaveLength(0);
  });

  it("never touches another user's trash", async () => {
    seed("theirs", { ownerId: "user-2", deletedAt: new Date() });
    expect(await restoreWorkspace("theirs")).toBe(false);
    expect(await deleteWorkspacePermanently("theirs")).toBe(false);
    expect(await listTrashedWorkspaces()).toEqual([]);
  });
});

describe("duplicate", () => {
  it("creates an independent copy with a new id and name", async () => {
    seed("a");
    const copyId = await duplicateWorkspace("a", (name) => `${name} (copy)`);
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe("a");
    const copy = await getWorkspace(copyId!);
    expect(copy?.name).toBe("a (copy)");
    expect(copy?.id).toBe(copyId);
    expect(copy?.pages).toEqual(ws("a").pages);
  });

  it("does not duplicate a trashed workspace", async () => {
    seed("a", { deletedAt: new Date() });
    expect(await duplicateWorkspace("a", (n) => n)).toBeNull();
  });
});
