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
  isPro,
  markAccountDeleted,
  PRO_GRACE_MS,
  reconcileCheckoutSession,
  runBillingMaintenance,
  stopBillingForDeletedAccount,
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

// ---- Review findings (wave 1 billing) ---------------------------------------

const DAY_SEC = 86_400;
const utc = (y: number, m: number, d: number, hh = 0) => Date.UTC(y, m - 1, d, hh) / 1000;
function clockAt(sec: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(sec * 1000));
}
const proGrantCount = () => h.db.ledgerFor(USER).filter((l) => l.reason === "pro_monthly").length;

/** Subscribe on "Stripe" and apply the first paid invoice, as the webhook would. */
async function subscribed(opts: { start: number; interval: "month" | "year"; periodEnd?: number }) {
  const res = await proCheckout();
  if (!("url" in res)) throw new Error("blocked");
  const done = h.stripe.completeSubscriptionCheckout(sessionId(res.url), {
    periodStart: opts.start,
    interval: opts.interval,
    periodEnd: opts.periodEnd,
  });
  await applyLiveSubscription(USER, done.subscription as never);
  await grantProInvoice(USER, done.invoice as never, done.subscription.id);
  return done;
}

/** Live the subscription day by day: renew when due, read the balance daily. */
async function liveDaily(subId: string, from: number, days: number) {
  let paid = 1;
  for (let t = from; t < from + days * DAY_SEC; t += DAY_SEC) {
    clockAt(t);
    const live = h.stripe.state.subscriptions.get(subId)!;
    if (t >= live.items.data[0].current_period_end) {
      const { invoice } = h.stripe.renewSubscription(subId);
      await applyLiveSubscription(USER, (await h.stripe.stripe.subscriptions.retrieve(subId)) as never);
      await grantProInvoice(USER, invoice as never, subId);
      paid++;
    }
    await getCreditBalance(USER);
  }
  return paid;
}

describe("finding 4: month-end anchors and boundary days", () => {
  it.each([29, 30, 31])(
    "a monthly subscriber anchored on day %i gets exactly one allowance per paid month",
    async (day) => {
      const start = utc(2026, 1, day, 12);
      clockAt(start + 60);
      const { subscription } = await subscribed({ start, interval: "month" });
      const paid = await liveDaily(subscription.id, start + 3600, 364);
      expect(paid).toBe(12);
      expect(proGrantCount()).toBe(12);
    },
  );

  it("an annual subscription anchored on Feb 29 gets at most twelve allowances for its year", async () => {
    const start = utc(2028, 2, 29, 12);
    clockAt(start + 60);
    // Stripe may end that year on Mar 1.
    await subscribed({ start, interval: "year", periodEnd: utc(2029, 3, 1, 12) });
    for (let t = start; t < utc(2029, 3, 1, 11); t += DAY_SEC) {
      clockAt(t);
      await getCreditBalance(USER);
    }
    expect(proGrantCount()).toBe(12);
  });

  it("an annual period that ends a day or two late still gives twelve", async () => {
    const start = utc(2026, 1, 1, 12);
    clockAt(start + 60);
    await subscribed({ start, interval: "year", periodEnd: utc(2027, 1, 3, 12) });
    clockAt(utc(2027, 1, 3, 11));
    await getCreditBalance(USER);
    expect(proGrantCount()).toBe(12);
  });
});

describe("finding 5: the later-fetched subscription state wins", () => {
  async function liveSub() {
    clockAt(utc(2026, 3, 1, 1));
    const { subscription } = await subscribed({ start: utc(2026, 3, 1), interval: "month" });
    return subscription.id as string;
  }

  it("a stale 'active' fetched before the cancellation never overwrites it", async () => {
    const id = await liveSub();
    const t1 = new Date(utc(2026, 3, 5) * 1000);
    const active = await h.stripe.stripe.subscriptions.retrieve(id);
    h.stripe.setSubscriptionStatus(id, "canceled");
    const t2 = new Date(utc(2026, 3, 5, 1) * 1000);
    const canceled = await h.stripe.stripe.subscriptions.retrieve(id);
    await applyLiveSubscription(USER, canceled as never, t2);
    await applyLiveSubscription(USER, active as never, t1);
    expect(h.db.state.subscriptions.get(USER)?.status).toBe("canceled");
  });

  it("a canceled subscription never becomes live again, whatever the clocks say", async () => {
    const id = await liveSub();
    const active = await h.stripe.stripe.subscriptions.retrieve(id);
    h.stripe.setSubscriptionStatus(id, "canceled");
    const canceled = await h.stripe.stripe.subscriptions.retrieve(id);
    await applyLiveSubscription(USER, canceled as never, new Date(utc(2026, 3, 5) * 1000));
    await applyLiveSubscription(USER, active as never, new Date(utc(2026, 3, 6) * 1000));
    expect(h.db.state.subscriptions.get(USER)?.status).toBe("canceled");
  });

  it("stops counting as Pro once the paid period plus the grace interval has passed", async () => {
    await liveSub();
    const end = h.db.state.subscriptions.get(USER)!.currentPeriodEnd.getTime();
    clockAt((end + PRO_GRACE_MS - 60_000) / 1000);
    expect(await getUserPlan()).toBe("pro");
    expect(await isPro()).toBe(true);
    clockAt((end + PRO_GRACE_MS + 60_000) / 1000);
    expect(await getUserPlan()).toBe("free");
    expect(await isPro()).toBe(false);
  });

  it("the maintenance job re-reads a row whose period lapsed (a missed renewal webhook)", async () => {
    const id = await liveSub();
    const end = h.stripe.state.subscriptions.get(id)!.items.data[0].current_period_end;
    clockAt(end + 2 * DAY_SEC);
    h.stripe.renewSubscription(id); // renewed on Stripe, webhook lost
    await runBillingMaintenance();
    expect(h.db.state.subscriptions.get(USER)?.currentPeriodEnd.getTime()).toBe(
      h.stripe.state.subscriptions.get(id)!.items.data[0].current_period_end * 1000,
    );
  });
});

describe("finding 6: account deletion stops billing durably", () => {
  it("captures the Stripe ids at the tombstone and keeps retrying until the cancel succeeds", async () => {
    clockAt(utc(2026, 3, 1, 1));
    const { subscription } = await subscribed({ start: utc(2026, 3, 1), interval: "month" });
    await markAccountDeleted(USER);
    h.db.state.subscriptions.delete(USER); // the erase ran
    h.stripe.failNext("subscriptions.cancel", { times: 2 });

    expect(await stopBillingForDeletedAccount(USER)).toBe(false);
    expect(h.stripe.state.subscriptions.get(subscription.id)?.status).toBe("active");
    expect(h.db.state.intents).toEqual([
      expect.objectContaining({ kind: "cancel_account_billing", key: USER, state: "pending", attempts: 1 }),
    ]);

    await runBillingMaintenance(); // Stripe still down
    expect(h.db.state.intents[0]).toMatchObject({ state: "pending", attempts: 2 });
    await runBillingMaintenance();
    expect(h.stripe.state.subscriptions.get(subscription.id)?.status).toBe("canceled");
    expect(h.db.state.intents[0]).toMatchObject({ state: "done" });
  });
});

describe("finding 8: months of a paid year are never dropped", () => {
  it("an annual subscriber who never opens the app gets every month when the year renews", async () => {
    clockAt(utc(2026, 1, 1, 1));
    const { subscription } = await subscribed({ start: utc(2026, 1, 1), interval: "year" });
    clockAt(utc(2027, 1, 1, 1));
    const { invoice } = h.stripe.renewSubscription(subscription.id);
    await applyLiveSubscription(USER, (await h.stripe.stripe.subscriptions.retrieve(subscription.id)) as never);
    await grantProInvoice(USER, invoice as never, subscription.id);
    expect(proGrantCount()).toBe(13); // Jan 2026 + Feb..Dec 2026 + Jan 2027
  });

  it("canceled at period end: the year's months are still there after it ends", async () => {
    clockAt(utc(2026, 1, 1, 1));
    const { subscription } = await subscribed({ start: utc(2026, 1, 1), interval: "year" });
    clockAt(utc(2027, 1, 1));
    h.stripe.setSubscriptionStatus(subscription.id, "canceled"); // the period ran out
    await applyLiveSubscription(USER, (await h.stripe.stripe.subscriptions.retrieve(subscription.id)) as never);
    clockAt(utc(2027, 3, 1));
    await getCreditBalance(USER);
    expect(proGrantCount()).toBe(12);
  });
});
