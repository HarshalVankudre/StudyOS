import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { findUserIdsByEmail, parseLookupEmail } from "./user-search";

describe("parseLookupEmail", () => {
  it("accepts a plausible address, trimmed and lower-cased", () => {
    expect(parseLookupEmail("  Ada@Example.org ")).toBe("ada@example.org");
    expect(parseLookupEmail(["ada@example.org", "x"])).toBe("ada@example.org");
  });

  it("refuses ids, blanks, spaces and oversized input", () => {
    for (const bad of ["user_2abc", "", "a b@example.org", "ada@", "@example.org", `${"a".repeat(250)}@x.io`, 42, null]) {
      expect(parseLookupEmail(bad), String(bad)).toBeNull();
    }
  });
});

describe("findUserIdsByEmail", () => {
  it("returns the matching ids, asking Clerk for that address only", async () => {
    const getUserList = vi.fn().mockResolvedValue({ data: [{ id: "user_1" }] });
    await expect(findUserIdsByEmail("ada@example.org", { getUserList })).resolves.toEqual({
      status: "found",
      userIds: ["user_1"],
    });
    expect(getUserList).toHaveBeenCalledWith({ emailAddress: ["ada@example.org"], limit: 5 });
  });

  it("says when nobody has the address", async () => {
    const getUserList = vi.fn().mockResolvedValue({ data: [] });
    await expect(findUserIdsByEmail("nobody@example.org", { getUserList })).resolves.toEqual({ status: "none" });
  });

  it("never throws when Clerk fails", async () => {
    const getUserList = vi.fn().mockRejectedValue(new Error("503"));
    await expect(findUserIdsByEmail("ada@example.org", { getUserList })).resolves.toEqual({ status: "unavailable" });
  });
});
