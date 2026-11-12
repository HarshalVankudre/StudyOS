import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb, createFakeStripe } from "@/test/billing-fakes";

// In-memory Prisma + Stripe: every scenario runs the real webhook, billing and
// credits code end to end, with no network and no database.
const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  stripe: null as unknown as ReturnType<typeof createFakeStripe>,
  funnel: vi.fn(),
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
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: null })) }));

import { POST } from "./route";
import { webhookRequest } from "@/test/billing-fakes";
import {
  createCreditPackCheckout,
  createProCheckout,
  markAccountDeleted,
} from "@/lib/billing";
import { FREE_SIGNUP_CREDITS, PRO_MONTHLY_CREDITS } from "@/lib/credits";

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
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

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

  it("monthly → annual switch: the new period line grants and moves the period", async () => {
    const start = 1_767_225_600;
    const { session, subscription, invoice } = await subscribe({ periodStart: start, periodEnd: start + 31 * DAY });
    await send("checkout.session.completed", session);
    await send("invoice.paid", invoice);
    const switchAt = start + 10 * DAY;
    const inv = h.stripe.subscriptionInvoice(subscription.id, {
      start: switchAt, end: switchAt + 365 * DAY, amount: 8000, billingReason: "subscription_update",
    });
    // Stripe adds a negative proration line for unused monthly time.
    inv.lines.data.unshift({
      ...inv.lines.data[0], id: "il_credit", amount: -540,
      parent: { type: "subscription_item_details", subscription_item_details: { proration: true, subscription: subscription.id } },
    });
    await send("invoice.paid", inv);
    expect(proGrants()).toHaveLength(2);
    expect(row()?.allowancePeriodStart?.getTime()).toBe(switchAt * 1000);
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

  it("never grants a pack that was refunded before the grant landed", async () => {
    const { session, chargeId, paymentIntent, amount } = await buyPack();
    await send("charge.refunded", { id: chargeId, payment_intent: paymentIntent, amount, amount_refunded: amount, customer: session.customer });
    await send("checkout.session.completed", session); // delayed delivery
    expect(h.db.ledgerFor(USER).filter((l) => l.reason === "credit_purchase")).toHaveLength(0);
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
