import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  stopBilling: vi.fn(),
  erase: vi.fn(),
  tombstone: vi.fn(),
  untombstone: vi.fn(),
  deleteUser: vi.fn(),
  record: vi.fn(),
  isPro: vi.fn(),
  findAccount: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT ${url}`), { url });
  },
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_1" }),
  clerkClient: async () => ({ users: { deleteUser: m.deleteUser } }),
}));
vi.mock("@/lib/billing", () => ({
  markAccountDeleted: m.tombstone,
  stopBillingForDeletedAccount: m.stopBilling,
  unmarkAccountDeleted: m.untombstone,
  isPro: m.isPro,
}));
vi.mock("@/lib/credits", () => ({ getCreditBalance: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { creditAccount: { findUnique: m.findAccount } } }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/account/deletion-reason", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account/deletion-reason")>()),
  recordDeletionReason: m.record,
}));
vi.mock("@/lib/account/erase-user-data", () => ({ eraseUserData: m.erase }));

import { deleteAccountAction } from "./account-actions";

beforeEach(() => {
  m.calls.length = 0;
  for (const [name, fn] of Object.entries(m)) {
    if (typeof fn === "function") {
      fn.mockReset();
      fn.mockImplementation(async () => {
        m.calls.push(name);
      });
    }
  }
  m.stopBilling.mockImplementation(async () => {
    m.calls.push("stopBilling");
    return true;
  });
  m.isPro.mockImplementation(async () => true);
  m.findAccount.mockImplementation(async () => ({ createdAt: new Date("2026-11-01T00:00:00Z") }));
});

describe("deleteAccountAction billing", () => {
  it("tombstones first, then stops all billing, then erases", async () => {
    await expect(deleteAccountAction()).rejects.toMatchObject({ url: "/" });
    expect(m.stopBilling).toHaveBeenCalledWith("user_1");
    // Nothing can be granted or recreated once the tombstone exists, so it
    // must come before the erase (finding 7).
    expect(m.calls).toEqual(["tombstone", "stopBilling", "erase", "deleteUser"]);
  });

  it("when billing cannot be stopped: nothing is erased, the tombstone is withdrawn, the user is told to retry", async () => {
    m.stopBilling.mockImplementation(async () => {
      m.calls.push("stopBilling");
      return false;
    });
    expect(await deleteAccountAction()).toEqual({ error: "billing_cancel_failed" });
    expect(m.erase).not.toHaveBeenCalled();
    expect(m.deleteUser).not.toHaveBeenCalled();
    expect(m.calls).toEqual(["tombstone", "stopBilling", "untombstone"]);
  });
});

describe("deleteAccountAction: why the student is leaving", () => {
  it("stores the answer only after the account is erased, with the plan and account age", async () => {
    await expect(deleteAccountAction({ reason: "tooExpensive", note: "Exams are over" })).rejects.toMatchObject({ url: "/" });
    expect(m.calls).toEqual(["tombstone", "stopBilling", "erase", "record", "deleteUser"]);
    expect(m.record).toHaveBeenCalledWith(
      { reason: "tooExpensive", note: "Exams are over" },
      { pro: true, createdAt: new Date("2026-11-01T00:00:00Z") },
    );
  });

  it("stores nothing without an answer, or when nothing was deleted", async () => {
    await expect(deleteAccountAction()).rejects.toMatchObject({ url: "/" });
    expect(m.record).not.toHaveBeenCalled();

    m.stopBilling.mockImplementation(async () => false);
    expect(await deleteAccountAction({ reason: "other" })).toEqual({ error: "billing_cancel_failed" });
    expect(m.record).not.toHaveBeenCalled();
  });

  it("deletes the account even when the answer cannot be stored", async () => {
    m.record.mockImplementation(async () => {
      throw new Error("db down");
    });
    await expect(deleteAccountAction({ reason: "other" })).rejects.toMatchObject({ url: "/" });
    expect(m.deleteUser).toHaveBeenCalledWith("user_1");
  });
});
