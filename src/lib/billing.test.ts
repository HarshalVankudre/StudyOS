import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb, createFakeStripe } from "@/test/billing-fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  stripe: null as unknown as ReturnType<typeof createFakeStripe>,
  userId: "user_1" as string | null,
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
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: h.userId })),
}));

import {
  applyLiveSubscription,
  cancelAllBillingForUser,
  createCreditPackCheckout,
  createProCheckout,
  getUserPlan,
  grantProInvoice,
  reconcileCheckoutSession,
} from "./billing";
import { getCreditBalance, PRO_MONTHLY_CREDITS } from "./credits";

const USER = "user_1";
const sessionId = (url: string) => url.split("/").pop()!;

async function proCheckout(userId = USER) {
  const res = await createProCheckout({ userId, email: "a@b.c", priceId: "price_m", origin: "http://x" });
  return res;
}

beforeEach(() => {
  h.db.reset();
  h.stripe.reset();
  h.userId = USER;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("checkout: one customer, one subscription", () => {
  it("creates one Stripe customer and reuses it for every checkout", async () => {
    const a = await proCheckout();
    const pack = await createCreditPackCheckout({ userId: USER, email: "a@b.c", origin: "http://x" });
    if (!("url" in a)) throw new Error("blocked");
    const customers = [...h.stripe.state.customers.values()];
    expect(customers).toHaveLength(1);
    expect(customers[0].metadata).toEqual({ userId: USER });
    const sessions = [...h.stripe.state.sessions.values()];
    expect(sessions.map((s) => s.customer)).toEqual([customers[0].id, customers[0].id]);
    expect(sessions.every((s) => !("customer_email" in s))).toBe(true);
    expect(h.stripe.state.sessions.get(sessionId(pack.url))?.payment_intent_data).toEqual({
      metadata: { userId: USER, kind: "credits", credits: "1000" },
    });
    expect(h.db.state.subscriptions.get(USER)?.stripeCustomerId).toBe(customers[0].id);
  });

  it("reuses a customer stored by an older checkout", async () => {
    await h.db.db.subscription.upsert({
      where: { userId: USER },
      create: { userId: USER, stripeCustomerId: "cus_legacy", status: "canceled" },
      update: {},
    });
    await proCheckout();
    expect(h.stripe.state.customers.size).toBe(0);
    expect([...h.stripe.state.sessions.values()][0].customer).toBe("cus_legacy");
  });

  it("blocks checkout while the database says the user is Pro", async () => {
    await h.db.db.subscription.upsert({
      where: { userId: USER },
      create: { userId: USER, status: "active", stripeCustomerId: "cus_1" },
      update: {},
    });
    expect(await proCheckout()).toEqual({ blocked: "already_subscribed" });
    expect(h.stripe.state.sessions.size).toBe(0);
  });

  it("blocks checkout when Stripe already has a live subscription the webhook has not delivered yet", async () => {
    const first = await proCheckout();
    if (!("url" in first)) throw new Error("blocked");
    const { subscription } = h.stripe.completeSubscriptionCheckout(sessionId(first.url));
    // No webhook processed: the DB row is still not active.
    expect(h.db.state.subscriptions.get(USER)?.status).not.toBe("active");
    expect(await proCheckout()).toEqual({ blocked: "already_subscribed" });
    // ...and the missed state is healed.
    expect(h.db.state.subscriptions.get(USER)).toMatchObject({
      status: "active",
      stripeSubscriptionId: subscription.id,
    });
  });

  it("a stale 'active' row (missed cancellation webhook) does not lock the user out", async () => {
    const first = await proCheckout();
    if (!("url" in first)) throw new Error("blocked");
    const { subscription } = h.stripe.completeSubscriptionCheckout(sessionId(first.url));
    await applyLiveSubscription(USER, subscription as never);
    expect(await proCheckout()).toEqual({ blocked: "already_subscribed" });
    h.stripe.setSubscriptionStatus(subscription.id, "canceled"); // webhook lost
    const again = await proCheckout();
    expect("url" in again).toBe(true);
    expect(h.db.state.subscriptions.get(USER)?.status).toBe("canceled");
  });

  it("blocks on past_due / incomplete subscriptions too (they still bill)", async () => {
    const first = await proCheckout();
    if (!("url" in first)) throw new Error("blocked");
    const { subscription } = h.stripe.completeSubscriptionCheckout(sessionId(first.url), { status: "past_due" });
    expect(await proCheckout()).toEqual({ blocked: "already_subscribed" });
    h.stripe.setSubscriptionStatus(subscription.id, "canceled");
    expect("url" in (await proCheckout())).toBe(true);
  });

  it("a second tab's checkout expires the first one, so only one can be paid", async () => {
    const a = await proCheckout();
    const b = await proCheckout();
    if (!("url" in a) || !("url" in b)) throw new Error("blocked");
    expect(h.stripe.state.sessions.get(sessionId(a.url))?.status).toBe("expired");
    expect(h.stripe.state.sessions.get(sessionId(b.url))?.status).toBe("open");
    expect(() => h.stripe.completeSubscriptionCheckout(sessionId(a.url))).toThrow();
  });

  it("does not expire open credit-pack checkouts", async () => {
    const pack = await createCreditPackCheckout({ userId: USER, email: null, origin: "o" });
    await proCheckout();
    expect(h.stripe.state.sessions.get(sessionId(pack.url))?.status).toBe("open");
  });

  it("a double submit creates one customer (Stripe idempotency key)", async () => {
    await Promise.all([proCheckout(), proCheckout()]);
    expect(h.stripe.state.customers.size).toBe(1);
  });
});

describe("replacing a failing subscription", () => {
  it("stops the old past_due subscription when a new one becomes active", async () => {
    h.stripe.addSubscription({ id: "sub_old", customer: "cus_1", status: "past_due" });
    await h.db.db.subscription.upsert({
      where: { userId: USER },
      create: { userId: USER, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_old", status: "past_due" },
      update: {},
    });
    const fresh = h.stripe.addSubscription({ id: "sub_new", customer: "cus_1", status: "active" });
    expect(await applyLiveSubscription(USER, fresh as never)).toBe("ok");
    expect(h.stripe.state.subscriptions.get("sub_old")?.status).toBe("canceled");
    expect(h.stripe.state.refunds).toHaveLength(0);
    expect(h.db.state.subscriptions.get(USER)).toMatchObject({ status: "active", stripeSubscriptionId: "sub_new" });
  });
});

describe("checkout success redirect (replay)", () => {
  async function paidSubscription() {
    const res = await proCheckout();
    if (!("url" in res)) throw new Error("blocked");
    return h.stripe.completeSubscriptionCheckout(sessionId(res.url));
  }

  it("activates Pro from the live subscription", async () => {
    const { session } = await paidSubscription();
    await reconcileCheckoutSession(session.id);
    expect(h.db.state.subscriptions.get(USER)?.status).toBe("active");
  });

  it("replaying an old success URL after cancelling does not restore Pro", async () => {
    const { session, subscription } = await paidSubscription();
    await reconcileCheckoutSession(session.id);
    h.stripe.setSubscriptionStatus(subscription.id, "canceled");
    await applyLiveSubscription(USER, (await h.stripe.stripe.subscriptions.retrieve(subscription.id)) as never);
    expect(h.db.state.subscriptions.get(USER)?.status).toBe("canceled");

    await reconcileCheckoutSession(session.id); // revisit /app?session_id=…
    expect(h.db.state.subscriptions.get(USER)?.status).toBe("canceled");
  });

  it("ignores another user's session", async () => {
    const { session } = await paidSubscription();
    h.userId = "user_2";
    await reconcileCheckoutSession(session.id);
    expect(h.db.state.subscriptions.get("user_2")).toBeUndefined();
  });

  it("does not grant an unpaid (delayed) credit pack, then grants it once paid", async () => {
    const { url } = await createCreditPackCheckout({ userId: USER, email: null, origin: "o" });
    const { session } = h.stripe.completePackCheckout(sessionId(url), { paid: false });
    await reconcileCheckoutSession(session.id);
    expect(h.db.ledgerFor(USER).some((l) => l.reason === "credit_purchase")).toBe(false);
    h.stripe.markPackPaid(session.id);
    await reconcileCheckoutSession(session.id);
    await reconcileCheckoutSession(session.id);
    expect(h.db.ledgerFor(USER).filter((l) => l.reason === "credit_purchase")).toHaveLength(1);
  });
});

describe("STUDYOS_PLAN override", () => {
  it("is honoured outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STUDYOS_PLAN", "pro");
    expect(await getUserPlan()).toBe("pro");
  });

  it("is ignored in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STUDYOS_PLAN", "pro");
    expect(await getUserPlan()).toBe("free");
  });

  it("a real subscription wins in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await h.db.db.subscription.upsert({
      where: { userId: USER },
      create: { userId: USER, status: "active" },
      update: {},
    });
    expect(await getUserPlan()).toBe("pro");
  });
});

describe("account deletion cancels every subscription", () => {
  it("cancels the tracked one, others on the customer, and legacy ones on other customers", async () => {
    const res = await proCheckout();
    if (!("url" in res)) throw new Error("blocked");
    const tracked = h.stripe.completeSubscriptionCheckout(sessionId(res.url));
    await applyLiveSubscription(USER, tracked.subscription as never);
    const customer = h.db.state.subscriptions.get(USER)!.stripeCustomerId;
    const sameCustomer = h.stripe.addSubscription({ id: "sub_same", customer });
    const legacy = h.stripe.addSubscription({ id: "sub_legacy", customer: "cus_old", metadata: { userId: USER } });
    h.stripe.addSubscription({ id: "sub_other_user", customer: "cus_x", metadata: { userId: "user_9" } });
    const openPack = await createCreditPackCheckout({ userId: USER, email: null, origin: "o" });

    await cancelAllBillingForUser(USER);

    const status = (id: string) => h.stripe.state.subscriptions.get(id)?.status;
    expect(status(tracked.subscription.id)).toBe("canceled");
    expect(status(sameCustomer.id)).toBe("canceled");
    expect(status(legacy.id)).toBe("canceled");
    expect(status("sub_other_user")).toBe("active");
    expect(h.stripe.state.sessions.get(sessionId(openPack.url))?.status).toBe("expired");
  });

  it("treats already-canceled subscriptions as stopped", async () => {
    h.stripe.addSubscription({ id: "sub_gone", customer: "cus_1", status: "canceled" });
    await h.db.db.subscription.upsert({
      where: { userId: USER },
      create: { userId: USER, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_gone", status: "canceled" },
      update: {},
    });
    await expect(cancelAllBillingForUser(USER)).resolves.toBeUndefined();
  });

  it("throws on a transient Stripe failure so deletion aborts", async () => {
    h.stripe.addSubscription({ id: "sub_live", customer: "cus_1" });
    await h.db.db.subscription.upsert({
      where: { userId: USER },
      create: { userId: USER, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_live", status: "active" },
      update: {},
    });
    const spy = vi
      .spyOn(h.stripe.stripe.subscriptions, "cancel")
      .mockRejectedValueOnce(Object.assign(new Error("down"), { type: "StripeConnectionError" }));
    await expect(cancelAllBillingForUser(USER)).rejects.toThrow("down");
    spy.mockRestore();
  });

  it("still cancels the customer's subscriptions when search is unavailable", async () => {
    h.stripe.addSubscription({ id: "sub_live", customer: "cus_1" });
    await h.db.db.subscription.upsert({
      where: { userId: USER },
      create: { userId: USER, stripeCustomerId: "cus_1", status: "active" },
      update: {},
    });
    const spy = vi
      .spyOn(h.stripe.stripe.subscriptions, "search")
      .mockRejectedValueOnce(new Error("search unavailable"));
    await cancelAllBillingForUser(USER);
    expect(h.stripe.state.subscriptions.get("sub_live")?.status).toBe("canceled");
    spy.mockRestore();
  });
});

describe("annual plan: monthly allowance on the anniversary day", () => {
  // Paid annual period starting 2026-01-31 (an end-of-month anchor).
  const start = Date.UTC(2026, 0, 31, 12) / 1000;
  const end = Date.UTC(2027, 0, 31, 12) / 1000;

  async function annualSubscriber() {
    const res = await proCheckout();
    if (!("url" in res)) throw new Error("blocked");
    const { subscription, invoice } = h.stripe.completeSubscriptionCheckout(sessionId(res.url), {
      periodStart: start,
      periodEnd: end,
      amount: 8000,
    });
    await applyLiveSubscription(USER, subscription as never);
    await grantProInvoice(USER, invoice as never, subscription.id);
    return subscription;
  }
  const proGrants = () => h.db.ledgerFor(USER).filter((l) => l.reason === "pro_monthly").length;

  it("grants month 0 with the invoice and nothing more before the first anniversary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 1, 27)));
    await annualSubscriber();
    await getCreditBalance(USER);
    expect(proGrants()).toBe(1);
  });

  it("grants each month on its anniversary (clamped to Feb 28), idempotently", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 1, 28, 12))); // Feb 28 = clamped anniversary
    await annualSubscriber();
    const balance = await getCreditBalance(USER);
    await getCreditBalance(USER);
    expect(proGrants()).toBe(2);
    expect(balance).toBe(300 + 2 * PRO_MONTHLY_CREDITS);
  });

  it("catches up missed months on the next visit, then stops at 12 for the year", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 31, 13)));
    await annualSubscriber();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 1))); // after Feb 28, Mar 31, Apr 30
    await getCreditBalance(USER);
    expect(proGrants()).toBe(4);
    vi.setSystemTime(new Date(Date.UTC(2027, 0, 30))); // just before renewal
    await getCreditBalance(USER);
    expect(proGrants()).toBe(12);
    vi.setSystemTime(new Date(Date.UTC(2027, 1, 15))); // renewal invoice not yet paid
    await getCreditBalance(USER);
    expect(proGrants()).toBe(12);
  });

  it("stops accruing once the subscription is no longer active", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 31, 13)));
    const sub = await annualSubscriber();
    h.stripe.setSubscriptionStatus(sub.id, "canceled");
    await applyLiveSubscription(USER, (await h.stripe.stripe.subscriptions.retrieve(sub.id)) as never);
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 1)));
    await getCreditBalance(USER);
    expect(proGrants()).toBe(1);
  });

  it("a monthly subscriber never accrues extra months", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 31, 13)));
    const res = await proCheckout();
    if (!("url" in res)) throw new Error("blocked");
    const { subscription, invoice } = h.stripe.completeSubscriptionCheckout(sessionId(res.url), {
      periodStart: start,
      periodEnd: Date.UTC(2026, 1, 28, 12) / 1000,
    });
    await applyLiveSubscription(USER, subscription as never);
    await grantProInvoice(USER, invoice as never, subscription.id);
    vi.setSystemTime(new Date(Date.UTC(2026, 1, 28, 13)));
    await getCreditBalance(USER);
    expect(proGrants()).toBe(1);
  });
});
