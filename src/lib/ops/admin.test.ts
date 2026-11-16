// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));

import { adminUserIds, isAdmin, requireAdmin } from "./admin";

beforeEach(() => {
  m.userId = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("adminUserIds", () => {
  it("reads a comma-separated list, trimming spaces and dropping empties", () => {
    expect([...adminUserIds({ STUDYOS_ADMIN_USER_IDS: " user_a, user_b ,,user_c " })]).toEqual([
      "user_a",
      "user_b",
      "user_c",
    ]);
  });

  it("is empty when unset or blank", () => {
    expect(adminUserIds({}).size).toBe(0);
    expect(adminUserIds({ STUDYOS_ADMIN_USER_IDS: "  , " }).size).toBe(0);
  });
});

describe("isAdmin", () => {
  const env = { STUDYOS_ADMIN_USER_IDS: "user_owner,user_ops" };

  it("is true only for listed ids", () => {
    expect(isAdmin("user_owner", env)).toBe(true);
    expect(isAdmin("user_ops", env)).toBe(true);
    expect(isAdmin("user_student", env)).toBe(false);
  });

  it("is false for nobody and when the list is unset", () => {
    expect(isAdmin(null, env)).toBe(false);
    expect(isAdmin(undefined, env)).toBe(false);
    expect(isAdmin("", env)).toBe(false);
    expect(isAdmin("user_owner", {})).toBe(false);
  });

  it("matches whole ids only", () => {
    expect(isAdmin("user_own", env)).toBe(false);
    expect(isAdmin("user_owner,user_ops", env)).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("returns the admin's id", async () => {
    vi.stubEnv("STUDYOS_ADMIN_USER_IDS", "user_owner");
    m.userId = "user_owner";
    await expect(requireAdmin()).resolves.toBe("user_owner");
  });

  it("is a 404 for other users, signed-out visitors and when no admin is configured", async () => {
    vi.stubEnv("STUDYOS_ADMIN_USER_IDS", "user_owner");
    m.userId = "user_student";
    await expect(requireAdmin()).rejects.toMatchObject({ notFound: true });
    m.userId = null;
    await expect(requireAdmin()).rejects.toMatchObject({ notFound: true });
    vi.stubEnv("STUDYOS_ADMIN_USER_IDS", "");
    m.userId = "user_owner";
    await expect(requireAdmin()).rejects.toMatchObject({ notFound: true });
  });
});
