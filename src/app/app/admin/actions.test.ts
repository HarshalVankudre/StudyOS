// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_owner" as string | null,
  updateMany: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/db", () => ({ prisma: { feedback: { updateMany: m.updateMany } } }));

import { setFeedbackStatusAction } from "./actions";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.stubEnv("STUDYOS_ADMIN_USER_IDS", "user_owner");
  m.userId = "user_owner";
  m.updateMany.mockReset().mockResolvedValue({ count: 1 });
  m.revalidate.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("setFeedbackStatusAction", () => {
  it("lets an admin mark a message read or done", async () => {
    await setFeedbackStatusAction(form({ id: "fb_1", status: "done" }));
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: "fb_1" }, data: { status: "done" } });
    expect(m.revalidate).toHaveBeenCalledWith("/app/admin");
  });

  it("does nothing for anyone else, signed out included", async () => {
    for (const userId of ["user_student", null]) {
      m.userId = userId;
      await setFeedbackStatusAction(form({ id: "fb_1", status: "done" }));
    }
    vi.stubEnv("STUDYOS_ADMIN_USER_IDS", "");
    m.userId = "user_owner";
    await setFeedbackStatusAction(form({ id: "fb_1", status: "done" }));
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("ignores unknown statuses and missing ids", async () => {
    await setFeedbackStatusAction(form({ id: "fb_1", status: "deleted" }));
    await setFeedbackStatusAction(form({ status: "read" }));
    expect(m.updateMany).not.toHaveBeenCalled();
  });
});
