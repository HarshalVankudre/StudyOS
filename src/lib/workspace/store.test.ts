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

interface ShareRow {
  id: string;
  userId: string;
  workspaceId: string;
  pageId: string;
  revokedAt: Date | null;
}

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  deleted: new Set<string>(),
  shares: [] as ShareRow[],
  shareReads: 0,
}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), report: vi.fn() }));

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
vi.mock("@/lib/ops/report-error", () => ({ reportError: mocks.report }));
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
    deletedAccount: {
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) =>
        db.deleted.has(where.userId) ? { userId: where.userId } : null,
      ),
    },
    pageShare: {
      findMany: vi.fn(async ({ where }: { where: Partial<ShareRow> }) => {
        db.shareReads += 1;
        return db.shares
          .filter((s) => s.workspaceId === where.workspaceId && s.userId === where.userId && s.revokedAt === null)
          .map((s) => ({ id: s.id, pageId: s.pageId }));
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id?: { in: string[] }; workspaceId?: string; userId?: string }; data: { revokedAt: Date } }) => {
          const hits = db.shares.filter(
            (s) =>
              s.revokedAt === null &&
              (!where.id || where.id.in.includes(s.id)) &&
              (!where.workspaceId || s.workspaceId === where.workspaceId) &&
              (!where.userId || s.userId === where.userId),
          );
          for (const s of hits) s.revokedAt = data.revokedAt;
          return { count: hits.length };
        },
      ),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
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
  parseStoredWorkspace,
  restoreWorkspace,
  saveNewWorkspace,
  saveWorkspace,
  trashWorkspace,
  updateWorkspaceWith,
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
  db.deleted.clear();
  db.shares = [];
  db.shareReads = 0;
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.report.mockReset();
});

const share = (id: string, workspaceId: string, pageId: string, userId = "user-1"): ShareRow => ({
  id,
  userId,
  workspaceId,
  pageId,
  revokedAt: null,
});
const revoked = () => db.shares.filter((s) => s.revokedAt !== null).map((s) => s.id).sort();

describe("share links follow the workspace", () => {
  it("moving a workspace to the trash revokes its links; restoring does not bring them back", async () => {
    seed("a");
    seed("b");
    db.shares = [share("s_a1", "a", "p1"), share("s_a2", "a", "p2"), share("s_b", "b", "p1")];
    expect(await trashWorkspace("a")).toBe(true);
    expect(revoked()).toEqual(["s_a1", "s_a2"]);
    expect(await restoreWorkspace("a")).toBe(true);
    expect(revoked()).toEqual(["s_a1", "s_a2"]);
  });

  it("a save that removes a shared page revokes that page's link only", async () => {
    seed("a");
    db.shares = [share("s_kept", "a", "p1"), share("s_gone", "a", "p_deleted")];
    const doc = ws("a");
    expect((await saveWorkspace("a", doc, 1)).status).toBe("saved");
    expect(revoked()).toEqual(["s_gone"]);
  });

  it("costs one read of the workspace's active links per save, and nothing more without one", async () => {
    seed("a");
    expect((await saveWorkspace("a", ws("a"), 1)).status).toBe("saved");
    expect(db.shareReads).toBe(1);
    expect(revoked()).toEqual([]);
  });

  it("a refused save touches no link, and a failing link check does not fail the save", async () => {
    seed("a");
    db.shares = [share("s_gone", "a", "p_deleted")];
    expect((await saveWorkspace("a", ws("a"), 5)).status).toBe("conflict");
    expect(revoked()).toEqual([]);
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.pageShare.findMany).mockRejectedValueOnce(new Error("db hiccup"));
    expect((await saveWorkspace("a", ws("a"), 1)).status).toBe("saved");
    expect(mocks.report).toHaveBeenCalledTimes(1);
  });
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
    expect(result).toMatchObject({ status: "conflict", version: 3 });
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

  // Postgres rejects 0x00 in a text column (verified on the local database):
  // a NUL pasted into the workspace name made every later save fail.
  it("keeps NUL characters out of the name and icon columns (finding 15)", async () => {
    seed("a");
    const doc = { ...ws("a", "Bio\u0000logy"), icon: "\u0000📚" };
    expect(await saveWorkspace("a", doc, 1)).toEqual({ status: "saved", version: 2 });
    const row = db.rows.find((r) => r.id === "a")!;
    expect(row.name).toBe("Biology");
    expect(row.icon).toBe("📚");
    // The document itself is stored as given (JSON escapes the character).
    expect(JSON.parse(row.data).name).toBe("Bio\u0000logy");
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

describe("saveNewWorkspace after account deletion", () => {
  it("saves for a live account", async () => {
    const id = await saveNewWorkspace(ws("x"));
    expect(db.rows.map((r) => r.id)).toEqual([id]);
  });

  it("refuses once the account is tombstoned and writes nothing", async () => {
    db.deleted.add("user-1");
    await expect(saveNewWorkspace(ws("x"))).rejects.toThrow("Account was deleted");
    expect(db.rows).toEqual([]);
  });
});

describe("updateWorkspaceWith (server-side write-through)", () => {
  const rename = (name: string) => (draft: Workspace) => {
    draft.pages[0].title = name;
    return { changed: true, result: name };
  };

  it("saves through the version check and advances the version", async () => {
    seed("a", { version: 3 });
    const result = await updateWorkspaceWith("a", rename("Today"));
    expect(result).toEqual({ status: "saved", version: 4, result: "Today" });
    expect((await getWorkspace("a"))?.pages[0].title).toBe("Today");
  });

  it("re-reads and retries when another save lands in between", async () => {
    seed("a", { version: 1 });
    let calls = 0;
    const result = await updateWorkspaceWith("a", (draft) => {
      calls += 1;
      // Another tab saves while the first attempt is in flight.
      if (calls === 1) db.rows[0].version += 1;
      draft.pages[0].title = "Mine";
      return { changed: true, result: calls };
    });
    expect(calls).toBe(2);
    expect(result).toEqual({ status: "saved", version: 3, result: 2 });
  });

  it("writes nothing when nothing changed, and never touches another user's workspace", async () => {
    seed("a");
    seed("theirs", { ownerId: "user-2" });
    expect(await updateWorkspaceWith("a", () => ({ changed: false, result: null }))).toEqual({
      status: "unchanged",
      result: null,
    });
    expect(db.rows[0].version).toBe(1);
    expect(await updateWorkspaceWith("theirs", rename("x"))).toEqual({ status: "not_found" });
  });

  it("gives up with a conflict after repeated concurrent saves", async () => {
    seed("a");
    const result = await updateWorkspaceWith("a", (draft) => {
      db.rows[0].version += 1;
      draft.pages[0].title = "Mine";
      return { changed: true, result: null };
    });
    expect(result).toEqual({ status: "conflict" });
  });
});

describe("unreadable stored workspaces are reported, never logged raw", () => {
  it("reports unparseable JSON through reportError without the stored text", () => {
    const spy = vi.spyOn(console, "error");
    expect(parseStoredWorkspace({ id: "w-bad", data: "{\"secret exam notes" })).toBeNull();
    expect(mocks.report).toHaveBeenCalledWith(expect.any(Error), { source: "workspace-store", workspaceId: "w-bad" });
    expect(String(mocks.report.mock.calls[0][0].message)).not.toContain("secret");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a document that is not a workspace at all", () => {
    expect(parseStoredWorkspace({ id: "w-num", data: "42" })).toBeNull();
    expect(mocks.report).toHaveBeenCalledWith(expect.any(Error), { source: "workspace-store", workspaceId: "w-num" });
  });
});
