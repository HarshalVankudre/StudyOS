// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ users: { getUser: clerk.getUser } }) }));

import { ADDRESS_TTL_MS, FRESH_INTERVAL_MS, clerkAddressSource, createAddressBook, type AddressSource } from "./address";

const verified = (email: string) => ({ kind: "verified" as const, email });

describe("the address book", () => {
  it("keeps an answer briefly, so a run asks Clerk once per student, and asks again after a minute", async () => {
    let t = 0;
    const source = vi.fn<AddressSource>(async () => verified("a@example.com"));
    const book = createAddressBook({ source, now: () => t });
    expect(await book.lookup("u1")).toEqual(verified("a@example.com"));
    expect(await book.lookup("u1")).toEqual(verified("a@example.com"));
    expect(source).toHaveBeenCalledTimes(1);
    // Short on purpose: an address changed in Clerk is the one written to within a minute.
    expect(ADDRESS_TTL_MS).toBeLessThanOrEqual(60_000);
    t += ADDRESS_TTL_MS + 1;
    await book.lookup("u1");
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("re-asks sooner about an address not verified yet", async () => {
    let t = 0;
    const source = vi.fn<AddressSource>(async () => ({ kind: "unverified", email: "a@example.com" }));
    const book = createAddressBook({ source, now: () => t });
    await book.lookup("u1");
    t += 31_000;
    await book.lookup("u1");
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("asks afresh when told to (turning email on), but at most once per student every 30 s", async () => {
    let t = 0;
    const source = vi.fn<AddressSource>(async () => verified("a@example.com"));
    const book = createAddressBook({ source, now: () => t });
    await book.lookup("u1");
    t += 1_000;
    // Just fetched: a fresh lookup gets that answer, without another call.
    await book.lookup("u1", { fresh: true });
    expect(source).toHaveBeenCalledTimes(1);
    t += FRESH_INTERVAL_MS;
    await book.lookup("u1", { fresh: true });
    expect(source).toHaveBeenCalledTimes(2);
    // Toggling in a loop does not become a stream of Clerk calls.
    for (let i = 0; i < 10; i++) await book.lookup("u1", { fresh: true });
    expect(source).toHaveBeenCalledTimes(2);
    // Another student is asked on their own.
    await book.lookup("u2", { fresh: true });
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("answers 'unavailable' when Clerk is down, and pauses every lookup (fresh ones too) instead of asking per student", async () => {
    let t = 0;
    const source = vi.fn<AddressSource>(async () => {
      throw new Error("clerk down");
    });
    const book = createAddressBook({ source, now: () => t });
    expect(await book.lookup("u1")).toEqual({ kind: "unavailable" });
    expect(await book.lookup("u2")).toEqual({ kind: "unavailable" });
    expect(await book.lookup("u3", { fresh: true })).toEqual({ kind: "unavailable" });
    expect(source).toHaveBeenCalledTimes(1);
    t += 31_000;
    source.mockResolvedValueOnce(verified("b@example.com"));
    expect(await book.lookup("u2")).toEqual(verified("b@example.com"));
  });

  it("gives up on Clerk after a few seconds (the late answer is dropped) and pauses as for an outage", async () => {
    vi.useFakeTimers();
    try {
      const source = vi.fn<AddressSource>(() => new Promise(() => {}));
      const book = createAddressBook({ source, timeoutMs: 5_000 });
      const pending = book.lookup("u1");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toEqual({ kind: "unavailable" });
      expect(await book.lookup("u2")).toEqual({ kind: "unavailable" });
      expect(source).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is bounded: the oldest answers go first", async () => {
    const source = vi.fn<AddressSource>(async (id) => verified(`${id}@example.com`));
    const book = createAddressBook({ source, maxEntries: 2 });
    for (const id of ["u1", "u2", "u3"]) await book.lookup(id);
    await book.lookup("u3");
    await book.lookup("u1");
    expect(source).toHaveBeenCalledTimes(4);
  });
});

describe("reading the address from Clerk", () => {
  const user = (primary: { emailAddress: string; verification: { status: string } | null } | null) => ({
    primaryEmailAddressId: primary ? "e1" : null,
    primaryEmailAddress: primary ? { id: "e1", ...primary } : null,
    emailAddresses: primary ? [{ id: "e2", emailAddress: "other@example.com", verification: { status: "verified" } }, { id: "e1", ...primary }] : [],
  });

  it("uses the primary address only, and says whether Clerk verified it", async () => {
    clerk.getUser.mockResolvedValueOnce(user({ emailAddress: "me@example.com", verification: { status: "verified" } }));
    expect(await clerkAddressSource("u1")).toEqual({ kind: "verified", email: "me@example.com" });
    clerk.getUser.mockResolvedValueOnce(user({ emailAddress: "me@example.com", verification: { status: "unverified" } }));
    expect(await clerkAddressSource("u1")).toEqual({ kind: "unverified", email: "me@example.com" });
    clerk.getUser.mockResolvedValueOnce(user({ emailAddress: "me@example.com", verification: null }));
    expect(await clerkAddressSource("u1")).toEqual({ kind: "unverified", email: "me@example.com" });
    clerk.getUser.mockResolvedValueOnce(user(null));
    expect(await clerkAddressSource("u1")).toEqual({ kind: "missing" });
  });

  it("treats a deleted account as having no address, and anything else as Clerk being unreachable", async () => {
    clerk.getUser.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    expect(await clerkAddressSource("gone")).toEqual({ kind: "missing" });
    clerk.getUser.mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }));
    await expect(clerkAddressSource("u1")).rejects.toThrow("rate limited");
  });
});
