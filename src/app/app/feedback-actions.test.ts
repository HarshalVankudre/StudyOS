import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userId: "user_1" as string | null,
  order: [] as string[],
  count: vi.fn(),
  create: vi.fn(),
  lockKey: "" as string,
  report: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
// The limit check runs under the student's lock, in one transaction.
vi.mock("@/lib/db-lock", () => ({
  userLockKey: (scope: string, userId: string) => `${scope}:${userId}`,
  withKeyLock: async (key: string, fn: (tx: unknown) => unknown) => {
    m.lockKey = key;
    m.order.push("lock");
    return fn({ feedback: { count: m.count, create: m.create } });
  },
}));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.report }));

import { sendFeedbackAction } from "./feedback-actions";
import { FEEDBACK_MAX_LENGTH, sanitizeFeedbackPath } from "@/lib/feedback";

const valid = { kind: "bug" as const, message: "The quiz skips question 3.", pagePath: "/app/w1", locale: "de", contactOk: true };

beforeEach(() => {
  m.userId = "user_1";
  m.order.length = 0;
  m.lockKey = "";
  m.count.mockReset().mockImplementation(async () => {
    m.order.push("count");
    return 0;
  });
  m.create.mockReset().mockImplementation(async () => {
    m.order.push("create");
    return {};
  });
  m.report.mockReset();
});

describe("sendFeedbackAction", () => {
  it("stores a valid message for the signed-in student", async () => {
    expect(await sendFeedbackAction(valid)).toEqual({ ok: true });
    expect(m.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        kind: "bug",
        message: "The quiz skips question 3.",
        pagePath: "/app/w1",
        locale: "de",
        contactOk: true,
      },
    });
    // Counted under the student's own lock, before the insert.
    expect(m.lockKey).toBe("feedback:user_1");
    expect(m.order).toEqual(["lock", "count", "count", "create"]);
  });

  it("requires a signed-in user", async () => {
    m.userId = null;
    expect(await sendFeedbackAction(valid)).toEqual({ ok: false, error: "unauthorized" });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("refuses messages that are too short or too long once trimmed, and unknown kinds", async () => {
    for (const bad of [
      { ...valid, message: "  hi   " },
      { ...valid, message: "x".repeat(FEEDBACK_MAX_LENGTH + 1) },
      { ...valid, kind: "praise" as unknown as "bug" },
      { ...valid, message: 42 as unknown as string },
    ]) {
      expect(await sendFeedbackAction(bad)).toEqual({ ok: false, error: "invalid" });
    }
    expect(m.create).not.toHaveBeenCalled();
  });

  it("trims the message and accepts one at the length limit", async () => {
    expect(await sendFeedbackAction({ ...valid, message: `  ${"y".repeat(FEEDBACK_MAX_LENGTH)}  ` })).toEqual({ ok: true });
    expect(m.create.mock.calls[0][0].data.message).toBe("y".repeat(FEEDBACK_MAX_LENGTH));
  });

  it("keeps only the path: no query string, no hash, nothing that is not a site path", async () => {
    await sendFeedbackAction({ ...valid, pagePath: "/app/w1?page=p2&token=secret#block-9" });
    expect(m.create.mock.calls[0][0].data.pagePath).toBe("/app/w1");
    for (const pagePath of ["https://evil.example/app", "//evil.example/x", "app/w1", "", `/${"a".repeat(300)}`, null]) {
      m.create.mockClear();
      expect(await sendFeedbackAction({ ...valid, pagePath })).toEqual({ ok: true });
      expect(m.create.mock.calls[0][0].data.pagePath).toBeNull();
    }
  });

  it("stores only a supported locale and contactOk only when it is true", async () => {
    await sendFeedbackAction({ ...valid, locale: "xx-evil", contactOk: undefined });
    expect(m.create.mock.calls[0][0].data).toMatchObject({ locale: null, contactOk: false });
  });

  /** Serve `hour` for the last-hour count and `day` for the last-day count. */
  function sentBefore(hour: number, day: number) {
    m.count.mockImplementation(async ({ where }: { where: { createdAt: { gte: Date } } }) =>
      Date.now() - where.createdAt.gte.getTime() <= 60 * 60 * 1000 ? hour : day,
    );
  }

  it("allows 5 messages an hour", async () => {
    sentBefore(4, 4);
    expect(await sendFeedbackAction(valid)).toEqual({ ok: true });
    m.create.mockClear();
    sentBefore(5, 5);
    expect(await sendFeedbackAction(valid)).toEqual({ ok: false, error: "rate_limited" });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("allows 20 messages a day", async () => {
    sentBefore(0, 19);
    expect(await sendFeedbackAction(valid)).toEqual({ ok: true });
    m.create.mockClear();
    sentBefore(0, 20);
    expect(await sendFeedbackAction(valid)).toEqual({ ok: false, error: "rate_limited" });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("counts the student's own messages only", async () => {
    await sendFeedbackAction(valid);
    for (const [query] of m.count.mock.calls) expect(query.where.userId).toBe("user_1");
  });

  it("reports a database failure and returns a typed error instead of throwing", async () => {
    m.create.mockRejectedValue(new Error("db down"));
    expect(await sendFeedbackAction(valid)).toEqual({ ok: false, error: "failed" });
    expect(m.report).toHaveBeenCalledWith(expect.any(Error), { source: "feedback.send", userId: "user_1" });
  });
});

describe("sanitizeFeedbackPath", () => {
  it("returns the path part of a site path", () => {
    expect(sanitizeFeedbackPath("/app/settings#billing")).toBe("/app/settings");
    expect(sanitizeFeedbackPath("/")).toBe("/");
    expect(sanitizeFeedbackPath(`/${"a".repeat(299)}`)).toHaveLength(300);
  });

  it("rejects everything else", () => {
    expect(sanitizeFeedbackPath(undefined)).toBeNull();
    expect(sanitizeFeedbackPath("javascript:alert(1)")).toBeNull();
    expect(sanitizeFeedbackPath("/app/\nfoo")).toBeNull();
    expect(sanitizeFeedbackPath("?q=1")).toBeNull();
  });
});
