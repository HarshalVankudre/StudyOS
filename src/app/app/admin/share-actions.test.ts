// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_owner" as string | null,
  disable: vi.fn(),
  dismiss: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/share/moderation", () => ({ disableReportedShare: m.disable, dismissShareReports: m.dismiss }));

import { disableSharedPageAction, dismissShareReportsAction } from "./share-actions";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.stubEnv("STUDYOS_ADMIN_USER_IDS", "user_owner");
  m.userId = "user_owner";
  m.disable.mockReset().mockResolvedValue(true);
  m.dismiss.mockReset().mockResolvedValue(2);
  m.revalidate.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe.each([
  ["disableSharedPageAction", disableSharedPageAction, () => m.disable],
  ["dismissShareReportsAction", dismissShareReportsAction, () => m.dismiss],
])("%s", (_name, action, target) => {
  it("acts for an admin and refreshes the console", async () => {
    await action(form({ shareId: "share_1" }));
    expect(target()).toHaveBeenCalledWith("share_1");
    expect(m.revalidate).toHaveBeenCalledWith("/app/admin");
  });

  it("does nothing for anyone else, signed out included", async () => {
    for (const userId of ["user_student", null]) {
      m.userId = userId;
      await action(form({ shareId: "share_1" }));
    }
    expect(target()).not.toHaveBeenCalled();
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it("ignores a missing or oversized id", async () => {
    await action(form({}));
    await action(form({ shareId: "x".repeat(65) }));
    expect(target()).not.toHaveBeenCalled();
  });
});

it("dismissing never turns the link off", async () => {
  await dismissShareReportsAction(form({ shareId: "share_1" }));
  expect(m.disable).not.toHaveBeenCalled();
});
