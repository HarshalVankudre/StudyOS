import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  stopBilling: vi.fn(),
  erase: vi.fn(),
  tombstone: vi.fn(),
  untombstone: vi.fn(),
  deleteUser: vi.fn(),
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
  isPro: vi.fn(),
}));
vi.mock("@/lib/credits", () => ({ getCreditBalance: vi.fn() }));
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
