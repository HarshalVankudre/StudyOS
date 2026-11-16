// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_owner" as string | null,
  clear: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/ops/error-overview", () => ({ clearErrorEvent: m.clear }));

import { clearErrorEventAction } from "./error-actions";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.stubEnv("STUDYOS_ADMIN_USER_IDS", "user_owner");
  m.userId = "user_owner";
  m.clear.mockReset().mockResolvedValue(1);
  m.revalidate.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("clearErrorEventAction", () => {
  it("clears one kind of error for an admin and refreshes the console", async () => {
    await clearErrorEventAction(form({ fingerprint: "0123456789abcdef" }));
    expect(m.clear).toHaveBeenCalledWith("0123456789abcdef");
    expect(m.revalidate).toHaveBeenCalledWith("/app/admin");
  });

  it("clears the overflow row too", async () => {
    await clearErrorEventAction(form({ fingerprint: "overflow" }));
    expect(m.clear).toHaveBeenCalledWith("overflow");
  });

  it("does nothing for anyone else, signed out included", async () => {
    for (const userId of ["user_student", null]) {
      m.userId = userId;
      await clearErrorEventAction(form({ fingerprint: "0123456789abcdef" }));
    }
    expect(m.clear).not.toHaveBeenCalled();
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it("ignores anything that is not a fingerprint", async () => {
    for (const fingerprint of ["", "0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", "x".repeat(16)]) {
      await clearErrorEventAction(form({ fingerprint }));
    }
    await clearErrorEventAction(form({}));
    expect(m.clear).not.toHaveBeenCalled();
  });
});
