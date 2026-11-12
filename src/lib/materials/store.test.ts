// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  workspace: { findFirst: vi.fn() },
  studyMaterial: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    ...m,
    // createMaterial checks the caps and inserts under an advisory lock.
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ ...m, $queryRaw: async () => [] }),
  },
}));

import { createMaterial, deleteMaterial, getMaterial, listMaterials } from "./store";
import { MAX_STORED_CHARS_PER_USER } from "./limits";

const LIVE = { ownerId: "user-1", deletedAt: null };
const row = {
  id: "mat-1",
  title: "Lecture",
  kind: "pdf",
  pageCount: 2,
  pageChars: "[10,20]",
  charCount: 30,
  sourcePages: 2,
  truncated: false,
  sourcePageId: null,
  createdAt: new Date(0),
};

beforeEach(() => {
  m.workspace.findFirst.mockResolvedValue({ id: "ws-1" });
  m.studyMaterial.findMany.mockResolvedValue([row]);
  m.studyMaterial.findFirst.mockResolvedValue(null);
  m.studyMaterial.count.mockResolvedValue(0);
  m.studyMaterial.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { charCount: 0 } });
  m.studyMaterial.create.mockResolvedValue(row);
  m.studyMaterial.deleteMany.mockResolvedValue({ count: 1 });
});

describe("material store owner scoping", () => {
  it("lists only the owner's material in a workspace that is not in the trash", async () => {
    const list = await listMaterials("user-1", "ws-1");
    expect(m.studyMaterial.findMany.mock.calls[0][0].where).toEqual({
      ownerId: "user-1",
      workspaceId: "ws-1",
      workspace: LIVE,
    });
    expect(list[0]).toMatchObject({ id: "mat-1", pageChars: [10, 20], createdAt: new Date(0).toISOString() });
  });

  it("reads and deletes only the owner's material, never one in a trashed workspace", async () => {
    m.studyMaterial.findFirst.mockResolvedValue({ id: "mat-1", workspaceId: "ws-1", title: "T", pages: '["a","b"]' });
    expect(await getMaterial("user-1", "mat-1")).toEqual({ id: "mat-1", workspaceId: "ws-1", title: "T", pages: ["a", "b"] });
    expect(m.studyMaterial.findFirst.mock.calls[0][0].where).toEqual({ id: "mat-1", ownerId: "user-1", workspace: LIVE });

    await deleteMaterial("intruder", "mat-1");
    expect(m.studyMaterial.deleteMany.mock.calls[0][0].where).toEqual({
      id: "mat-1",
      ownerId: "intruder",
      workspace: { ownerId: "intruder", deletedAt: null },
    });
  });

  it("refuses to add material to a workspace the user does not own (or that is trashed)", async () => {
    m.workspace.findFirst.mockResolvedValue(null);
    const result = await createMaterial({
      ownerId: "intruder",
      workspaceId: "ws-1",
      title: "x",
      kind: "text",
      pages: ["hello world"],
      sourcePages: 1,
      truncated: false,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(m.workspace.findFirst.mock.calls[0][0].where).toEqual({ id: "ws-1", ownerId: "intruder", deletedAt: null });
    expect(m.studyMaterial.create).not.toHaveBeenCalled();
  });

  it("reuses identical content and enforces the per-student storage cap", async () => {
    const input = {
      ownerId: "user-1",
      workspaceId: "ws-1",
      title: "x",
      kind: "text" as const,
      pages: ["hello world"],
      sourcePages: 1,
      truncated: false,
    };
    m.studyMaterial.findFirst.mockResolvedValueOnce(row);
    expect(await createMaterial(input)).toMatchObject({ ok: true, reused: true });

    m.studyMaterial.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { charCount: MAX_STORED_CHARS_PER_USER - 5 },
    });
    expect(await createMaterial(input)).toEqual({ ok: false, reason: "storage" });
    expect(m.studyMaterial.create).not.toHaveBeenCalled();
  });
});
