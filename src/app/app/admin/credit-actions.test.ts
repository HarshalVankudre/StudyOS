// @vitest-environment node
// The operator console's credit adjustment (Support tools), run through the
// real credits module on the in-memory Prisma fake (no database).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb } from "@/test/billing-fakes";

const m = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  userId: "user_owner" as string | null,
  revalidate: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("@/test/billing-fakes");
  m.db = createFakeDb();
  return { prisma: m.db.db };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: m.report }));

import { adjustCreditsAction, type AdjustState } from "./credit-actions";
import { ADMIN_ADJUST_REASON, lookupAccount, parseUserId } from "@/lib/ops/credit-adjust";
import { spendAction } from "@/lib/ops/admin-metrics";
import { getCreditBalance, TRIAL_CREDITS } from "@/lib/credits";

const STUDENT = "user_student1";
const NONCE = "0b6c9a52-3f0e-4d6e-9a8e-1b2c3d4e5f60";
const IDLE: AdjustState = { status: "idle", message: "", nonce: NONCE };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const adjust = (fields: Partial<Record<"userId" | "amount" | "note" | "nonce", string>>) =>
  adjustCreditsAction(IDLE, form({ userId: STUDENT, amount: "500", note: "goodwill, ticket 12", nonce: NONCE, ...fields }));

const adjustments = () => m.db.ledgerFor(STUDENT).filter((l) => l.reason === ADMIN_ADJUST_REASON);

beforeEach(async () => {
  vi.stubEnv("STUDYOS_ADMIN_USER_IDS", "user_owner");
  m.userId = "user_owner";
  m.db.reset();
  m.revalidate.mockReset();
  m.report.mockReset();
  await getCreditBalance(STUDENT); // the student's account, with the trial
});
afterEach(() => vi.unstubAllEnvs());

describe("adjustCreditsAction: the gate", () => {
  it("does nothing at all for anyone but an admin, signed out included", async () => {
    for (const userId of ["user_student1", null]) {
      m.userId = userId;
      expect(await adjust({})).toEqual({ status: "idle", message: "", nonce: "" });
    }
    vi.stubEnv("STUDYOS_ADMIN_USER_IDS", "");
    m.userId = "user_owner";
    expect(await adjust({})).toMatchObject({ status: "idle", message: "" });
    expect(adjustments()).toEqual([]);
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS);
    expect(m.revalidate).not.toHaveBeenCalled();
  });
});

describe("adjustCreditsAction: validation", () => {
  it("refuses a bad user id, amount, note or nonce, writes nothing and keeps the form's values and nonce", async () => {
    const cases: [Partial<Record<"userId" | "amount" | "note" | "nonce", string>>, RegExp][] = [
      [{ userId: "" }, /Clerk user id/],
      [{ userId: "user 1; drop" }, /Clerk user id/],
      [{ amount: "" }, /whole number/],
      [{ amount: "12.5" }, /whole number/],
      [{ amount: "1e3" }, /whole number/],
      [{ amount: "0" }, /must not be zero/],
      [{ amount: "100001" }, /at most 100,000/],
      [{ amount: "-100001" }, /at most 100,000/],
      [{ note: "   " }, /note is required/],
      [{ note: "x".repeat(201) }, /at most 200 characters/],
      [{ nonce: "" }, /out of date/],
      [{ nonce: "short" }, /out of date/],
    ];
    for (const [fields, message] of cases) {
      const state = await adjust(fields);
      expect(state, JSON.stringify(fields)).toMatchObject({ status: "error", message: expect.stringMatching(message) });
      expect(state.nonce).toBe(fields.nonce ?? NONCE);
      expect(state.values).toMatchObject({ amount: fields.amount ?? "500" });
    }
    expect(adjustments()).toEqual([]);
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS);
  });

  it("accepts the limits themselves and a leading +", async () => {
    expect(await adjust({ amount: "+100000", nonce: `${NONCE}-a` })).toMatchObject({ status: "done" });
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS + 100_000);
    expect(await adjust({ amount: "-100000", nonce: `${NONCE}-b` })).toMatchObject({ status: "done" });
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS);
  });
});

describe("adjustCreditsAction: grants and deductions", () => {
  it("grants credits, says old → new, and records the note with the operator", async () => {
    const state = await adjust({ amount: "500" });
    expect(state).toMatchObject({
      status: "done",
      message: `Granted 500 credits to ${STUDENT}. Balance ${TRIAL_CREDITS} → ${TRIAL_CREDITS + 500}.`,
      values: { userId: STUDENT, amount: "", note: "" },
    });
    expect(state.nonce).not.toBe(NONCE); // the next adjustment gets its own nonce
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS + 500);
    expect(adjustments()).toEqual([expect.objectContaining({ delta: 500, idempotencyKey: `${ADMIN_ADJUST_REASON}:${NONCE}` })]);
    expect(m.db.state.billingEvents).toContainEqual(
      expect.objectContaining({ kind: ADMIN_ADJUST_REASON, userId: STUDENT, credits: 500, detail: "by user_owner: goodwill, ticket 12" }),
    );
    expect(m.db.ledgerSum(STUDENT)).toBe(m.db.balance(STUDENT));
    expect(m.revalidate).toHaveBeenCalledWith("/app/admin");
  });

  it("deducts credits", async () => {
    const state = await adjust({ amount: "-120", note: "withdrawal: unused Pro credits of March" });
    expect(state.message).toBe(`Deducted 120 credits from ${STUDENT}. Balance ${TRIAL_CREDITS} → ${TRIAL_CREDITS - 120}.`);
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS - 120);
    expect(m.db.ledgerSum(STUDENT)).toBe(m.db.balance(STUDENT));
  });

  it("never takes the balance below zero: a larger deduction takes it to zero, and says so", async () => {
    const state = await adjust({ amount: `-${TRIAL_CREDITS + 700}` });
    expect(state).toMatchObject({ status: "done" });
    expect(state.message).toBe(
      `Deducted ${TRIAL_CREDITS} of the ${(TRIAL_CREDITS + 700).toLocaleString("en-US")} credits asked from ${STUDENT}: the balance was only ${TRIAL_CREDITS}, so it is now zero. Balance ${TRIAL_CREDITS} → 0.`,
    );
    expect(m.db.balance(STUDENT)).toBe(0);
    expect(adjustments()).toEqual([expect.objectContaining({ delta: -TRIAL_CREDITS })]);
    expect(m.db.state.billingEvents.find((e) => e.kind === ADMIN_ADJUST_REASON)?.credits).toBe(-TRIAL_CREDITS);
    // A deduction from an empty balance moves nothing, and says so.
    const empty = await adjust({ amount: "-50", nonce: `${NONCE}-2` });
    expect(empty.message).toMatch(/Deducted 0 of the 50 credits asked .* Balance 0 → 0\./);
    expect(m.db.balance(STUDENT)).toBe(0);
    expect(m.db.ledgerSum(STUDENT)).toBe(0);
  });
});

describe("adjustCreditsAction: a double submit applies once", () => {
  it("the same form sent twice, one after the other", async () => {
    await adjust({ amount: "500" });
    const again = await adjust({ amount: "500" });
    expect(again).toMatchObject({ status: "done", message: expect.stringMatching(/Already applied/) });
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS + 500);
    expect(adjustments()).toHaveLength(1);
    expect(m.db.state.billingEvents.filter((e) => e.kind === ADMIN_ADJUST_REASON)).toHaveLength(1);
  });

  it("the same form sent twice at once (a double click), deductions included", async () => {
    const [a, b] = await Promise.all([adjust({ amount: "-100" }), adjust({ amount: "-100" })]);
    expect([a.message, b.message].filter((msg) => /Already applied/.test(msg))).toHaveLength(1);
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS - 100);
    expect(adjustments()).toHaveLength(1);
  });

  it("a new form (a new nonce) is a new adjustment", async () => {
    await adjust({ amount: "500" });
    await adjust({ amount: "500", nonce: `${NONCE}-next` });
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS + 1000);
  });
});

describe("adjustCreditsAction: who can be adjusted", () => {
  it("refuses a user StudyOS has never seen, without creating an account or a trial", async () => {
    const state = await adjust({ userId: "user_nobody" });
    expect(state).toMatchObject({ status: "error", message: "No StudyOS account with the id user_nobody: nothing changed.", nonce: NONCE });
    expect(m.db.state.accounts.has("user_nobody")).toBe(false);
    expect(m.db.ledgerFor("user_nobody")).toEqual([]);
  });

  it("refuses a deleted account, grants and deductions alike", async () => {
    m.db.state.deleted.set(STUDENT, { userId: STUDENT, deletedAt: new Date() });
    for (const amount of ["500", "-500"]) {
      expect(await adjust({ amount })).toMatchObject({ status: "error", message: `The account ${STUDENT} was deleted: nothing changed.` });
    }
    // Also once its rows were erased.
    m.db.state.accounts.delete(STUDENT);
    expect(await adjust({})).toMatchObject({ status: "error", message: expect.stringMatching(/was deleted/) });
    expect(adjustments()).toEqual([]);
  });

  it("a database failure changes nothing, is reported, and keeps the nonce for a retry", async () => {
    const original = m.db.db.billingEvent.create;
    m.db.db.billingEvent.create = () => Promise.reject(new Error("db down"));
    try {
      expect(await adjust({})).toMatchObject({ status: "error", message: expect.stringMatching(/nothing changed/), nonce: NONCE });
    } finally {
      m.db.db.billingEvent.create = original;
    }
    expect(m.report).toHaveBeenCalledTimes(1);
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS);
    expect(adjustments()).toEqual([]);
    expect(await adjust({})).toMatchObject({ status: "done" });
    expect(m.db.balance(STUDENT)).toBe(TRIAL_CREDITS + 500);
  });
});

describe("the console around it", () => {
  it("an adjustment is never counted as AI spending (lib/ops/admin-metrics.ts)", () => {
    expect(spendAction(ADMIN_ADJUST_REASON)).toBeNull();
  });

  it("the lookup shows the balance, the plan and the latest ledger rows with the adjustment's note, and creates nothing", async () => {
    await adjust({ amount: "-20", note: "withdrawal" });
    const found = await lookupAccount(STUDENT);
    expect(found).toMatchObject({ userId: STUDENT, exists: true, deleted: false, balance: TRIAL_CREDITS - 20, pro: false, subscription: null });
    expect(found.ledger[0]).toMatchObject({ delta: -20, reason: ADMIN_ADJUST_REASON, note: "by user_owner: withdrawal" });
    expect(found.ledger.at(-1)).toMatchObject({ delta: TRIAL_CREDITS, reason: "free_signup", note: null });
    for (let i = 0; i < 12; i++) await adjust({ amount: "1", nonce: `${NONCE}-${i}` });
    expect((await lookupAccount(STUDENT)).ledger).toHaveLength(10);
    const nobody = await lookupAccount("user_nobody");
    expect(nobody).toMatchObject({ exists: false, balance: null, ledger: [] });
    expect(m.db.state.accounts.has("user_nobody")).toBe(false);
    expect(parseUserId(" user_2abc ")).toBe("user_2abc");
    expect(parseUserId(["user_a", "user_b"])).toBe("user_a");
    for (const bad of [undefined, "", "user a", "x".repeat(65), "user_1'--"]) expect(parseUserId(bad)).toBeNull();
  });
});
