import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb, createFakeStripe } from "@/test/billing-fakes";

// In-memory Prisma + Stripe: every scenario runs the real webhook, billing and
// credits code end to end, with no network and no database.
const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  stripe: null as unknown as ReturnType<typeof createFakeStripe>,
  funnel: vi.fn(),
  authUser: null as string | null,
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
vi.mock("@/lib/usage-limits", () => ({ recordFunnelEvent: h.funnel }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: h.authUser })) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));

import { POST } from "./route";
import { webhookRequest } from "@/test/billing-fakes";
import {
  createCreditPackCheckout,
  createProCheckout,
  getUserPlan,
  markAccountDeleted,
  reconcileCheckoutSession,
  runBillingMaintenance,
} from "@/lib/billing";
import { FREE_SIGNUP_CREDITS, getCreditBalance, PRO_MONTHLY_CREDITS } from "@/lib/credits";

const USER = "user_1";
const DAY = 86400;

async function send(type: string, object: unknown) {
  return POST(webhookRequest({ type, data: { object } }));
}

/** Start a Pro checkout and complete it on "Stripe". */
async function subscribe(opts: Parameters<ReturnType<typeof createFakeStripe>["completeSubscriptionCheckout"]>[1] = {}) {
  const res = await createProCheckout({ userId: USER, email: "a@b.c", priceId: "price_month", origin: "http://x" });
  if (!("url" in res)) throw new Error("blocked");
  const id = res.url.split("/").pop()!;
  return h.stripe.completeSubscriptionCheckout(id, opts);
}

async function buyPack(paid = true) {
  const { url } = await createCreditPackCheckout({ userId: USER, email: "a@b.c", origin: "http://x" });
  return h.stripe.completePackCheckout(url.split("/").pop()!, { paid });
}

const row = () => h.db.state.subscriptions.get(USER);
const proGrants = () => h.db.ledgerFor(USER).filter((l) => l.reason === "pro_monthly");

beforeEach(() => {
  h.db.reset();
  h.stripe.reset();
  h.funnel.mockReset();
  h.authUser = null;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Seconds since the epoch of a UTC date. */
const at = (y: number, m: number, d: number, hh = 0) => Date.UTC(y, m - 1, d, hh) / 1000;
/** Move the (Date-only) fake clock. */
function clockAt(sec: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(sec * 1000));
}

describe("signature + failures", () => {
  it("rejects an invalid signature", async () => {
    const res = await POST(webhookRequest({ type: "invoice.paid", data: { object: {} } }, "forged"));
    expect(res.status).toBe(400);
  });

  it("answers 500 (so Stripe retries) when a handler throws", async () => {
    // invoice.paid for a subscription Stripe cannot find: retrieve throws.
    const res = await send("invoice.paid", {
      id: "in_x",
      parent: { subscription_details: { subscription: "sub_missing", metadata: { userId: USER } } },
    });
    expect(res.status).toBe(500);
  });

  it("ignores invoices unrelated to subscriptions", async () => {
    const res = await send("invoice.paid", { id: "in_solo", parent: null });
    expect(res.status).toBe(200);
    expect(h.db.state.ledger).toHaveLength(0);
  });
});

describe("subscription status", () => {
  it("checkout completion sets Pro from the live subscription and does not grant", async () => {
    const { session, subscription } = await subscribe();
    expect((await send("checkout.session.completed", session)).status).toBe(200);
    expect(row()).toMatchObject({ status: "active", stripeSubscriptionId: subscription.id });
    expect(proGrants()).toHaveLength(0);
    expect(h.funnel).toHaveBeenCalledWith(USER, "purchase_pro");
  });

  it("does not resurrect Pro from an out-of-order 'active' update after deletion", async () => {
    const { session, subscription } = await subscribe();
    await send("checkout.session.completed", session);
    h.stripe.setSubscriptionStatus(subscription.id, "canceled");
    await send("customer.subscription.deleted", { ...subscription, status: "canceled" });
    expect(row()?.status).toBe("canceled");
    // A stale "updated: active" payload arrives late.
    await send("customer.subscription.updated", { ...subscription, status: "active" });
    expect(row()?.status).toBe("canceled");
  });

  it("keeps the past_due status (not Pro) instead of pretending canceled", async () => {
    const { session, subscription } = await subscribe();
    await send("checkout.session.completed", session);
    h.stripe.setSubscriptionStatus(subscription.id, "past_due");
    await send("customer.subscription.updated", subscription);
    expect(row()?.status).toBe("past_due");
  });
});

describe("invoice.paid credit grants", () => {
  it("grants one month on a paid invoice, once under retries", async () => {
    const { session, invoice } = await subscribe();
    await send("checkout.session.completed", session);
    await send("invoice.paid", invoice);
    await send("invoice.paid", invoice); // Stripe retry
    expect(proGrants()).toHaveLength(1);
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS + PRO_MONTHLY_CREDITS);
  });

  it("handles the invoice arriving before the subscription row exists", async () => {
    const { invoice, subscription } = await subscribe();
    h.db.state.subscriptions.delete(USER); // no row at all yet
    expect((await send("invoice.paid", invoice)).status).toBe(200);
    expect(row()).toMatchObject({ status: "active", stripeSubscriptionId: subscription.id });
    expect(proGrants()).toHaveLength(1);
  });

  it("does not grant for a $0 invoice (100% coupon)", async () => {
    const { session, subscription } = await subscribe();
    await send("checkout.session.completed", session);
    const inv = h.stripe.subscriptionInvoice(subscription.id, { start: 1, end: 2, amount: 800, discount: 800 });
    await send("invoice.paid", inv);
    expect(proGrants()).toHaveLength(0);
    expect(row()?.status).toBe("active");
  });

  it("does not grant for a proration-only invoice", async () => {
    const { session, subscription } = await subscribe();
    await send("checkout.session.completed", session);
    const inv = h.stripe.subscriptionInvoice(subscription.id, {
      start: 1, end: 2, amount: 300, proration: true, billingReason: "subscription_update",
    });
    await send("invoice.paid", inv);
    expect(proGrants()).toHaveLength(0);
  });

  it("fetches line items when the payload omits them", async () => {
    const { session, invoice } = await subscribe();
    await send("checkout.session.completed", session);
    await send("invoice.paid", { ...invoice, lines: { data: [], has_more: true } });
    expect(proGrants()).toHaveLength(1);
  });

  it("does not flip a canceled user back to active when a late invoice lands", async () => {
    const { session, subscription, invoice } = await subscribe();
    await send("checkout.session.completed", session);
    h.stripe.setSubscriptionStatus(subscription.id, "canceled");
    await send("customer.subscription.deleted", subscription);
    await send("invoice.paid", invoice); // money did arrive for that period
    expect(row()?.status).toBe("canceled");
    expect(proGrants()).toHaveLength(1);
  });

  it("accepts the legacy pre-Basil invoice shape", async () => {
    const { session, subscription, invoice } = await subscribe();
    await send("checkout.session.completed", session);
    const legacyLine = { amount: 800, type: "subscription", proration: false, period: invoice.lines.data[0].period };
    await send("invoice.paid", {
      id: "in_legacy",
      parent: null,
      total: 800,
      amount_paid: 800,
      subscription: subscription.id,
      subscription_details: { metadata: { userId: USER } },
      lines: { data: [legacyLine], has_more: false },
    });
    expect(proGrants()).toHaveLength(1);
  });

  it("records the annual period so monthly allowances can accrue", async () => {
    const start = 1_767_225_600; // 2026-01-01T00:00:00Z
    const end = start + 365 * DAY;
    const { session, invoice } = await subscribe({ periodStart: start, periodEnd: end, amount: 8000 });
    await send("checkout.session.completed", session);
    await send("invoice.paid", invoice);
    expect(proGrants()).toHaveLength(1);
    expect(row()?.allowancePeriodStart?.getTime()).toBe(start * 1000);
    expect(row()?.allowancePeriodEnd?.getTime()).toBe(end * 1000);
  });

  it("monthly → annual switch: the month already granted is not granted again; the period moves", async () => {
    const start = 1_767_225_600;
    clockAt(start + 3600);
    const { session, subscription, invoice } = await subscribe({ periodStart: start, periodEnd: start + 31 * DAY });
    await send("checkout.session.completed", session);
    await send("invoice.paid", invoice);
    const switchAt = start + 10 * DAY;
    clockAt(switchAt + 60);
    const { invoice: inv } = h.stripe.switchPrice(subscription.id, { interval: "year", at: switchAt, unusedCredit: 540 });
    await send("invoice.paid", inv);
    // January was already paid for and granted by the monthly invoice.
    expect(proGrants()).toHaveLength(1);
    expect(row()?.allowancePeriodStart?.getTime()).toBe(switchAt * 1000);
    expect(row()?.allowanceYearly).toBe(true);
    // February's allowance arrives on the annual's first anniversary.
    clockAt(switchAt + 31 * DAY);
    await getCreditBalance(USER);
    expect(proGrants()).toHaveLength(2);
  });

  it("never rewinds the allowance period for a late, older invoice", async () => {
    const start = 1_767_225_600;
    const { session, subscription, invoice } = await subscribe({ periodStart: start, periodEnd: start + 31 * DAY });
    await send("checkout.session.completed", session);
    const renewal = h.stripe.subscriptionInvoice(subscription.id, { start: start + 31 * DAY, end: start + 59 * DAY });
    await send("invoice.paid", renewal);
    await send("invoice.paid", invoice); // first invoice delivered last
    expect(proGrants()).toHaveLength(2);
    expect(row()?.allowancePeriodStart?.getTime()).toBe((start + 31 * DAY) * 1000);
  });
});

describe("duplicate subscriptions", () => {
  it("cancels and refunds a second live subscription and grants it nothing", async () => {
    // Two tabs opened checkout before either finished.
    const a = await createProCheckout({ userId: USER, email: null, priceId: "p", origin: "o" });
    const b = await createProCheckout({ userId: USER, email: null, priceId: "p", origin: "o" });
    if (!("url" in a) || !("url" in b)) throw new Error("blocked");
    // The older tab's session was expired when the newer one opened...
    const aId = a.url.split("/").pop()!;
    expect(h.stripe.state.sessions.get(aId)?.status).toBe("expired");
    // ...but suppose both still completed (e.g. a race Stripe let through).
    h.stripe.state.sessions.get(aId)!.status = "open";
    const first = h.stripe.completeSubscriptionCheckout(aId);
    const second = h.stripe.completeSubscriptionCheckout(b.url.split("/").pop()!);

    await send("checkout.session.completed", first.session);
    await send("invoice.paid", first.invoice);
    await send("checkout.session.completed", second.session);
    await send("invoice.paid", second.invoice);
    await send("invoice.paid", second.invoice); // retry

    expect(row()).toMatchObject({ status: "active", stripeSubscriptionId: first.subscription.id });
    expect(h.stripe.state.subscriptions.get(second.subscription.id)?.status).toBe("canceled");
    expect(h.stripe.state.refunds).toEqual([
      expect.objectContaining({ payment_intent: second.paymentIntent, reason: "duplicate" }),
    ]);
    expect(proGrants()).toHaveLength(1);
    expect(h.db.state.billingEvents).toEqual([
      expect.objectContaining({ kind: "duplicate_subscription", stripeObjectId: second.subscription.id }),
    ]);
  });
});

describe("credit packs", () => {
  it("grants a paid pack once, even when retried", async () => {
    const { session } = await buyPack();
    await send("checkout.session.completed", session);
    await send("checkout.session.completed", session);
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS + 1000);
    expect(h.funnel).toHaveBeenCalledWith(USER, "purchase_credits");
  });

  it("waits for delayed payment methods before granting", async () => {
    const { session } = await buyPack(false);
    await send("checkout.session.completed", session);
    expect(h.db.ledgerFor(USER).filter((l) => l.reason === "credit_purchase")).toHaveLength(0);
    const paid = h.stripe.markPackPaid(session.id);
    await send("checkout.session.async_payment_succeeded", paid);
    await send("checkout.session.async_payment_succeeded", paid);
    expect(h.db.ledgerFor(USER).filter((l) => l.reason === "credit_purchase")).toHaveLength(1);
  });
});

describe("refunds and disputes", () => {
  it("claws back a fully refunded pack, never below zero", async () => {
    const { session, chargeId, paymentIntent, amount } = await buyPack();
    await send("checkout.session.completed", session);
    // The user spends most of it first.
    h.db.state.accounts.get(USER)!.balance = 250;
    const charge = { id: chargeId, payment_intent: paymentIntent, amount, amount_refunded: amount, customer: session.customer };
    await send("charge.refunded", charge);
    await send("charge.refunded", charge); // retry
    expect(h.db.balance(USER)).toBe(0);
    expect(h.db.state.billingEvents).toEqual([
      expect.objectContaining({ kind: "refund", userId: USER, paymentIntentId: paymentIntent, credits: -250 }),
    ]);
  });

  it("claws back partial refunds proportionally and cumulatively", async () => {
    const { session, chargeId, paymentIntent, amount } = await buyPack();
    await send("checkout.session.completed", session);
    const base = { id: chargeId, payment_intent: paymentIntent, amount, customer: session.customer };
    await send("charge.refunded", { ...base, amount_refunded: amount / 2 });
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS + 500);
    await send("charge.refunded", { ...base, amount_refunded: amount });
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS);
  });

  it("a pack refunded in full before the grant landed adds nothing", async () => {
    const { session, chargeId, paymentIntent, amount } = await buyPack();
    await send("charge.refunded", { id: chargeId, payment_intent: paymentIntent, amount, amount_refunded: amount, customer: session.customer });
    await send("checkout.session.completed", session); // delayed delivery
    await send("checkout.session.completed", session); // retry
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS);
    expect(h.db.ledgerSum(USER)).toBe(h.db.balance(USER));
  });

  it("claws back on dispute and restores when the dispute is won", async () => {
    const { session, chargeId, paymentIntent, amount } = await buyPack();
    await send("checkout.session.completed", session);
    const dispute = { id: "dp_1", charge: chargeId, payment_intent: paymentIntent, amount, reason: "fraudulent", status: "needs_response" };
    await send("charge.dispute.created", dispute);
    await send("charge.dispute.created", dispute);
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS);
    await send("charge.dispute.closed", { ...dispute, status: "won" });
    await send("charge.dispute.closed", { ...dispute, status: "won" });
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS + 1000);
  });

  it("only records subscription refunds (no clawback of monthly credits)", async () => {
    const { session, invoice, paymentIntent } = await subscribe();
    await send("checkout.session.completed", session);
    await send("invoice.paid", invoice);
    const before = h.db.balance(USER);
    await send("charge.refunded", { id: "ch_s", payment_intent: paymentIntent, amount: 800, amount_refunded: 800, customer: session.customer });
    expect(h.db.balance(USER)).toBe(before);
    expect(h.db.state.billingEvents).toEqual([
      expect.objectContaining({ kind: "refund", userId: USER, detail: "subscription_or_other" }),
    ]);
  });
});

describe("after account deletion", () => {
  it("late events never recreate the row or grant credits", async () => {
    const { session, subscription, invoice } = await subscribe();
    await send("checkout.session.completed", session);
    // Account deleted: subscription canceled, rows erased, tombstone written.
    h.stripe.setSubscriptionStatus(subscription.id, "canceled");
    h.db.reset();
    await markAccountDeleted(USER);

    await send("customer.subscription.deleted", subscription);
    await send("invoice.paid", invoice);
    await send("checkout.session.completed", session);
    expect(row()).toBeUndefined();
    expect(h.db.state.accounts.has(USER)).toBe(false);
    expect(h.db.state.ledger).toHaveLength(0);
  });

  it("cancels and refunds a subscription completed after deletion", async () => {
    const res = await createProCheckout({ userId: USER, email: null, priceId: "p", origin: "o" });
    if (!("url" in res)) throw new Error("blocked");
    await markAccountDeleted(USER);
    const { session, subscription, paymentIntent } = h.stripe.completeSubscriptionCheckout(res.url.split("/").pop()!);
    await send("checkout.session.completed", session);
    expect(h.stripe.state.subscriptions.get(subscription.id)?.status).toBe("canceled");
    expect(h.stripe.state.refunds).toEqual([expect.objectContaining({ payment_intent: paymentIntent })]);
  });

  it("refunds a credit pack paid after deletion", async () => {
    const { session, paymentIntent } = await buyPack();
    await markAccountDeleted(USER);
    h.db.state.accounts.delete(USER);
    await send("checkout.session.completed", session);
    expect(h.db.state.accounts.has(USER)).toBe(false);
    expect(h.stripe.state.refunds).toEqual([expect.objectContaining({ payment_intent: paymentIntent })]);
  });
});

// ---- Review findings (wave 1 billing) ---------------------------------------

/** Two subscriptions for one user (a race Stripe let through): A tracked, B arriving. */
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

describe("finding 1: a duplicate is refunded even when Stripe fails after the cancel", () => {
  it.each(["invoicePayments.list", "refunds.create"])(
    "%s fails once: Stripe's retry (subscription already canceled) still refunds and records it",
    async (path) => {
      const { first, second } = await twoSubscriptions();
      h.stripe.failNext(path);
      expect((await send("checkout.session.completed", second.session)).status).toBe(500);
      expect(h.stripe.state.subscriptions.get(second.subscription.id)?.status).toBe("canceled");

      expect((await send("checkout.session.completed", second.session)).status).toBe(200);
      expect(h.stripe.state.refunds).toEqual([
        expect.objectContaining({ payment_intent: second.paymentIntent, reason: "duplicate" }),
      ]);
      expect(h.db.state.billingEvents.filter((e) => e.kind === "duplicate_subscription")).toHaveLength(1);
      // Its invoice never grants, before or after the refund.
      await send("invoice.paid", second.invoice);
      expect(proGrants()).toHaveLength(1);
      expect(row()).toMatchObject({ status: "active", stripeSubscriptionId: first.subscription.id });
    },
  );

  it("an invoice.paid for the duplicate that lands while its refund is pending grants nothing and finishes the refund", async () => {
    const { second } = await twoSubscriptions();
    h.stripe.failNext("refunds.create");
    expect((await send("checkout.session.completed", second.session)).status).toBe(500);
    expect((await send("invoice.paid", second.invoice)).status).toBe(200);
    expect(proGrants()).toHaveLength(1);
    expect(h.stripe.state.refunds).toHaveLength(1);
  });

  it("an invoice.paid running between the cancel and the audit record grants nothing", async () => {
    const { second } = await twoSubscriptions();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const list = h.stripe.stripe.invoicePayments.list;
    vi.spyOn(h.stripe.stripe.invoicePayments, "list").mockImplementationOnce(async (...args: unknown[]) => {
      await gate;
      return (list as (...a: unknown[]) => Promise<unknown>)(...args) as never;
    });
    const firstHandler = send("checkout.session.completed", second.session);
    await vi.waitFor(() =>
      expect(h.stripe.state.subscriptions.get(second.subscription.id)?.status).toBe("canceled"),
    );
    await send("invoice.paid", second.invoice);
    release();
    expect((await firstHandler).status).toBe(200);
    expect(proGrants()).toHaveLength(1);
    expect(h.stripe.state.refunds).toHaveLength(1);
  });

  it("a subscription paid after deletion is refunded on retry, or by the maintenance job", async () => {
    const res = await createProCheckout({ userId: USER, email: null, priceId: "p", origin: "o" });
    if (!("url" in res)) throw new Error("blocked");
    await markAccountDeleted(USER);
    const { session, paymentIntent } = h.stripe.completeSubscriptionCheckout(res.url.split("/").pop()!);
    h.stripe.failNext("refunds.create");
    expect((await send("checkout.session.completed", session)).status).toBe(500);
    // Stripe gives up retrying; the daily job finishes the job.
    await runBillingMaintenance();
    expect(h.stripe.state.refunds).toEqual([expect.objectContaining({ payment_intent: paymentIntent })]);
    expect(h.db.state.billingEvents.filter((e) => e.kind === "deleted_account_subscription")).toHaveLength(1);
    expect(h.db.state.intents.every((i) => i.state === "done")).toBe(true);
  });
});

describe("finding 2: refunded annual, then a new subscription", () => {
  it("a refunded annual invoice accrues no further months", async () => {
    clockAt(at(2026, 1, 1, 1));
    const { session, invoice, chargeId } = await subscribe({ periodStart: at(2026, 1, 1), interval: "year" });
    await send("checkout.session.completed", session);
    await send("invoice.paid", invoice);
    clockAt(at(2026, 1, 20));
    await send("charge.refunded", h.stripe.refundCharge(chargeId!));
    clockAt(at(2026, 5, 15));
    await getCreditBalance(USER);
    expect(proGrants()).toHaveLength(1);
  });

  it("an annual refunded and canceled early, then a monthly resubscription: no months of the old year", async () => {
    clockAt(at(2026, 1, 1, 1));
    const a = await subscribe({ periodStart: at(2026, 1, 1), interval: "year" });
    await send("checkout.session.completed", a.session);
    await send("invoice.paid", a.invoice);
    clockAt(at(2026, 1, 20));
    await send("charge.refunded", h.stripe.refundCharge(a.chargeId!));
    h.stripe.setSubscriptionStatus(a.subscription.id, "canceled");
    await send("customer.subscription.deleted", a.subscription);

    clockAt(at(2026, 6, 10));
    const b = await subscribe({ periodStart: at(2026, 6, 10), interval: "month" });
    h.authUser = USER;
    await reconcileCheckoutSession(b.session.id); // success redirect, before any webhook
    expect(row()).toMatchObject({ status: "active", stripeSubscriptionId: b.subscription.id });
    await getCreditBalance(USER);
    expect(proGrants()).toHaveLength(1); // January only
    await send("invoice.paid", b.invoice);
    clockAt(at(2026, 7, 1));
    await getCreditBalance(USER);
    expect(proGrants()).toHaveLength(2); // + June
  });
});

describe("finding 3: plan switches in the billing portal", () => {
  it("switching monthly ↔ annual repeatedly grants one allowance per month of coverage", async () => {
    const jan1 = at(2026, 1, 1);
    clockAt(jan1 + 3600);
    const { session, subscription, invoice } = await subscribe({ periodStart: jan1, interval: "month" });
    await send("checkout.session.completed", session);
    await send("invoice.paid", invoice);
    const switches: [number, "year" | "month", number][] = [
      [at(2026, 1, 10), "year", 580],
      [at(2026, 1, 12), "month", 7900], // paid entirely by the proration credit
      [at(2026, 1, 14), "year", 770],
      [at(2026, 1, 16), "month", 7800],
    ];
    for (const [when, interval, unusedCredit] of switches) {
      clockAt(when + 60);
      const { invoice: inv } = h.stripe.switchPrice(subscription.id, { interval, at: when, unusedCredit });
      await send("customer.subscription.updated", subscription);
      await send("invoice.paid", inv);
      await getCreditBalance(USER);
    }
    expect(proGrants()).toHaveLength(1);
    // The monthly renewal paid from the customer's balance in February grants.
    clockAt(at(2026, 2, 16, 1));
    const { invoice: feb } = h.stripe.renewSubscription(subscription.id, { balanceApplied: 800 });
    await send("invoice.paid", feb);
    expect(proGrants()).toHaveLength(2);
  });

  it("an invoice whose total is zero after proration grants nothing", async () => {
    clockAt(at(2026, 3, 1, 1));
    const { session, subscription, invoice } = await subscribe({ periodStart: at(2026, 3, 1), interval: "year" });
    await send("checkout.session.completed", session);
    await send("invoice.paid", invoice);
    clockAt(at(2026, 4, 2));
    const { invoice: inv } = h.stripe.switchPrice(subscription.id, { interval: "month", at: at(2026, 4, 2), unusedCredit: 7300 });
    expect(inv.amount_paid).toBe(0);
    await send("invoice.paid", inv);
    await getCreditBalance(USER);
    // March (paid invoice) + April (annual anniversary on Apr 1, flushed at the switch).
    expect(proGrants()).toHaveLength(2);
  });
});

describe("finding 5: concurrent webhook handlers", () => {
  it("a handler that fetched 'active' before the cancellation cannot restore Pro after it", async () => {
    clockAt(at(2026, 3, 1, 1));
    const { session, subscription } = await subscribe({ periodStart: at(2026, 3, 1), interval: "month" });
    await send("checkout.session.completed", session);
    const activeSnapshot = await h.stripe.stripe.subscriptions.retrieve(subscription.id);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(h.stripe.stripe.subscriptions, "retrieve").mockImplementationOnce(async () => {
      await gate; // handler 1's read of the live state is slow
      return activeSnapshot as never;
    });
    const handler1 = send("customer.subscription.updated", subscription);

    clockAt(at(2026, 3, 1, 2));
    h.stripe.setSubscriptionStatus(subscription.id, "canceled");
    await send("customer.subscription.deleted", subscription);
    expect(row()?.status).toBe("canceled");

    release();
    expect((await handler1).status).toBe(200);
    expect(row()?.status).toBe("canceled");
    h.authUser = USER;
    expect(await getUserPlan()).toBe("free");
  });
});

describe("finding 9: refunds and disputes", () => {
  it("(a) an inquiry claws back, and closing it as warning_closed restores", async () => {
    const { session, chargeId } = await buyPack();
    await send("checkout.session.completed", session);
    const inquiry = h.stripe.dispute(chargeId, { status: "warning_needs_response" });
    await send("charge.dispute.created", inquiry);
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS);
    await send("charge.dispute.closed", { ...inquiry, status: "warning_closed" });
    await send("charge.dispute.closed", { ...inquiry, status: "warning_closed" });
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS + 1000);
    expect(h.db.ledgerSum(USER)).toBe(h.db.balance(USER));
  });

  it("(b) a 50% refund plus a lost dispute on the other 50% claws back the whole pack", async () => {
    const { session, chargeId } = await buyPack();
    await send("checkout.session.completed", session);
    await send("charge.refunded", h.stripe.refundCharge(chargeId, 500));
    const dispute = h.stripe.dispute(chargeId, { amount: 500 });
    await send("charge.dispute.created", dispute);
    await send("charge.dispute.closed", { ...dispute, status: "lost" });
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS);
  });

  it("(b) a lost dispute is counted even when its 'created' event never arrived", async () => {
    const { session, chargeId } = await buyPack();
    await send("checkout.session.completed", session);
    await send("charge.dispute.closed", h.stripe.dispute(chargeId, { status: "lost" }));
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS);
  });

  it("(c) a $1 partial refund before the grant: the pack is granted net (900)", async () => {
    const { session, chargeId } = await buyPack();
    await send("charge.refunded", h.stripe.refundCharge(chargeId, 100));
    await send("checkout.session.completed", session);
    await send("checkout.session.completed", session);
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS + 900);
  });

  it("(c) a dispute before the grant that is then won ends with the full pack", async () => {
    const { session, chargeId } = await buyPack();
    const dispute = h.stripe.dispute(chargeId);
    await send("charge.dispute.created", dispute);
    await send("checkout.session.completed", session);
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS);
    await send("charge.dispute.closed", { ...dispute, status: "won" });
    expect(h.db.balance(USER)).toBe(FREE_SIGNUP_CREDITS + 1000);
  });

  it("(d) a dispute on the annual payment stops Pro and accrual; winning it restores both", async () => {
    clockAt(at(2026, 1, 1, 1));
    const { session, invoice, chargeId } = await subscribe({ periodStart: at(2026, 1, 1), interval: "year" });
    await send("checkout.session.completed", session);
    await send("invoice.paid", invoice);
    h.authUser = USER;
    expect(await getUserPlan()).toBe("pro");

    clockAt(at(2026, 2, 10));
    await getCreditBalance(USER); // February granted
    const dispute = h.stripe.dispute(chargeId!);
    await send("charge.dispute.created", dispute);
    expect(await getUserPlan()).toBe("free");
    clockAt(at(2026, 5, 10));
    await getCreditBalance(USER);
    expect(proGrants()).toHaveLength(2);

    await send("charge.dispute.closed", { ...dispute, status: "won" });
    expect(await getUserPlan()).toBe("pro");
    await getCreditBalance(USER);
    expect(proGrants()).toHaveLength(5); // March, April, May
  });

  it("(d) a lost dispute on the subscription payment cancels the subscription", async () => {
    clockAt(at(2026, 1, 1, 1));
    const { session, invoice, chargeId, subscription } = await subscribe({ periodStart: at(2026, 1, 1), interval: "year" });
    await send("checkout.session.completed", session);
    await send("invoice.paid", invoice);
    const dispute = h.stripe.dispute(chargeId!);
    await send("charge.dispute.created", dispute);
    await send("charge.dispute.closed", { ...dispute, status: "lost" });
    expect(h.stripe.state.subscriptions.get(subscription.id)?.status).toBe("canceled");
    h.authUser = USER;
    expect(await getUserPlan()).toBe("free");
  });

  it("(e) credits spent before a refund are not taken out of a later purchase", async () => {
    const first = await buyPack();
    await send("checkout.session.completed", first.session);
    h.db.state.accounts.get(USER)!.balance = 100; // spent the rest
    await send("charge.refunded", h.stripe.refundCharge(first.chargeId, 500)); // takes 100, forgives 400
    expect(h.db.balance(USER)).toBe(0);
    const second = await buyPack();
    await send("checkout.session.completed", second.session);
    expect(h.db.balance(USER)).toBe(1000);
    await send("charge.refunded", h.stripe.refundCharge(first.chargeId)); // the other half of pack 1
    expect(h.db.balance(USER)).toBe(500);
  });
});

describe("finding 7: a pack paid while the account is being deleted", () => {
  it("is refunded, and no credit account is recreated", async () => {
    const { session, paymentIntent } = await buyPack();
    await markAccountDeleted(USER); // tombstone first; the erase has not run yet
    await send("checkout.session.completed", session);
    expect(h.db.ledgerFor(USER).filter((l) => l.reason === "credit_purchase")).toHaveLength(0);
    expect(h.stripe.state.refunds).toEqual([expect.objectContaining({ payment_intent: paymentIntent })]);
  });
});

describe("finding 11: invoices of subscriptions this app did not create", () => {
  it("are acknowledged and recorded once instead of failing every retry", async () => {
    h.stripe.addSubscription({ id: "sub_foreign", customer: "cus_foreign" });
    const inv = h.stripe.subscriptionInvoice("sub_foreign", { start: at(2026, 1, 1), end: at(2026, 2, 1) });
    expect((await send("invoice.paid", inv)).status).toBe(200);
    expect((await send("invoice.paid", inv)).status).toBe(200);
    expect(h.db.state.billingEvents.filter((e) => e.kind === "unattributed_invoice")).toEqual([
      expect.objectContaining({ stripeObjectId: inv.id }),
    ]);
    expect(h.db.state.ledger).toHaveLength(0);
  });

  it("are attributed through the customer's metadata when the subscription has none", async () => {
    const pack = await createCreditPackCheckout({ userId: USER, email: null, origin: "o" });
    const customer = h.stripe.state.sessions.get(pack.url.split("/").pop()!)!.customer;
    h.db.state.subscriptions.delete(USER); // no local row to find it by
    h.stripe.addSubscription({ id: "sub_dash", customer });
    const inv = h.stripe.subscriptionInvoice("sub_dash", { start: at(2026, 1, 1), end: at(2026, 2, 1) });
    expect((await send("invoice.paid", inv)).status).toBe(200);
    expect(row()).toMatchObject({ status: "active", stripeSubscriptionId: "sub_dash" });
    expect(proGrants()).toHaveLength(1);
  });
});
