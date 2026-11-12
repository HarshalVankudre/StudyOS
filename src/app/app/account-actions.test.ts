import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  cancelAll: vi.fn(),
  erase: vi.fn(),
  tombstone: vi.fn(),
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
  cancelAllBillingForUser: m.cancelAll,
  markAccountDeleted: m.tombstone,
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
});

describe("deleteAccountAction billing", () => {
  it("stops all billing, erases, then tombstones", async () => {
    await expect(deleteAccountAction()).rejects.toMatchObject({ url: "/" });
    expect(m.cancelAll).toHaveBeenCalledWith("user_1");
    expect(m.calls).toEqual(["cancelAll", "erase", "tombstone", "deleteUser"]);
  });

  it("aborts without erasing anything when billing cannot be stopped", async () => {
    m.cancelAll.mockRejectedValue(new Error("stripe down"));
    expect(await deleteAccountAction()).toEqual({ error: "billing_cancel_failed" });
    expect(m.erase).not.toHaveBeenCalled();
    expect(m.tombstone).not.toHaveBeenCalled();
  });
});
