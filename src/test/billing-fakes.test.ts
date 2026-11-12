// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakeDb, createFakeStripe, stripeAddMonths } from "./billing-fakes";

const utc = (y: number, m: number, d: number, hh = 0) => Date.UTC(y, m - 1, d, hh) / 1000;
const iso = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

describe("fake Prisma transactions behave like Postgres", () => {
  it("a rollback undoes only its own writes, not other in-flight ones", async () => {
    const { db, state } = createFakeDb();
    await db.creditAccount.create({ data: { userId: "u", balance: 10 } });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const failing = db
      .$transaction(async (tx: typeof db) => {
        await tx.creditLedger.create({ data: { userId: "u", delta: 5, reason: "a" } });
        await gate;
        throw new Error("boom");
      })
      .catch(() => "rolled back");
    // Another write commits while the first transaction is still open.
    await db.creditLedger.create({ data: { userId: "u", delta: 7, reason: "b" } });
    release();
    expect(await failing).toBe("rolled back");
    expect(state.ledger.map((l) => l.reason)).toEqual(["b"]);
  });

  it("uncommitted writes are invisible to others (no dirty reads)", async () => {
    const { db } = createFakeDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tx = db.$transaction(async (t: typeof db) => {
      await t.deletedAccount.create({ data: { userId: "u" } });
      await gate;
    });
    await Promise.resolve();
    expect(await db.deletedAccount.findUnique({ where: { userId: "u" } })).toBeNull();
    release();
    await tx;
    expect(await db.deletedAccount.findUnique({ where: { userId: "u" } })).not.toBeNull();
  });

  it("row locks serialize read-decide-write transactions", async () => {
    const { db, balance } = createFakeDb();
    await db.creditAccount.create({ data: { userId: "u", balance: 1 } });
    const takeOne = () =>
      db.$transaction(async (tx: typeof db) => {
        const rows = await tx.$queryRaw`SELECT "balance" FROM "CreditAccount" WHERE "userId" = ${"u"} FOR UPDATE`;
        if (rows[0].balance < 1) return false;
        await tx.creditAccount.update({ where: { userId: "u" }, data: { balance: { decrement: 1 } } });
        return true;
      });
    const results = await Promise.all(Array.from({ length: 10 }, takeOne));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(balance("u")).toBe(0);
  });
});

describe("fake Stripe", () => {
  it("can fail any call, including part-way through a flow", async () => {
    const f = createFakeStripe();
    f.failNext("refunds.create");
    await expect(f.stripe.refunds.create({ payment_intent: "pi_x" })).rejects.toMatchObject({
      type: "StripeConnectionError",
    });
    // The next call goes through to the real behaviour.
    await expect(f.stripe.refunds.create({ payment_intent: "pi_x" })).rejects.toMatchObject({
      code: "resource_missing",
    });
  });

  it("refuses to refund money that was already refunded", async () => {
    const f = createFakeStripe();
    const { url } = await f.stripe.checkout.sessions.create({
      mode: "payment",
      customer: "cus_1",
      line_items: [{ price_data: { unit_amount: 1000 } }],
    });
    const { paymentIntent } = f.completePackCheckout(url.split("/").pop()!);
    await f.stripe.refunds.create({ payment_intent: paymentIntent, amount: 400 });
    expect((await f.stripe.refunds.create({ payment_intent: paymentIntent })).amount).toBe(600);
    await expect(f.stripe.refunds.create({ payment_intent: paymentIntent })).rejects.toMatchObject({
      code: "charge_already_refunded",
    });
  });

  it("keeps the anchor day like Stripe (Jan 31 → Feb 28 → Mar 31), never start + 30 days", async () => {
    expect(iso(stripeAddMonths(utc(2026, 1, 31), 1))).toBe("2026-02-28");
    expect(iso(stripeAddMonths(utc(2026, 1, 31), 2))).toBe("2026-03-31");
    expect(iso(stripeAddMonths(utc(2028, 2, 29), 12))).toBe("2029-02-28");

    const f = createFakeStripe();
    const { url } = await f.stripe.checkout.sessions.create({ mode: "subscription", customer: "cus_1" });
    const { subscription } = f.completeSubscriptionCheckout(url.split("/").pop()!, {
      periodStart: utc(2026, 1, 31, 12),
      interval: "month",
    });
    const ends = [subscription.items.data[0].current_period_end];
    for (let i = 0; i < 3; i++) {
      ends.push(f.renewSubscription(subscription.id).subscription.items.data[0].current_period_end);
    }
    expect(ends.map(iso)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("invoices carry what was really paid: total, amount_paid and balance used", async () => {
    const f = createFakeStripe();
    const { url } = await f.stripe.checkout.sessions.create({ mode: "subscription", customer: "cus_1" });
    const { subscription } = f.completeSubscriptionCheckout(url.split("/").pop()!, {
      periodStart: utc(2026, 1, 1),
      interval: "month",
    });
    const { invoice } = f.switchPrice(subscription.id, { interval: "month", at: utc(2026, 1, 10), unusedCredit: 900 });
    expect(invoice).toMatchObject({ total: -100, amount_paid: 0 });
    const { invoice: renewal } = f.renewSubscription(subscription.id, { balanceApplied: 800 });
    expect(renewal).toMatchObject({ total: 800, amount_paid: 0, starting_balance: -800 });
  });
});
