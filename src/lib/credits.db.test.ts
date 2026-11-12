// @vitest-environment node
/**
 * Integration tests against a real Postgres: row locks, advisory locks and
 * conditional updates under real concurrency, which an in-memory fake can
 * only approximate.
 *
 * Opt-in, because CI has no database:
 *   STUDYOS_DB_TESTS=1 with DATABASE_URL pointing at a THROWAWAY database
 *   (e.g. the local one on :54329), then
 *   npx pnpm@10 exec vitest run src/lib/credits.db.test.ts
 * It only touches rows of its own random test users and removes them after.
 * Stripe is the in-memory fake (no network).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import type { createFakeStripe } from "@/test/billing-fakes";

const enabled = process.env.STUDYOS_DB_TESTS === "1";

const h = vi.hoisted(() => ({
  stripe: null as unknown as ReturnType<typeof createFakeStripe>,
}));
vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe")>();
  const { createFakeStripe } = await import("@/test/billing-fakes");
  h.stripe = createFakeStripe();
  return { ...actual, stripe: h.stripe.stripe };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: () => undefined }));
vi.mock("@/lib/usage-limits", () => ({ recordFunnelEvent: () => undefined }));

describe.skipIf(!enabled)("credits on Postgres", () => {
  const run = `dbtest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const users: string[] = [];
  const user = (tag: string) => {
    const id = `${run}_${tag}`;
    users.push(id);
    return id;
  };
  const userId = user("main");

  const db = async () => (await import("@/lib/db")).prisma;
  async function balanceAndLedger(id: string) {
    const prisma = await db();
    const account = await prisma.creditAccount.findUnique({ where: { userId: id } });
    const ledger = await prisma.creditLedger.aggregate({ _sum: { delta: true }, where: { userId: id } });
    return { balance: account?.balance ?? null, ledger: ledger._sum.delta ?? 0 };
  }

  afterAll(async () => {
    const prisma = await db();
    const where = { userId: { in: users } };
    await prisma.creditLedger.deleteMany({ where });
    await prisma.creditHold.deleteMany({ where });
    await prisma.creditAccount.deleteMany({ where });
    await prisma.subscription.deleteMany({ where });
    await prisma.billingEvent.deleteMany({ where });
    await prisma.billingIntent.deleteMany({
      where: { OR: [{ userId: { in: users } }, { key: { in: users } }] },
    });
    await prisma.deletedAccount.deleteMany({ where });
    await prisma.$disconnect();
  });

  it("40 concurrent charges never drive the balance negative or over-charge", async () => {
    const { chargeCredits, getCreditBalance, TRIAL_CREDITS } = await import("./credits");
    expect(await getCreditBalance(userId)).toBe(TRIAL_CREDITS);

    const charged = await Promise.all(
      Array.from({ length: 40 }, () => chargeCredits(userId, 13, "agent")),
    );

    const total = charged.reduce((a, b) => a + b, 0);
    expect(total).toBe(TRIAL_CREDITS); // 40 × 13 = 520 asked, 300 available
    expect(await balanceAndLedger(userId)).toEqual({ balance: 0, ledger: 0 });
  }, 60_000);

  it("a new account gets exactly one trial grant, even when first seen concurrently", async () => {
    const prisma = await db();
    const { getCreditBalance, reserveCredits, TRIAL_CREDITS } = await import("./credits");
    const id = user("trial");
    const reads = await Promise.all([
      ...Array.from({ length: 12 }, () => getCreditBalance(id)),
      reserveCredits(id, { estimate: 1, reason: "agent" }).then(() => 0),
    ]);
    expect(reads.filter((b) => b !== 0).every((b) => b === TRIAL_CREDITS || b === TRIAL_CREDITS - 1)).toBe(true);
    expect(await prisma.creditLedger.count({ where: { userId: id, reason: "free_signup" } })).toBe(1);
    expect(await prisma.creditAccount.count({ where: { userId: id } })).toBe(1);
  }, 60_000);

  it("a depleted free account is never topped up, whatever month it is and whatever it got before", async () => {
    const prisma = await db();
    const { chargeCredits, getCreditBalance, grantCredits, TRIAL_CREDITS } = await import("./credits");
    const id = user("notopup");
    await getCreditBalance(id);
    // A top-up the previous code wrote, in an earlier month.
    await grantCredits(id, 150, "free_monthly", `free_monthly:${id}:2026-10`);
    await chargeCredits(id, TRIAL_CREDITS + 150 - 4, "agent");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const at of ["2026-12-01T00:00:05Z", "2027-01-01T00:00:00Z", "2027-07-31T23:59:00Z"]) {
        vi.setSystemTime(new Date(at));
        expect(await getCreditBalance(id)).toBe(4);
      }
    } finally {
      vi.useRealTimers();
    }
    expect(await prisma.creditLedger.count({ where: { userId: id, reason: "free_monthly" } })).toBe(1);
    expect(await balanceAndLedger(id)).toEqual({ balance: 4, ledger: 4 });
  }, 60_000);

  it("a build hold reserves the list price and settles to it, or goes back in full", async () => {
    const { getCreditBalance, releaseCreditHold, reserveCredits, settleCreditHold } = await import("./credits");
    const { buildQuote, chargeForCompleted } = await import("./price-list");
    const id = user("listprice");
    const quote = buildQuote("claude-haiku-5-5");
    const start = await getCreditBalance(id);
    const settled = await reserveCredits(id, { estimate: quote.max, min: quote.price, reason: "generate" });
    expect(settled?.amount).toBe(30);
    expect(await settleCreditHold(settled!, chargeForCompleted(quote, 2))).toBe(30);
    expect(await releaseCreditHold(settled!)).toBe(false);
    const failed = await reserveCredits(id, { estimate: quote.max, min: quote.price, reason: "generate" });
    expect(await releaseCreditHold(failed!)).toBe(true);
    expect(await balanceAndLedger(id)).toEqual({ balance: start - 30, ledger: start - 30 });
  }, 60_000);

  it("a keyed clawback applied concurrently happens once", async () => {
    const prisma = await db();
    const { debitCredits, grantCredits } = await import("./credits");
    await grantCredits(userId, 500, "test");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        debitCredits(userId, 200, "credit_reversal", `dbtest_clawback:${userId}`),
      ),
    );
    expect(results.filter((r) => r > 0)).toEqual([200]);
    const account = await prisma.creditAccount.findUnique({ where: { userId } });
    expect(account?.balance).toBe(300);
  }, 60_000);

  // ---- Finding 10: hold and settle -------------------------------------------

  it("20 parallel reservations at a balance of 1: exactly one gets to run", async () => {
    const { chargeCredits, getCreditBalance, reserveCredits, settleCreditHold } = await import("./credits");
    const u = user("hold");
    await getCreditBalance(u);
    await chargeCredits(u, 299, "test");
    const holds = await Promise.all(
      Array.from({ length: 20 }, () => reserveCredits(u, { estimate: 40, reason: "generate" })),
    );
    const got = holds.filter((x) => x !== null);
    expect(got).toHaveLength(1);
    expect(got[0]?.amount).toBe(1);
    expect(await balanceAndLedger(u)).toEqual({ balance: 0, ledger: 0 });
    // The work cost 30: the hold covers 1, nothing more is left to take.
    expect(await settleCreditHold(got[0]!, 30)).toBe(1);
    expect(await balanceAndLedger(u)).toEqual({ balance: 0, ledger: 0 });
  }, 60_000);

  it("settling and releasing one hold at the same time charges exactly once", async () => {
    const { getCreditBalance, releaseCreditHold, reserveCredits, settleCreditHold } = await import("./credits");
    const u = user("settle");
    await getCreditBalance(u); // 300
    const hold = await reserveCredits(u, { estimate: 100, reason: "generate" });
    await Promise.all([
      settleCreditHold(hold!, 40),
      settleCreditHold(hold!, 40),
      releaseCreditHold(hold!),
      releaseCreditHold(hold!),
    ]);
    // Whichever wins, 40 is charged once: settle first (300 - 100 + 60), or
    // release first and then the late settle charges 40 from the balance.
    expect(await balanceAndLedger(u)).toEqual({ balance: 260, ledger: 260 });
  }, 60_000);

  // ---- Finding 5: concurrent webhook handlers ----------------------------------

  it("40 racing writes of one subscription: the later-fetched state wins, and canceled never goes back", async () => {
    const prisma = await db();
    const { applyLiveSubscription } = await import("./billing");
    const u = user("sync");
    const now = Math.floor(Date.now() / 1000);
    const base = {
      id: `sub_${u}`,
      object: "subscription",
      customer: `cus_${u}`,
      metadata: { userId: u },
      latest_invoice: null,
      items: { data: [{ current_period_end: now + 30 * 86400 }] },
    };
    const active = { ...base, status: "active", ended_at: null, canceled_at: null };
    const canceled = { ...base, status: "canceled", ended_at: now, canceled_at: now };
    const t0 = Date.now();
    await applyLiveSubscription(u, active as never, new Date(t0 - 60_000));

    // Handlers that read "active" before the cancellation, and handlers that
    // read "canceled" after it, all writing at once in random order.
    const writes: [typeof active | typeof canceled, Date][] = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0 ? [active, new Date(t0 + i)] : [canceled, new Date(t0 + 1_000 + i)],
    );
    writes.sort(() => Math.random() - 0.5);
    await Promise.all(writes.map(([sub, at]) => applyLiveSubscription(u, sub as never, at)));

    let row = await prisma.subscription.findUnique({ where: { userId: u } });
    expect(row?.status).toBe("canceled");
    expect(row?.stripeSyncedAt?.getTime()).toBe(t0 + 1_000 + 39);

    // A stale live snapshot, even stamped later (clock skew), never revives it.
    await applyLiveSubscription(u, active as never, new Date(t0 + 60_000));
    row = await prisma.subscription.findUnique({ where: { userId: u } });
    expect(row?.status).toBe("canceled");
  }, 60_000);

  it("two new subscriptions applied at once: exactly one is kept, the other canceled", async () => {
    const prisma = await db();
    const { applyLiveSubscription } = await import("./billing");
    const u = user("dup");
    await prisma.subscription.create({ data: { userId: u, stripeCustomerId: `cus_${u}` } });
    const a = h.stripe.addSubscription({ id: `sub_a_${u}`, customer: `cus_${u}`, metadata: { userId: u } });
    const b = h.stripe.addSubscription({ id: `sub_b_${u}`, customer: `cus_${u}`, metadata: { userId: u } });

    const outcomes = await Promise.all([
      applyLiveSubscription(u, a as never),
      applyLiveSubscription(u, b as never),
    ]);
    expect([...outcomes].sort()).toEqual(["duplicate", "ok"]);
    const row = await prisma.subscription.findUnique({ where: { userId: u } });
    const kept = row!.stripeSubscriptionId!;
    const other = kept === a.id ? b.id : a.id;
    expect(h.stripe.state.subscriptions.get(kept)?.status).toBe("active");
    expect(h.stripe.state.subscriptions.get(other)?.status).toBe("canceled");
  }, 60_000);

  // ---- Finding 7: the tombstone and the credits layer ------------------------------

  it("a grant racing the tombstone lands entirely before it or not at all", async () => {
    const prisma = await db();
    const { getCreditBalance, grantCredits } = await import("./credits");
    const { markAccountDeleted } = await import("./billing");
    for (let i = 0; i < 8; i++) {
      const u = user(`tomb${i}`);
      const [granted] = await Promise.all([
        grantCredits(u, 1000, "credit_purchase", `credit_purchase:${u}`),
        markAccountDeleted(u),
      ]);
      const rows = await prisma.creditLedger.findMany({ where: { userId: u, reason: "credit_purchase" } });
      expect(rows).toHaveLength(granted === "granted" ? 1 : 0);
      if (granted !== "granted") {
        expect(granted).toBe("deleted_account");
        expect(await prisma.creditAccount.findUnique({ where: { userId: u } })).toBeNull();
      }
      // From now on nothing can be granted, and no account is recreated.
      expect(await grantCredits(u, 5, "test")).toBe("deleted_account");
      if (granted !== "granted") expect(await getCreditBalance(u)).toBe(0);
    }
  }, 60_000);

  // ---- Billing review, round 2 ------------------------------------------------------

  it("a row the previous code wrote ('canceled' for a past_due subscription) takes the live state again", async () => {
    const prisma = await db();
    const { applyLiveSubscription } = await import("./billing");
    const u = user("legacy");
    const sub = h.stripe.addSubscription({ id: `sub_${u}`, customer: `cus_${u}`, metadata: { userId: u } });
    await prisma.subscription.create({
      data: { userId: u, stripeCustomerId: `cus_${u}`, stripeSubscriptionId: sub.id, status: "canceled" },
    });
    expect(await applyLiveSubscription(u, sub as never)).toBe("ok");
    expect((await prisma.subscription.findUnique({ where: { userId: u } }))?.status).toBe("active");
  }, 60_000);

  it("the one-off repair re-reads unsynced rows on Postgres (least recently checked first) and is idempotent", async () => {
    const prisma = await db();
    const { reconcileUnsyncedSubscriptions } = await import("./billing");
    const back = user("rec_back");
    const gone = user("rec_gone");
    const fresh = user("rec_fresh");
    h.stripe.addSubscription({ id: `sub_${back}`, customer: `cus_${back}` });
    h.stripe.addSubscription({ id: `sub_${gone}`, customer: `cus_${gone}` });
    h.stripe.setSubscriptionStatus(`sub_${gone}`, "canceled");
    await prisma.subscription.createMany({
      data: [
        { userId: back, stripeCustomerId: `cus_${back}`, stripeSubscriptionId: `sub_${back}`, status: "canceled" },
        { userId: gone, stripeCustomerId: `cus_${gone}`, stripeSubscriptionId: `sub_${gone}`, status: "active" },
        // Synced by the new code already: not part of the repair.
        { userId: fresh, stripeCustomerId: `cus_${fresh}`, stripeSubscriptionId: `sub_${fresh}`, status: "active", stripeSyncedAt: new Date() },
      ],
    });
    const only = [back, gone, fresh];
    const first = await reconcileUnsyncedSubscriptions({ userIds: only, limit: 1 });
    expect(first).toMatchObject({ checked: 1, remaining: 1 });
    const second = await reconcileUnsyncedSubscriptions({ userIds: only, limit: 1 });
    expect(second).toMatchObject({ checked: 1, remaining: 0 });
    const changed = [...first.changed, ...second.changed].map((c) => `${c.userId}:${c.from}->${c.to}`).sort();
    expect(changed).toEqual([`${back}:canceled->active`, `${gone}:active->canceled`].sort());
    expect(await reconcileUnsyncedSubscriptions({ userIds: only })).toEqual({ checked: 0, changed: [], failed: 0, remaining: 0 });
    const events = await prisma.billingEvent.findMany({ where: { kind: "legacy_resync", userId: { in: only } } });
    expect(events).toHaveLength(2);
  }, 60_000);

  it("10 parallel agent turns at a balance of 30 hold at most 30 between them", async () => {
    const { chargeCredits, getCreditBalance, reserveCredits } = await import("./credits");
    const u = user("ceiling");
    await getCreditBalance(u);
    await chargeCredits(u, 270, "test");
    const holds = await Promise.all(
      Array.from({ length: 10 }, () => reserveCredits(u, { estimate: 30, min: 2, reason: "agent" })),
    );
    expect(holds.reduce((sum, x) => sum + (x?.amount ?? 0), 0)).toBe(30);
    expect(await balanceAndLedger(u)).toEqual({ balance: 0, ledger: 0 });
  }, 60_000);

  it("a hold whose settle recorded its charge is completed, never released, even when they race", async () => {
    const prisma = await db();
    const { getCreditBalance, releaseCreditHold, releaseExpiredHolds, reserveCredits } = await import("./credits");
    const u = user("pending");
    await getCreditBalance(u); // 300
    const hold = await reserveCredits(u, { estimate: 100, reason: "generate", ttlMs: 1 });
    // What settleCreditHold writes before its transaction (which then failed).
    await prisma.creditHold.update({ where: { id: hold!.id }, data: { pendingCharge: 40 } });
    await new Promise((r) => setTimeout(r, 5));
    await Promise.all([releaseCreditHold(hold!), releaseCreditHold(hold!), releaseExpiredHolds({ userId: u })]);
    expect(await prisma.creditHold.findUnique({ where: { id: hold!.id } })).toMatchObject({ state: "settled", charged: 40 });
    expect(await balanceAndLedger(u)).toEqual({ balance: 260, ledger: 260 });
  }, 60_000);

  it("a subscription dispute processed before its invoice pauses Pro by payment; winning it restores everything", async () => {
    const prisma = await db();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const { webhookRequest } = await import("@/test/billing-fakes");
    const { createProCheckout } = await import("./billing");
    const { subscriptionGrantsPro } = await import("./credits");
    const send = (type: string, object: unknown) => POST(webhookRequest({ type, data: { object } }));
    const u = user("dispute");
    const res = await createProCheckout({ userId: u, email: null, priceId: "price_year", origin: "o" });
    if (!("url" in res)) throw new Error("blocked");
    const now = Math.floor(Date.now() / 1000);
    const a = h.stripe.completeSubscriptionCheckout(res.url.split("/").pop()!, {
      periodStart: now - 86_400,
      periodEnd: now + 364 * 86_400,
      interval: "year",
    });
    const d = h.stripe.dispute(a.chargeId!, { created: now - 3600 });
    expect((await send("charge.dispute.created", d)).status).toBe(200);
    expect((await send("invoice.paid", a.invoice)).status).toBe(200);
    let row = await prisma.subscription.findUnique({ where: { userId: u } });
    expect(row).toMatchObject({ disputeId: d.id, allowanceStopAt: null });
    expect(subscriptionGrantsPro(row)).toBe(false);
    expect((await send("charge.dispute.closed", { ...d, status: "won" })).status).toBe(200);
    row = await prisma.subscription.findUnique({ where: { userId: u } });
    expect(row).toMatchObject({ disputeId: null, disputedAt: null, allowanceStopAt: null });
    expect(subscriptionGrantsPro(row)).toBe(true);
    const grants = await prisma.creditLedger.count({ where: { userId: u, reason: "pro_monthly" } });
    expect(grants).toBe(1);
    expect(await balanceAndLedger(u)).toEqual({ balance: 1300, ledger: 1300 });
  }, 60_000);
});
