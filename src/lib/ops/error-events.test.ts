// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ upsert: vi.fn(), imported: vi.fn() }));

vi.mock("@/lib/db", () => {
  m.imported();
  return { prisma: { errorEvent: { upsert: m.upsert } } };
});

import {
  ERROR_EVENT_LIMITS,
  OVERFLOW_FINGERPRINT,
  bufferedErrorEvents,
  errorFingerprint,
  flushErrorEvents,
  normalizeMessage,
  recordErrorEvent,
  redactIds,
  resetErrorEventsForTests,
  setErrorEventsEnabledForTests,
  toErrorEvent,
} from "./error-events";
import { reportError } from "./report-error";

const NOW = new Date("2026-11-15T12:00:00Z");
/** A distinct digit-free word per number (digits would be normalized away). */
const letters = (i: number) => String(i).replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
const record =(message: string, extra: { source?: string; route?: string; frames?: string } = {}) =>
  recordErrorEvent({ source: extra.source ?? "api", route: extra.route ?? "/api/x", message, frames: extra.frames });

beforeEach(() => {
  resetErrorEventsForTests();
  vi.useFakeTimers({ now: NOW });
  m.upsert.mockReset().mockResolvedValue({});
});
afterEach(() => {
  resetErrorEventsForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("fingerprints", () => {
  it("groups the same error whatever its numbers and ids", () => {
    const a = errorFingerprint("api", "/api/x", "Error: timeout after 30000ms for user_2NNEqL2nrIRdJ194ndJqAHwEfxC (3 tries)");
    const b = errorFingerprint("api", "/api/x", "Error: timeout after 12000ms for user_9xYzAbCdEfGh1234567890ab (1 tries)");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    // Workspace cuids, UUIDs, hex digests and long numbers too.
    expect(errorFingerprint("api", null, "Workspace clx9k2m3n0000abcd1234efgh not found")).toBe(
      errorFingerprint("api", null, "Workspace cm1a2b3c4d5e6f7g8h9i0jklm not found"),
    );
    expect(errorFingerprint("api", null, "row 8f14e45f-ceea-467f-a0e6-5c8f2d1e7b3a gone")).toBe(
      errorFingerprint("api", null, "row 1b4e28ba-2fa1-11d2-883f-0016d3cca427 gone"),
    );
    expect(errorFingerprint("api", null, "digest 3f786850e387550fdab836ed7e6dc881de23001b")).toBe(
      errorFingerprint("api", null, "digest a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"),
    );
  });

  it("keeps different errors, sources, routes and codes apart", () => {
    const base = errorFingerprint("api", "/api/x", "PrismaClientKnownRequestError P2002");
    expect(errorFingerprint("api", "/api/x", "PrismaClientKnownRequestError P2025")).not.toBe(base);
    expect(errorFingerprint("billing", "/api/x", "PrismaClientKnownRequestError P2002")).not.toBe(base);
    expect(errorFingerprint("api", "/api/y", "PrismaClientKnownRequestError P2002")).not.toBe(base);
    expect(errorFingerprint("api", null, "PrismaClientKnownRequestError P2002")).not.toBe(base);
    expect(errorFingerprint("api", "/api/x", "TypeError: x is not a function")).not.toBe(
      errorFingerprint("api", "/api/x", "TypeError: y is not a function"),
    );
  });

  it("normalizes numbers and whitespace but keeps words", () => {
    expect(normalizeMessage("Request failed  with status 503\n after 1.5s")).toBe(
      "Request failed with status <n> after <n>s",
    );
    expect(normalizeMessage("generate_hold failed: in_progress (credit_purchase)")).toBe(
      "generate_hold failed: in_progress (credit_purchase)",
    );
  });

  it("redacts ids in what is stored, keeps short numbers and codes", () => {
    const text = redactIds(
      "user_2NNEqL2nrIRdJ194ndJqAHwEfxC paid cus_NffrFeUfNV2Hib via cs_test_a1B2c3D4e5F6g7H8 for clx9k2m3n0000abcd1234efgh, status 500, P2002",
    );
    expect(text).toBe("<id> paid <id> via <id> for <id>, status 500, P2002");
  });
});

describe("toErrorEvent", () => {
  it("caps the message and sample and drops machine paths", () => {
    const frames = Array.from(
      { length: 20 },
      (_, i) => `at fn${i} (C:\\Users\\someone\\Desktop\\StudyOS\\.next\\server\\chunks\\${i}.js:1:2)`,
    ).join("\n");
    const event = toErrorEvent({ source: "api", route: "/api/x", message: `Error: ${"x".repeat(900)}`, frames });
    expect(event.message.length).toBeLessThanOrEqual(ERROR_EVENT_LIMITS.maxMessage);
    expect(event.sample?.split("\n")).toHaveLength(ERROR_EVENT_LIMITS.sampleFrames);
    expect(event.sample).not.toContain("someone");
    expect(event.sample).toContain("at fn0 (.next\\server\\chunks\\0.js:1:2)");
    expect(toErrorEvent({ message: "x", frames: "y".repeat(5_000) }).sample!.length).toBeLessThanOrEqual(
      ERROR_EVENT_LIMITS.maxSample,
    );
  });

  it("defaults a missing source and route", () => {
    const event = toErrorEvent({ source: undefined, route: "  ", message: "" });
    expect(event).toMatchObject({ source: "unknown", route: null, message: "(no message)", sample: null });
  });
});

describe("buffering and flushing", () => {
  beforeEach(() => setErrorEventsEnabledForTests(true));

  it("writes one upsert per fingerprint with the counts summed", async () => {
    vi.stubEnv("DEPLOYMENT_VERSION", " v42 ");
    record("Error: timeout after 100ms");
    vi.setSystemTime(new Date(NOW.getTime() + 1_000));
    record("Error: timeout after 250ms");
    vi.setSystemTime(new Date(NOW.getTime() + 2_000));
    record("Error: timeout after 900ms");
    record("TypeError: boom", { route: "/api/y" });
    record("TypeError: boom", { route: "/api/y" });
    expect(bufferedErrorEvents()).toHaveLength(2);

    await flushErrorEvents();
    expect(m.upsert).toHaveBeenCalledTimes(2);
    const timeout = m.upsert.mock.calls.find((c) => c[0].create.message === "Error: timeout after 100ms")![0];
    expect(timeout.where).toEqual({ fingerprint: errorFingerprint("api", "/api/x", "Error: timeout after 1ms") });
    expect(timeout.create).toMatchObject({
      source: "api",
      route: "/api/x",
      count: 3,
      firstSeen: NOW,
      lastSeen: new Date(NOW.getTime() + 2_000),
      release: "v42",
    });
    expect(timeout.update).toEqual({
      count: { increment: 3 },
      lastSeen: new Date(NOW.getTime() + 2_000),
      release: "v42",
    });
    const boom = m.upsert.mock.calls.find((c) => c[0].create.route === "/api/y")![0];
    expect(boom.update.count).toEqual({ increment: 2 });
    expect(bufferedErrorEvents()).toEqual([]);
  });

  it("writes at most every 30 seconds", async () => {
    record("Error: first");
    // Nothing written yet: the first write waits for the timer (0 ms after a quiet period).
    expect(m.upsert).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    await flushErrorEvents();
    expect(m.upsert).toHaveBeenCalledTimes(1);

    record("Error: second");
    await vi.advanceTimersByTimeAsync(ERROR_EVENT_LIMITS.flushIntervalMs - 1_000);
    expect(bufferedErrorEvents()).toHaveLength(1);
    expect(m.upsert).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(bufferedErrorEvents()).toEqual([]);
    await flushErrorEvents();
    expect(m.upsert).toHaveBeenCalledTimes(2);
  });

  it("writes early when many different errors pile up", async () => {
    record("Error: warm-up");
    await vi.advanceTimersByTimeAsync(0);
    await flushErrorEvents();
    m.upsert.mockClear();
    // Past the minimum gap but well before the 30 s timer.
    await vi.advanceTimersByTimeAsync(ERROR_EVENT_LIMITS.minFlushGapMs);
    for (let i = 0; i < ERROR_EVENT_LIMITS.flushThreshold; i++) record(`Error: kind ${letters(i)}`);
    expect(bufferedErrorEvents()).toEqual([]);
    await flushErrorEvents();
    expect(m.upsert).toHaveBeenCalledTimes(ERROR_EVENT_LIMITS.flushThreshold);
  });

  it("keeps errors that arrive during a write for the next one", async () => {
    let release!: () => void;
    m.upsert.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    record("Error: first");
    await vi.advanceTimersByTimeAsync(0);
    record("Error: during the write");
    const pending = flushErrorEvents();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await pending;
    expect(bufferedErrorEvents()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(ERROR_EVENT_LIMITS.flushIntervalMs);
    await flushErrorEvents();
    expect(m.upsert).toHaveBeenCalledTimes(2);
  });

  it("bounds memory: past the limit, errors count into one overflow row", async () => {
    record("Error: warm-up");
    await vi.advanceTimersByTimeAsync(0);
    await flushErrorEvents();
    // Right after a write the early flush is held back, so the buffer fills.
    const extra = 50;
    for (let i = 0; i < ERROR_EVENT_LIMITS.maxBuffered + extra; i++) record(`Error: kind ${letters(i)}`);
    const buffered = bufferedErrorEvents();
    expect(buffered).toHaveLength(ERROR_EVENT_LIMITS.maxBuffered + 1);
    const overflow = buffered.find((e) => e.fingerprint === OVERFLOW_FINGERPRINT)!;
    expect(overflow.count).toBe(extra);
    expect(overflow).toMatchObject({ source: "ops", route: null, sample: null });
    // A kind already buffered still counts on its own row; a new one goes to overflow.
    record(`Error: kind ${letters(0)}`);
    record("Error: brand new");
    const after = bufferedErrorEvents();
    expect(after).toHaveLength(ERROR_EVENT_LIMITS.maxBuffered + 1);
    expect(after.find((e) => e.message === `Error: kind ${letters(0)}`)!.count).toBe(2);
    expect(after.find((e) => e.fingerprint === OVERFLOW_FINGERPRINT)!.count).toBe(extra + 1);
    // Everything waiting, overflow included, goes out in one write.
    await flushErrorEvents();
    expect(m.upsert).toHaveBeenCalledTimes(1 + ERROR_EVENT_LIMITS.maxBuffered + 1);
  });
});

describe("failure isolation", () => {
  beforeEach(() => setErrorEventsEnabledForTests(true));

  it("never throws or recurses when the database fails, and says so once", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    m.upsert.mockRejectedValue(Object.assign(new Error("db down for user_2NNEqL2nrIRdJ194ndJqAHwEfxC"), { code: "P1001" }));
    expect(() => record("Error: a")).not.toThrow();
    record("Error: b");
    await expect(flushErrorEvents()).resolves.toBeUndefined();
    // No new error was recorded about the failure (no recursion through reportError).
    expect(bufferedErrorEvents()).toEqual([]);
    expect(err).toHaveBeenCalledTimes(1);
    const line = JSON.parse(err.mock.calls[0][0] as string);
    expect(line).toMatchObject({ severity: "WARNING", dropped: 2, error: "Error P1001" });
    expect(JSON.stringify(line)).not.toContain("user_");

    // A second failed write within minutes adds no further line.
    record("Error: c");
    await flushErrorEvents();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("gives up on a write after a few failed upserts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.upsert.mockRejectedValue(new Error("down"));
    record("Error: warm-up");
    await vi.advanceTimersByTimeAsync(0);
    await flushErrorEvents();
    m.upsert.mockClear();
    for (const kind of "abcdefghij") record(`Error: ${kind}`);
    await flushErrorEvents();
    expect(m.upsert).toHaveBeenCalledTimes(ERROR_EVENT_LIMITS.maxFailuresPerFlush);
  });

  it("reportError still logs its line and returns when the write path fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    m.upsert.mockImplementation(() => {
      // Even something in the database layer reporting an error only buffers it.
      reportError(new Error("nested"), { source: "db" });
      throw new Error("db down");
    });
    expect(() => reportError(new Error("boom"), { source: "api", route: "/api/x", userId: "user_1" })).not.toThrow();
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.parse(err.mock.calls[0][0] as string).message).toMatch(/^Error: boom/);
    await flushErrorEvents();
    expect(m.upsert).toHaveBeenCalledTimes(1);
    // The nested report is buffered for the next write, not written in a loop.
    expect(bufferedErrorEvents().map((e) => e.source)).toEqual(["db"]);
  });
});

describe("reportError integration", () => {
  it("counts what the log line shows, without the user id or content", async () => {
    setErrorEventsEnabledForTests(true);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new Error(`could not parse "Midterm on Oct 3" for a@b.com`), {
      source: "api",
      route: "/api/import",
      userId: "user_2NNEqL2nrIRdJ194ndJqAHwEfxC",
      path: "/s/secret-token?x=1",
    });
    expect(err).toHaveBeenCalledTimes(1);
    const [event] = bufferedErrorEvents();
    expect(event).toMatchObject({ source: "api", route: "/api/import", count: 1 });
    expect(event.message).toBe('Error: could not parse "…" for [redacted-email]');
    expect(event.sample).toMatch(/^at /);
    const stored = JSON.stringify(event);
    for (const leaked of ["user_2NN", "Midterm", "a@b.com", "secret-token"]) expect(stored).not.toContain(leaked);
  });

  it("is off in tests by default: nothing is buffered and the database is never loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new Error("boom"), { source: "api" });
    expect(bufferedErrorEvents()).toEqual([]);
    await vi.advanceTimersByTimeAsync(ERROR_EVENT_LIMITS.flushIntervalMs);
    await flushErrorEvents();
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.imported).not.toHaveBeenCalled();
  });

  it("is on outside tests unless switched off, and never in the edge runtime", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    record("Error: on");
    expect(bufferedErrorEvents()).toHaveLength(1);

    resetErrorEventsForTests();
    vi.stubEnv("STUDYOS_ERROR_EVENTS", "off");
    record("Error: switched off");
    expect(bufferedErrorEvents()).toEqual([]);

    resetErrorEventsForTests();
    vi.stubEnv("STUDYOS_ERROR_EVENTS", "");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    record("Error: during the build");
    expect(bufferedErrorEvents()).toEqual([]);

    resetErrorEventsForTests();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("NEXT_RUNTIME", "edge");
    setErrorEventsEnabledForTests(true);
    record("Error: on the edge");
    expect(bufferedErrorEvents()).toEqual([]);
  });
});
