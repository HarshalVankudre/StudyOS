// Billing review, round 2: every reproduced case, run through the real
// webhook, billing and credits code against the in-memory Prisma and Stripe
// fakes (no network, no database).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb, createFakeStripe } from "@/test/billing-fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  stripe: null as unknown as ReturnType<typeof createFakeStripe>,
  authUser: null as string | null,
  report: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("@/test/billing-fakes");
  h.db = createFakeDb();
  return { prisma: h.db.db };
});
vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe")>();
  const { createFakeStripe } = await import("@/test/billing-fakes");
  h.stripe = createFakeStripe();
  return { ...actual, stripe: h.stripe.stripe };
});
vi.mock("@/lib/usage-limits", () => ({ recordFunnelEvent: () => undefined }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: h.authUser })) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: h.report }));

import { POST } from "./route";
import { permutations, stripeConnectionError, stripeError, webhookRequest } from "@/test/billing-fakes";
import {
  createProCheckout,
  getUserPlan,
  reconcileUnsyncedSubscriptions,
  runBillingMaintenance,
} from "@/lib/billing";
import { getCreditBalance, PRO_MONTHLY_CREDITS } from "@/lib/credits";

const USER = "user_1";
const send = (type: string, object: unknown) => POST(webhookRequest({ type, data: { object } }));
const at = (y: number, m: number, d: number, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh, mm) / 1000;
function clockAt(sec: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(sec * 1000));
}
type CheckoutOpts = Parameters<ReturnType<typeof createFakeStripe>["completeSubscriptionCheckout"]>[1];
async function subscribe(opts: CheckoutOpts = {}, userId = USER) {
  const res = await createProCheckout({ userId, email: "a@b.c", priceId: "price_month", origin: "http://x" });
  if (!("url" in res)) throw new Error("blocked: " + JSON.stringify(res));
  return h.stripe.completeSubscriptionCheckout(res.url.split("/").pop()!, opts);
}
const row = (userId = USER) => h.db.state.subscriptions.get(userId);
const proGrants = (userId = USER) => h.db.ledgerFor(userId).filter((l) => l.reason === "pro_monthly");
async function planOf(userId = USER) {
  h.authUser = userId;
  return getUserPlan();
}

beforeEach(() => {
  h.db.reset();
  h.stripe.reset();
  h.report.mockReset();
  h.authUser = USER;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});
afterEach(() => vi.useRealTimers());

// ---- 1. Rows the previous code wrote --------------------------------------------

describe("1. a status the previous code wrote never locks a subscriber out", () => {
  it("past_due stored as 'canceled': once the card is fixed the user is Pro again and gets the month", async () => {
    clockAt(at(2026, 11, 1));
    const { subscription, session } = await subscribe({ periodStart: at(2026, 11, 1) });
    // Before the deploy: the renewal failed, the subscription went past_due,
    // and the previous code stored "canceled" (and nothing else).
    clockAt(at(2026, 12, 1, 2));
    h.stripe.failRenewal(subscription.id);
    h.db.state.subscriptions.delete(USER);
    h.db.seedLegacySubscription({
      userId: USER,
      status: "canceled",
      stripeCustomerId: session.customer,
      stripeSubscriptionId: subscription.id,
    });

    // After the deploy the customer fixes their card: Stripe pays the open invoice.
    clockAt(at(2026, 12, 3));
    const paid = h.stripe.payOpenInvoice(subscription.id);
    expect((await send("invoice.paid", paid.invoice)).status).toBe(200);
    await send("customer.subscription.updated", paid.subscription);

    expect(row()).toMatchObject({ status: "active", stripeSubscriptionId: subscription.id });
    expect(row()?.currentPeriodEnd).toBeInstanceOf(Date);
    expect(await planOf()).toBe("pro");
    expect(proGrants()).toHaveLength(1);
    // "Upgrade" says they are subscribed, and they are.
    expect(await createProCheckout({ userId: USER, email: null, priceId: "price_month", origin: "o" })).toEqual({
      blocked: "already_subscribed",
    });
  });

  it("'Upgrade' before any webhook heals the row from Stripe instead of locking the user out", async () => {
    clockAt(at(2026, 11, 1));
    const { subscription, session } = await subscribe({ periodStart: at(2026, 11, 1) });
    h.db.state.subscriptions.delete(USER);
    h.db.seedLegacySubscription({
      userId: USER,
      status: "canceled",
      stripeCustomerId: session.customer,
      stripeSubscriptionId: subscription.id,
    });
    expect(await planOf()).toBe("free");
    expect(await createProCheckout({ userId: USER, email: null, priceId: "price_month", origin: "o" })).toEqual({
      blocked: "already_subscribed",
    });
    expect(await planOf()).toBe("pro");
  });

  it("the previous code overwriting a synced row (rollout overlap, rollback) cannot lock the user out either", async () => {
    clockAt(at(2026, 11, 1));
    const { subscription, session } = await subscribe({ periodStart: at(2026, 11, 1) });
    await send("checkout.session.completed", session);
    expect(row()?.stripeSyncedAt).toBeInstanceOf(Date);
    // An old revision still serving writes "canceled" for a past_due event,
    // touching only the columns it knows.
    row()!.status = "canceled";
    clockAt(at(2026, 11, 2));
    await send("customer.subscription.updated", subscription);
    expect(row()?.status).toBe("active");
  });

  it("a subscription this code saw ended still never comes back from a stale read", async () => {
    clockAt(at(2026, 11, 1));
    const { subscription, session } = await subscribe({ periodStart: at(2026, 11, 1) });
    await send("checkout.session.completed", session);
    const staleActive = await h.stripe.stripe.subscriptions.retrieve(subscription.id);
    h.stripe.setSubscriptionStatus(subscription.id, "canceled");
    await send("customer.subscription.deleted", subscription);
    expect(row()?.endedSubscriptionId).toBe(subscription.id);
    const { applyLiveSubscription } = await import("@/lib/billing");
    // Stamped later than the cancellation (clock skew): still stale.
    expect(await applyLiveSubscription(USER, staleActive as never, new Date(Date.now() + 60_000))).toBe("stale");
    expect(row()?.status).toBe("canceled");
  });
});

describe("1. the one-off repair of rows the previous code wrote", () => {
  /** A Stripe subscription in its Nov 14 – Dec 14 2026 period (status as given). */
  function stripeSub(id: string, customer: string, status = "active") {
    h.stripe.addSubscription({
      id,
      customer,
      metadata: {},
      items: {
        data: [{
          id: `si_${id}`,
          price: { id: "price_month", recurring: { interval: "month", interval_count: 1 } },
          current_period_start: at(2026, 11, 14),
          current_period_end: at(2026, 12, 14),
        }],
      },
    });
    h.stripe.setSubscriptionStatus(id, status);
  }

  function seedProduction() {
    clockAt(at(2026, 11, 14));
    // Missed cancellation: "active" here, canceled on Stripe.
    stripeSub("sub_gone", "cus_gone", "canceled");
    h.db.seedLegacySubscription({ userId: "u_gone", status: "active", stripeCustomerId: "cus_gone", stripeSubscriptionId: "sub_gone" });
    // past_due stored as "canceled"; paid since.
    stripeSub("sub_back", "cus_back", "active");
    h.db.seedLegacySubscription({ userId: "u_back", status: "canceled", stripeCustomerId: "cus_back", stripeSubscriptionId: "sub_back" });
    // past_due stored as "canceled"; still past_due.
    stripeSub("sub_due", "cus_due", "past_due");
    h.db.seedLegacySubscription({ userId: "u_due", status: "canceled", stripeCustomerId: "cus_due", stripeSubscriptionId: "sub_due" });
    // A subscription Stripe no longer has.
    h.db.seedLegacySubscription({ userId: "u_missing", status: "active", stripeCustomerId: "cus_missing", stripeSubscriptionId: "sub_missing" });
    // No subscription id stored, a live one on the customer.
    stripeSub("sub_cust", "cus_cust", "active");
    h.db.seedLegacySubscription({ userId: "u_cust", status: "active", stripeCustomerId: "cus_cust" });
    // Nothing on Stripe at all.
    h.db.seedLegacySubscription({ userId: "u_none", status: "active" });
    // Nothing to repair: a customer row of someone who never subscribed.
    h.db.seedLegacySubscription({ userId: "u_free", status: "free", stripeCustomerId: "cus_free" });
    // Already correct and active.
    stripeSub("sub_ok", "cus_ok", "active");
    h.db.seedLegacySubscription({ userId: "u_ok", status: "active", stripeCustomerId: "cus_ok", stripeSubscriptionId: "sub_ok" });
  }

  it("re-reads every unsynced row from Stripe in small, resumable batches and reports what it changed", async () => {
    seedProduction();
    const changes: { userId: string; from: string; to: string }[] = [];
    let runs = 0;
    let remaining = Infinity;
    while (remaining > 0 && runs < 10) {
      const report = await reconcileUnsyncedSubscriptions({ limit: 2 });
      expect(report.checked).toBeLessThanOrEqual(2);
      expect(report.failed).toBe(0);
      changes.push(...report.changed);
      remaining = report.remaining;
      runs++;
    }
    expect(remaining).toBe(0);
    expect(runs).toBe(4); // 7 rows to repair, 2 at a time

    const status = (u: string) => row(u)?.status;
    expect(status("u_gone")).toBe("canceled");
    expect(status("u_back")).toBe("active");
    expect(status("u_due")).toBe("past_due");
    expect(status("u_missing")).toBe("canceled");
    expect(row("u_cust")).toMatchObject({ status: "active", stripeSubscriptionId: "sub_cust" });
    expect(status("u_none")).toBe("free");
    expect(status("u_ok")).toBe("active");
    expect(row("u_free")).toMatchObject({ status: "free", stripeSyncedAt: null }); // untouched
    // Live ones now have a period end, so Pro expires if renewals stop.
    for (const u of ["u_back", "u_cust", "u_ok"]) expect(row(u)?.currentPeriodEnd).toBeInstanceOf(Date);
    expect(await planOf("u_back")).toBe("pro");
    expect(await planOf("u_gone")).toBe("free");

    const byUser = Object.fromEntries(changes.map((c) => [c.userId, `${c.from}->${c.to}`]));
    expect(byUser).toEqual({
      u_gone: "active->canceled",
      u_back: "canceled->active",
      u_due: "canceled->past_due",
      u_missing: "active->canceled",
      u_none: "active->free",
    });
    expect(h.db.state.billingEvents.filter((e) => e.kind === "legacy_resync").map((e) => e.userId).sort()).toEqual(
      Object.keys(byUser).sort(),
    );
    // It only reads: no cancellation, no refund, no credits.
    expect(h.stripe.state.calls.filter((c) => /cancel|refunds\.create/.test(c))).toEqual([]);
    expect(h.db.state.ledger).toHaveLength(0);

    // Idempotent: another run has nothing to do.
    const again = await reconcileUnsyncedSubscriptions({ limit: 50 });
    expect(again).toEqual({ checked: 0, changed: [], failed: 0, remaining: 0 });
  });

  it("runs from the maintenance job, and a row that keeps failing never blocks the others", async () => {
    clockAt(at(2026, 11, 14));
    stripeSub("sub_a", "cus_a", "active");
    stripeSub("sub_b", "cus_b", "active");
    h.db.seedLegacySubscription({ userId: "u_a", status: "canceled", stripeCustomerId: "cus_a", stripeSubscriptionId: "sub_a" });
    h.db.seedLegacySubscription({ userId: "u_b", status: "canceled", stripeCustomerId: "cus_b", stripeSubscriptionId: "sub_b" });
    h.stripe.failNext("subscriptions.retrieve", { times: 1 }); // u_a's read fails
    const first = await runBillingMaintenance(new Date(), 1);
    expect(first.unsynced).toMatchObject({ checked: 2, failed: 1, remaining: 1 });
    expect(row("u_b")?.status).toBe("active");
    expect(h.report).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ route: "reconcileUnsyncedSubscriptions", userId: "u_a" }));
    clockAt(at(2026, 11, 15));
    const second = await runBillingMaintenance(new Date(), 1);
    expect(second.unsynced).toMatchObject({ checked: 1, failed: 0, remaining: 0 });
    expect(row("u_a")?.status).toBe("active");
  });

  it("rows the previous code writes while the migration is already applied are picked up too", async () => {
    clockAt(at(2026, 11, 14));
    await reconcileUnsyncedSubscriptions(); // the first run, nothing yet
    // The old revision is still serving: it creates a row (no new columns).
    stripeSub("sub_late", "cus_late", "past_due");
    h.db.seedLegacySubscription({ userId: "u_late", status: "canceled", stripeCustomerId: "cus_late", stripeSubscriptionId: "sub_late" });
    const report = await reconcileUnsyncedSubscriptions();
    expect(report.changed).toEqual([{ userId: "u_late", subscriptionId: "sub_late", from: "canceled", to: "past_due" }]);
  });
});

// ---- 2. Subscription refunds and disputes in any order -------------------------

describe("2. a subscription payment's refunds and disputes: the outcome is the same in every order", () => {
  type Outcome = { grants: number; plan: string; stripeStatus: string; balance: number };

  /**
   * A yearly subscription paid on Jan 10, with Stripe-side events already
   * final (`prepare`), delivered in `order`, one day apart; then read on
   * Jul 11, when six anniversaries of the paid year have passed.
   */
  async function run(
    order: string[],
    prepare: (a: Awaited<ReturnType<typeof subscribe>>) => Record<string, [string, unknown]>,
  ): Promise<Outcome> {
    h.db.reset();
    h.stripe.reset();
    clockAt(at(2026, 1, 10));
    const a = await subscribe({ periodStart: at(2026, 1, 10), periodEnd: at(2027, 1, 10), interval: "year" });
    const deliveries: Record<string, [string, unknown]> = {
      checkout: ["checkout.session.completed", a.session],
      invoice: ["invoice.paid", a.invoice],
      ...prepare(a),
    };
    let t = at(2026, 1, 16);
    for (const step of order) {
      clockAt((t += 86_400));
      const [type, object] = deliveries[step];
      expect((await send(type, object)).status).toBe(200);
    }
    clockAt(at(2026, 7, 11));
    const balance = await getCreditBalance(USER);
    return {
      grants: proGrants().length,
      plan: await planOf(),
      stripeStatus: h.stripe.state.subscriptions.get(a.subscription.id)!.status,
      balance,
    };
  }

  async function everyOrder(steps: string[], prepare: Parameters<typeof run>[1]) {
    const outcomes = new Map<string, string[]>();
    for (const order of permutations(steps)) {
      const key = JSON.stringify(await run(order, prepare));
      outcomes.set(key, [...(outcomes.get(key) ?? []), order.join(">")]);
    }
    expect([...outcomes.keys()]).toHaveLength(1);
    return JSON.parse([...outcomes.keys()][0]) as Outcome;
  }

  const disputed = (status: string) => (a: Awaited<ReturnType<typeof subscribe>>) => {
    const d = h.stripe.dispute(a.chargeId!, { created: at(2026, 1, 15) });
    return {
      dispute: ["charge.dispute.created", d] as [string, unknown],
      closed: ["charge.dispute.closed", { ...d, status }] as [string, unknown],
    };
  };

  it("a dispute that is won: the paid month and the whole year's months, Pro, in all 24 orders", async () => {
    const outcome = await everyOrder(["checkout", "invoice", "dispute", "closed"], disputed("won"));
    // Jan (the invoice) + Feb..Jul anniversaries.
    expect(outcome).toMatchObject({ grants: 7, plan: "pro", stripeStatus: "active" });
  });

  it("a dispute that is lost: the paid month stays, nothing more, the subscription is canceled, in all 24 orders", async () => {
    const outcome = await everyOrder(["checkout", "invoice", "dispute", "closed"], disputed("lost"));
    expect(outcome).toMatchObject({ grants: 1, plan: "free", stripeStatus: "canceled" });
  });

  it("a refund in full: the paid month stays, no further months, in all 6 orders", async () => {
    const outcome = await everyOrder(["checkout", "invoice", "refund"], (a) => {
      clockAt(at(2026, 1, 15));
      return { refund: ["charge.refunded", h.stripe.refundCharge(a.chargeId!)] };
    });
    expect(outcome).toMatchObject({ grants: 1, plan: "pro", stripeStatus: "active" });
  });

  it("a refund that was pending and then failed changes nothing, in all 24 orders", async () => {
    const outcome = await everyOrder(["checkout", "invoice", "refund", "failed"], (a) => {
      clockAt(at(2026, 1, 15));
      const charge = h.stripe.refundCharge(a.chargeId!, undefined, { status: "pending" });
      const failed = h.stripe.failRefund(h.stripe.latestRefund(a.chargeId!)!.id);
      return {
        refund: ["charge.refunded", charge],
        failed: ["charge.refund.updated", failed],
      };
    });
    expect(outcome).toMatchObject({ grants: 7, plan: "pro", stripeStatus: "active" });
  });

  it("the review's case: a dispute processed before invoice.paid, then won, loses nothing", async () => {
    clockAt(at(2026, 1, 10));
    const a = await subscribe({ periodStart: at(2026, 1, 10), periodEnd: at(2027, 1, 10), interval: "year" });
    await send("checkout.session.completed", a.session);
    const d = h.stripe.dispute(a.chargeId!, { status: "warning_needs_response" });
    await send("charge.dispute.created", d);
    await send("invoice.paid", a.invoice);
    // Paused while it is open, whichever arrived first.
    expect(await planOf()).toBe("free");
    expect(row()?.allowanceStopAt).toBeNull(); // no permanent stop for something that can be won
    await send("charge.dispute.closed", { ...d, status: "won" });
    expect(await planOf()).toBe("pro");
    clockAt(at(2026, 7, 11));
    await getCreditBalance(USER);
    expect(proGrants()).toHaveLength(7);
  });

  it("a pending refund that fails later lifts the stop it caused", async () => {
    clockAt(at(2026, 1, 10));
    const a = await subscribe({ periodStart: at(2026, 1, 10), periodEnd: at(2027, 1, 10), interval: "year" });
    await send("checkout.session.completed", a.session);
    await send("invoice.paid", a.invoice);
    clockAt(at(2026, 1, 15));
    await send("charge.refunded", h.stripe.refundCharge(a.chargeId!, undefined, { status: "pending" }));
    expect(row()?.allowanceStopAt?.getTime()).toBe(at(2026, 1, 15) * 1000);
    clockAt(at(2026, 3, 1));
    await getCreditBalance(USER);
    expect(proGrants()).toHaveLength(1);
    // The bank returned the refund: the customer paid after all.
    await send("charge.refund.updated", h.stripe.failRefund(h.stripe.latestRefund(a.chargeId!)!.id));
    expect(row()?.allowanceStopAt).toBeNull();
    await getCreditBalance(USER);
    expect(proGrants()).toHaveLength(2); // + February (March's anniversary is on the 10th)
  });
});

describe("2. credit packs keep the same property with the new refund facts", () => {
  async function packRun(order: string[], prepare: (chargeId: string) => Record<string, [string, unknown]>) {
    h.db.reset();
    h.stripe.reset();
    await getCreditBalance(USER); // 300 signup
    const { createCreditPackCheckout } = await import("@/lib/billing");
    const { url } = await createCreditPackCheckout({ userId: USER, email: "a@b.c", origin: "http://x" });
    const p = h.stripe.completePackCheckout(url.split("/").pop()!);
    const deliveries = { grant: ["checkout.session.completed", p.session] as [string, unknown], ...prepare(p.chargeId) };
    for (const step of order) {
      const [type, object] = deliveries[step as keyof typeof deliveries];
      expect((await send(type, object)).status).toBe(200);
    }
    expect(h.db.ledgerSum(USER)).toBe(h.db.balance(USER));
    return h.db.balance(USER);
  }
  async function everyOrder(steps: string[], prepare: Parameters<typeof packRun>[1]) {
    const balances = new Set<number>();
    for (const order of permutations(steps)) balances.add(await packRun(order, prepare));
    expect([...balances]).toHaveLength(1);
    return [...balances][0];
  }
  const refundAndDispute = (status: string) => (chargeId: string) => {
    const charge = h.stripe.refundCharge(chargeId, 500);
    const d = h.stripe.dispute(chargeId, { amount: 500 });
    return {
      refund: ["charge.refunded", charge] as [string, unknown],
      dispute: ["charge.dispute.created", d] as [string, unknown],
      closed: ["charge.dispute.closed", { ...d, status }] as [string, unknown],
    };
  };

  it("50% refunded, 50% disputed and won: half the pack, in all 24 orders", async () => {
    expect(await everyOrder(["grant", "refund", "dispute", "closed"], refundAndDispute("won"))).toBe(300 + 500);
  });

  it("50% refunded, 50% disputed and lost: none of it, in all 24 orders", async () => {
    expect(await everyOrder(["grant", "refund", "dispute", "closed"], refundAndDispute("lost"))).toBe(300);
  });

  it("a refund that failed takes nothing, in all 6 orders", async () => {
    const balance = await everyOrder(["grant", "refund", "failed"], (chargeId) => {
      const charge = h.stripe.refundCharge(chargeId, undefined, { status: "pending" });
      const failed = h.stripe.failRefund(h.stripe.latestRefund(chargeId)!.id);
      return { refund: ["charge.refunded", charge], failed: ["charge.refund.updated", failed] };
    });
    expect(balance).toBe(300 + 1000);
  });

  it("a refund that fails after it was applied gives back exactly what it took", async () => {
    const { createCreditPackCheckout } = await import("@/lib/billing");
    await getCreditBalance(USER);
    const { url } = await createCreditPackCheckout({ userId: USER, email: null, origin: "o" });
    const p = h.stripe.completePackCheckout(url.split("/").pop()!);
    await send("checkout.session.completed", p.session);
    h.db.state.accounts.get(USER)!.balance = 400; // most of it spent
    await send("charge.refunded", h.stripe.refundCharge(p.chargeId, undefined, { status: "pending" }));
    expect(h.db.balance(USER)).toBe(0); // took 400, forgave the rest
    await send("charge.refund.updated", h.stripe.failRefund(h.stripe.latestRefund(p.chargeId)!.id));
    expect(h.db.balance(USER)).toBe(400);
  });
});

// ---- 4. A lost chargeback stops billing --------------------------------------

describe("4. a lost dispute cancels the subscription whichever payment it was on", () => {
  it("even after a renewal has moved the subscription on to a new payment", async () => {
    clockAt(at(2026, 2, 5));
    const a = await subscribe({ periodStart: at(2026, 2, 5) });
    await send("checkout.session.completed", a.session);
    await send("invoice.paid", a.invoice);
    const d = h.stripe.dispute(a.chargeId!);
    await send("charge.dispute.created", d);
    expect(await planOf()).toBe("free");
    clockAt(at(2026, 3, 5, 2));
    const r = h.stripe.renewSubscription(a.subscription.id);
    await send("invoice.paid", r.invoice);
    expect(await planOf()).toBe("pro"); // March is paid for
    await send("charge.dispute.closed", { ...d, status: "lost" });
    expect(h.stripe.state.subscriptions.get(a.subscription.id)?.status).toBe("canceled");
    expect(h.db.state.intents).toContainEqual(
      expect.objectContaining({ kind: "cancel_lost_dispute", key: d.id, state: "done" }),
    );
    // Pro ends at once, not only when the deletion webhook arrives.
    expect(await planOf()).toBe("free");
  });

  it("a cancel that fails is retried by Stripe's retry or, at the latest, by the maintenance job", async () => {
    clockAt(at(2026, 2, 5));
    const a = await subscribe({ periodStart: at(2026, 2, 5) });
    await send("checkout.session.completed", a.session);
    await send("invoice.paid", a.invoice);
    const d = h.stripe.dispute(a.chargeId!);
    h.stripe.failNext("subscriptions.cancel");
    expect((await send("charge.dispute.closed", { ...d, status: "lost" })).status).toBe(500);
    expect(h.stripe.state.subscriptions.get(a.subscription.id)?.status).toBe("active");
    expect(await runBillingMaintenance()).toMatchObject({ jobsCompleted: 1 });
    expect(h.stripe.state.subscriptions.get(a.subscription.id)?.status).toBe("canceled");
  });

  it("a dispute of an old month that is won does not cancel anything", async () => {
    clockAt(at(2026, 2, 5));
    const a = await subscribe({ periodStart: at(2026, 2, 5) });
    await send("checkout.session.completed", a.session);
    await send("invoice.paid", a.invoice);
    const d = h.stripe.dispute(a.chargeId!);
    await send("charge.dispute.closed", { ...d, status: "won" });
    expect(h.stripe.state.subscriptions.get(a.subscription.id)?.status).toBe("active");
    expect(await planOf()).toBe("pro");
  });
});

// ---- 6. One grant per paid subscription per month ------------------------------

describe("6. a second full payment in the same month", () => {
  async function cancel(sub: Record<string, unknown>) {
    h.stripe.setSubscriptionStatus(String(sub.id), "canceled");
    await send("customer.subscription.deleted", sub);
  }

  it("subscribe on the 2nd, cancel on the 10th, subscribe again on the 20th: both paid months grant", async () => {
    clockAt(at(2026, 3, 2));
    const a = await subscribe({ periodStart: at(2026, 3, 2) });
    await send("checkout.session.completed", a.session);
    await send("invoice.paid", a.invoice);
    clockAt(at(2026, 3, 10));
    await cancel(a.subscription);
    clockAt(at(2026, 3, 20));
    const b = await subscribe({ periodStart: at(2026, 3, 20) });
    await send("checkout.session.completed", b.session);
    await send("invoice.paid", b.invoice);
    await send("invoice.paid", b.invoice); // retry
    expect(proGrants()).toHaveLength(2);
    expect(await planOf()).toBe("pro");
  });

  it("after a refund in full, a resubscription in the same month does not get that month again", async () => {
    clockAt(at(2026, 3, 2));
    const a = await subscribe({ periodStart: at(2026, 3, 2) });
    await send("checkout.session.completed", a.session);
    await send("invoice.paid", a.invoice);
    clockAt(at(2026, 3, 10));
    await send("charge.refunded", h.stripe.refundCharge(a.chargeId!));
    await cancel(a.subscription);
    clockAt(at(2026, 3, 20));
    const b = await subscribe({ periodStart: at(2026, 3, 20) });
    await send("checkout.session.completed", b.session);
    await send("invoice.paid", b.invoice);
    expect(proGrants()).toHaveLength(1); // March, once: its credits stayed
    clockAt(at(2026, 4, 20, 2));
    await send("invoice.paid", h.stripe.renewSubscription(b.subscription.id).invoice);
    expect(proGrants()).toHaveLength(2); // + April
  });

  it("plan switches within one subscription still never grant a month twice", async () => {
    clockAt(at(2026, 5, 2));
    const a = await subscribe({ periodStart: at(2026, 5, 2) });
    await send("checkout.session.completed", a.session);
    await send("invoice.paid", a.invoice);
    for (let i = 0; i < 6; i++) {
      const t = at(2026, 5, 3 + i);
      clockAt(t);
      const sw = h.stripe.switchPrice(a.subscription.id, { interval: i % 2 ? "month" : "year", at: t, unusedCredit: i % 2 ? 7900 : 780 });
      await send("customer.subscription.updated", sw.subscription);
      await send("invoice.paid", sw.invoice);
      await getCreditBalance(USER);
    }
    expect(proGrants()).toHaveLength(1);
  });
});

// ---- 9. Grants written before coverage months ------------------------------------

describe("9. an existing subscriber granted under the per-invoice key", () => {
  it("switching plan in the same month does not grant that month again", async () => {
    clockAt(at(2026, 11, 3));
    const a = await subscribe({ periodStart: at(2026, 11, 3) });
    await send("checkout.session.completed", a.session);
    // Before the deploy: the invoice was granted under pro_grant:<invoice>.
    h.db.seedLegacyProGrant(USER, a.invoice.id, new Date(at(2026, 11, 3, 0, 5) * 1000));
    clockAt(at(2026, 11, 20));
    const sw = h.stripe.switchPrice(a.subscription.id, { interval: "year", at: at(2026, 11, 20), unusedCredit: 300 });
    await send("customer.subscription.updated", sw.subscription);
    await send("invoice.paid", sw.invoice);
    expect(proGrants().map((l) => l.idempotencyKey)).toEqual([`pro_grant:${a.invoice.id}`]);
    // December comes with the annual's first anniversary.
    clockAt(at(2026, 12, 20, 1));
    await getCreditBalance(USER);
    expect(proGrants()).toHaveLength(2);
  });

  it("an old grant written just after midnight for the previous month does not swallow this month", async () => {
    clockAt(at(2026, 1, 31, 23, 30));
    const a = await subscribe({ periodStart: at(2026, 1, 31, 23, 30) });
    await send("checkout.session.completed", a.session);
    // January's invoice, granted by the previous code at 00:30 on Feb 1.
    h.db.seedLegacyProGrant(USER, a.invoice.id, new Date(at(2026, 2, 1, 0, 30) * 1000));
    clockAt(at(2026, 2, 28, 23, 45));
    const r = h.stripe.renewSubscription(a.subscription.id);
    await send("invoice.paid", r.invoice);
    expect(proGrants()).toHaveLength(2); // January (old key) + February
  });
});

// ---- 11. Cancel-and-refund of a subscription that must not exist ---------------

describe("11. a mistaken second subscription", () => {
  async function twoSubscriptions() {
    const a = await createProCheckout({ userId: USER, email: null, priceId: "p", origin: "o" });
    const b = await createProCheckout({ userId: USER, email: null, priceId: "p", origin: "o" });
    if (!("url" in a) || !("url" in b)) throw new Error("blocked");
    const aId = a.url.split("/").pop()!;
    h.stripe.state.sessions.get(aId)!.status = "open";
    const first = h.stripe.completeSubscriptionCheckout(aId);
    const second = h.stripe.completeSubscriptionCheckout(b.url.split("/").pop()!);
    await send("checkout.session.completed", first.session);
    await send("invoice.paid", first.invoice);
    return { first, second };
  }

  it("is refunded every paid invoice, not just the latest", async () => {
    const { second } = await twoSubscriptions();
    const renewal = h.stripe.renewSubscription(second.subscription.id); // it renewed before we noticed
    await send("checkout.session.completed", second.session);
    expect(h.stripe.state.subscriptions.get(second.subscription.id)?.status).toBe("canceled");
    expect(h.stripe.state.refunds.map((r) => r.payment_intent).sort()).toEqual(
      [second.paymentIntent, renewal.paymentIntent].sort(),
    );
    expect(h.db.state.billingEvents.find((e) => e.kind === "duplicate_subscription")).toMatchObject({
      amountCents: 1600,
    });
  });

  it("a refund Stripe refuses is reported for the owner, not silently marked finished", async () => {
    const { second } = await twoSubscriptions();
    h.stripe.failNext("refunds.create", { error: () => stripeError("StripeInvalidRequestError", "charge_disputed") });
    expect((await send("checkout.session.completed", second.session)).status).toBe(200);
    expect(h.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: "charge_disputed" }),
      expect.objectContaining({ route: expect.stringContaining("refundRemaining") }),
    );
    expect(h.db.state.billingEvents.find((e) => e.kind === "duplicate_subscription")?.detail).toMatch(/refused: charge_disputed/);
  });

  it("a cancel that fails with an invalid-request error (not 'missing') is not taken as done", async () => {
    const { second } = await twoSubscriptions();
    h.stripe.failNext("subscriptions.cancel", { error: () => stripeError("StripeInvalidRequestError", "parameter_invalid") });
    expect((await send("checkout.session.completed", second.session)).status).toBe(500);
    expect(h.stripe.state.subscriptions.get(second.subscription.id)?.status).toBe("active");
    expect(h.db.state.intents.find((i) => i.key === second.subscription.id)).toMatchObject({ state: "pending" });
    expect(h.stripe.state.refunds).toHaveLength(0);
    // Stripe's retry finishes it.
    expect((await send("checkout.session.completed", second.session)).status).toBe(200);
    expect(h.stripe.state.subscriptions.get(second.subscription.id)?.status).toBe("canceled");
    expect(h.stripe.state.refunds).toHaveLength(1);
  });

  it("a job marked done whose subscription Stripe still shows live runs again", async () => {
    const { second } = await twoSubscriptions();
    await send("checkout.session.completed", second.session);
    // As if an earlier version had taken a failed cancel for "already gone".
    h.stripe.state.subscriptions.get(second.subscription.id)!.status = "active";
    expect(h.db.state.intents.find((i) => i.key === second.subscription.id)).toMatchObject({ state: "done" });
    await send("customer.subscription.updated", second.subscription);
    expect(h.stripe.state.subscriptions.get(second.subscription.id)?.status).toBe("canceled");
    expect(h.stripe.state.refunds).toHaveLength(1); // never refunded twice
    expect(h.db.state.intents.find((i) => i.key === second.subscription.id)).toMatchObject({ state: "done" });
  });
});

describe("11. a deleted account's subscription", () => {
  it("only payments taken after the deletion are refunded (the month paid before it was used)", async () => {
    const { markAccountDeleted, stopBillingForDeletedAccount } = await import("@/lib/billing");
    clockAt(at(2026, 6, 1));
    const a = await subscribe({ periodStart: at(2026, 6, 1) });
    await send("checkout.session.completed", a.session);
    await send("invoice.paid", a.invoice);
    clockAt(at(2026, 6, 15));
    await markAccountDeleted(USER);
    h.stripe.failNext("subscriptions.list"); // Stripe down: the cancel stays queued
    expect(await stopBillingForDeletedAccount(USER)).toBe(false);
    clockAt(at(2026, 7, 1, 2));
    const renewal = h.stripe.renewSubscription(a.subscription.id); // charged meanwhile
    await send("invoice.paid", renewal.invoice);
    expect(h.stripe.state.subscriptions.get(a.subscription.id)?.status).toBe("canceled");
    expect(h.stripe.state.refunds.map((r) => r.payment_intent)).toEqual([renewal.paymentIntent]);
  });
});

// ---- 5 and 12. The maintenance re-read --------------------------------------------

describe("5 and 12. the maintenance re-read of active rows", () => {
  it("re-reads an active row with no period end", async () => {
    clockAt(at(2026, 6, 1));
    const a = await subscribe({ periodStart: at(2026, 6, 1) });
    await send("checkout.session.completed", a.session);
    row()!.currentPeriodEnd = null;
    h.stripe.setSubscriptionStatus(a.subscription.id, "canceled"); // the webhook was lost
    expect(await runBillingMaintenance()).toMatchObject({ subscriptionsResynced: 1 });
    expect(row()?.status).toBe("canceled");
  });

  it("treats a subscription Stripe no longer has as ended", async () => {
    clockAt(at(2026, 6, 1));
    const a = await subscribe({ periodStart: at(2026, 6, 1) });
    await send("checkout.session.completed", a.session);
    h.stripe.state.subscriptions.delete(a.subscription.id);
    clockAt(at(2026, 7, 10));
    expect(await runBillingMaintenance()).toMatchObject({ subscriptionsResynced: 1 });
    expect(row()).toMatchObject({ status: "canceled", endedSubscriptionId: a.subscription.id });
    expect(await planOf()).toBe("free");
  });

  it("takes the least recently checked first, so a row that keeps failing does not block the rest", async () => {
    clockAt(at(2026, 6, 1));
    const a = await subscribe({ periodStart: at(2026, 6, 1) }, "u_a");
    await send("checkout.session.completed", a.session);
    const b = await subscribe({ periodStart: at(2026, 6, 1) }, "u_b");
    await send("checkout.session.completed", b.session);
    clockAt(at(2026, 7, 10));
    h.stripe.renewSubscription(a.subscription.id);
    h.stripe.renewSubscription(b.subscription.id); // both renewal webhooks lost
    // Every read of u_a's subscription fails (Stripe hangs and times out).
    const retrieve = h.stripe.stripe.subscriptions.retrieve;
    vi.spyOn(h.stripe.stripe.subscriptions, "retrieve").mockImplementation((async (id: string) => {
      if (id === a.subscription.id) throw stripeConnectionError();
      return retrieve(id);
    }) as never);
    await runBillingMaintenance(new Date(), 1); // u_a first: fails
    expect(row("u_b")?.currentPeriodEnd?.getTime()).toBe(at(2026, 7, 1) * 1000);
    await runBillingMaintenance(new Date(), 1); // u_b is next in line, not u_a again
    expect(row("u_b")?.currentPeriodEnd?.getTime()).toBe(at(2026, 8, 1) * 1000);
  });

  it("stops starting work once its time budget is spent", async () => {
    clockAt(at(2026, 6, 1));
    h.db.seedLegacySubscription({ userId: "u_x", status: "active", stripeSubscriptionId: "sub_x" });
    const result = await runBillingMaintenance(new Date(), 50, -1);
    expect(result.stoppedEarly).toBe(true);
    expect(result.unsynced.checked).toBe(0);
    expect(h.stripe.state.calls).toEqual([]);
  });
});

// ---- The fakes' failed renewal ------------------------------------------------------

describe("a renewal that fails and goes past_due with the period already advanced", () => {
  it("is not Pro and grants nothing; paid later, it is Pro with that month", async () => {
    clockAt(at(2026, 4, 1));
    const a = await subscribe({ periodStart: at(2026, 4, 1) });
    await send("checkout.session.completed", a.session);
    await send("invoice.paid", a.invoice);
    clockAt(at(2026, 5, 1, 2));
    const failed = h.stripe.failRenewal(a.subscription.id);
    await send("customer.subscription.updated", failed.subscription);
    expect(row()?.status).toBe("past_due");
    expect(row()?.currentPeriodEnd?.getTime()).toBe(at(2026, 6, 1) * 1000);
    expect(await planOf()).toBe("free");
    expect(proGrants()).toHaveLength(1);
    clockAt(at(2026, 5, 4));
    const paid = h.stripe.payOpenInvoice(a.subscription.id);
    await send("invoice.paid", paid.invoice);
    expect(await planOf()).toBe("pro");
    expect(proGrants()).toHaveLength(2);
    expect(h.db.balance(USER)).toBe(300 + 2 * PRO_MONTHLY_CREDITS);
  });
});
