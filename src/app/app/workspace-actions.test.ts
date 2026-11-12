// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  duplicateWorkspace: vi.fn(),
  saveNewWorkspace: vi.fn(),
  usageCount: vi.fn(),
  usageCreate: vi.fn(),
  workspaceCount: vi.fn(),
  subFindUnique: vi.fn(),
  configFindUnique: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT ${url}`), { url });
  },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: m.auth }));
vi.mock("@/lib/i18n/server", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getI18n: async () => ({ dict: en, locale: "en" }) };
});
vi.mock("@/lib/workspace/store", () => ({
  duplicateWorkspace: m.duplicateWorkspace,
  saveNewWorkspace: m.saveNewWorkspace,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    usageEvent: { count: m.usageCount, create: m.usageCreate },
    workspace: { count: m.workspaceCount },
    subscription: { findUnique: m.subFindUnique },
    dailyStudyAgentConfig: { findUnique: m.configFindUnique },
    // Usage limits count and record under an advisory lock in a transaction.
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: async () => [], usageEvent: { count: m.usageCount, create: m.usageCreate } }),
  },
}));

import { duplicateWorkspaceAction, loadDemoAction } from "./actions";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { MAX_WORKSPACES_PER_USER, USAGE_LIMITS } from "@/lib/usage-limits";
import type { Workspace } from "@/lib/workspace/types";

beforeEach(() => {
  m.auth.mockResolvedValue({ userId: "user_1" });
  m.duplicateWorkspace.mockResolvedValue("copy-1");
  m.saveNewWorkspace.mockResolvedValue("demo-1");
  m.usageCount.mockResolvedValue(0);
  m.usageCreate.mockResolvedValue({});
  m.workspaceCount.mockResolvedValue(3);
  m.subFindUnique.mockResolvedValue(null);
  m.configFindUnique.mockResolvedValue(null);
});

describe("duplicateWorkspaceAction", () => {
  it("copies the workspace and records the copy against the rate limit", async () => {
    expect(await duplicateWorkspaceAction("w1")).toEqual({ ok: true, id: "copy-1" });
    expect(m.usageCreate).toHaveBeenCalledWith({ data: { userId: "user_1", kind: "workspace_duplicate" } });
    expect(m.workspaceCount).toHaveBeenCalledWith({ where: { ownerId: "user_1" } });
  });

  it("refuses at the workspace cap with a message that says what to do", async () => {
    m.workspaceCount.mockResolvedValue(MAX_WORKSPACES_PER_USER);
    expect(await duplicateWorkspaceAction("w1")).toEqual({
      ok: false,
      code: "limit",
      message: fmt(en.limits.workspaceCap, { max: MAX_WORKSPACES_PER_USER }),
    });
    expect(m.duplicateWorkspace).not.toHaveBeenCalled();
  });

  it("is rate-limited", async () => {
    m.usageCount.mockResolvedValue(USAGE_LIMITS.workspace_duplicate.free);
    expect(await duplicateWorkspaceAction("w1")).toEqual({
      ok: false,
      code: "rate_limited",
      message: en.limits.rateLimited,
    });
    expect(m.duplicateWorkspace).not.toHaveBeenCalled();
  });

  it("does nothing for a signed-out caller or a bogus id", async () => {
    m.auth.mockResolvedValue({ userId: null });
    expect((await duplicateWorkspaceAction("w1")).ok).toBe(false);
    m.auth.mockResolvedValue({ userId: "user_1" });
    expect((await duplicateWorkspaceAction("x".repeat(500))).ok).toBe(false);
    expect(m.duplicateWorkspace).not.toHaveBeenCalled();
  });
});

describe("loadDemoAction", () => {
  it("creates nothing at the workspace cap", async () => {
    m.workspaceCount.mockResolvedValue(MAX_WORKSPACES_PER_USER);
    await expect(loadDemoAction()).rejects.toMatchObject({ url: "/app" });
    expect(m.saveNewWorkspace).not.toHaveBeenCalled();
  });

  it("opens the demo below the cap", async () => {
    await expect(loadDemoAction()).rejects.toMatchObject({ url: "/app/demo-1" });
  });

  it("dates the demo around the student's own today, so nothing starts out overdue", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 23:30 UTC on 12 November is already 13 November in Tokyo.
    vi.setSystemTime(new Date("2026-11-12T23:30:00.000Z"));
    try {
      m.configFindUnique.mockResolvedValue({ timeZone: "Asia/Tokyo" });
      await expect(loadDemoAction()).rejects.toMatchObject({ url: "/app/demo-1" });
      const saved = m.saveNewWorkspace.mock.calls.at(-1)![0] as Workspace;
      const due = saved.databases
        .find((d) => d.id === "db-assignments")!
        .rows.map((r) => r.cells["a-due"] as string);
      expect(due).toContain("2026-11-17"); // Problem Set 3: four days after the 13th
      expect(m.configFindUnique).toHaveBeenCalledWith({ where: { userId: "user_1" }, select: { timeZone: true } });
    } finally {
      vi.useRealTimers();
    }
  });
});
