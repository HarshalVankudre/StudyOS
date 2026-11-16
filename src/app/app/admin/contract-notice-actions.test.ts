import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ userId: "user_op" as string | null, updateMany: vi.fn(), revalidate: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/db", () => ({ prisma: { contractNotice: { updateMany: m.updateMany } } }));
vi.mock("@/lib/ops/admin", () => ({ isAdmin: (id: string | null) => id === "user_op" }));

import { markContractNoticeDoneAction } from "./contract-notice-actions";

const form = (id: string) => {
  const data = new FormData();
  data.set("id", id);
  return data;
};

beforeEach(() => {
  m.userId = "user_op";
  m.updateMany.mockReset().mockResolvedValue({ count: 1 });
  m.revalidate.mockReset();
});

describe("markContractNoticeDoneAction", () => {
  it("marks an open notice done, with when, for an admin", async () => {
    await markContractNoticeDoneAction(form("notice_1"));
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: "notice_1", status: "open" },
      data: { status: "done", handledAt: expect.any(Date) },
    });
    expect(m.revalidate).toHaveBeenCalledWith("/app/admin");
  });

  it("does nothing at all for anyone else, signed out included", async () => {
    for (const user of ["user_2", null]) {
      m.userId = user;
      await markContractNoticeDoneAction(form("notice_1"));
    }
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it("ignores a malformed form", async () => {
    await markContractNoticeDoneAction(form(""));
    await markContractNoticeDoneAction(form("x".repeat(65)));
    expect(m.updateMany).not.toHaveBeenCalled();
  });
});
