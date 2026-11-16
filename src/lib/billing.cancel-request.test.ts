/**
 * "Cancel contracts here" for a signed-in subscriber (lib/contract-notices):
 * scheduleCancellationAtPeriodEnd stops renewals of their own live
 * subscription (cancel at period end), keeps the paid period, is idempotent,
 * and throws when Stripe fails so the notice stays open for the operator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb, createFakeStripe } from "@/test/billing-fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  stripe: null as unknown as ReturnType<typeof createFakeStripe>,
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
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: "user_1" })) }));

import { applyLiveSubscription, createProCheckout, grantProInvoice, scheduleCancellationAtPeriodEnd } from "./billing";

const USER = "user_1";

async function subscribed() {
  const res = await createProCheckout({ userId: USER, email: "a@b.c", priceId: "price_m", origin: "http://x" });
  if (!("url" in res)) throw new Error("blocked");
  const done = h.stripe.completeSubscriptionCheckout(res.url.split("/").pop()!, { interval: "month" });
  await applyLiveSubscription(USER, done.subscription as never);
  await grantProInvoice(USER, done.invoice as never, done.subscription.id);
  return done.subscription as { id: string; items: { data: { current_period_end: number }[] } };
}

beforeEach(() => {
  h.db.reset();
  h.stripe.reset();
});
afterEach(() => vi.useRealTimers());

describe("scheduleCancellationAtPeriodEnd", () => {
  it("sets the live subscription to cancel at period end and says when Pro ends", async () => {
    const sub = await subscribed();
    const result = await scheduleCancellationAtPeriodEnd(USER);
    const periodEnd = new Date(sub.items.data[0].current_period_end * 1000);
    expect(result).toEqual({ outcome: "scheduled", subscriptionId: sub.id, endsAt: periodEnd });
    const live = h.stripe.state.subscriptions.get(sub.id)!;
    expect(live.cancel_at_period_end).toBe(true);
    // Still Pro: the paid period is kept, the row stays active.
    expect(live.status).toBe("active");
    expect(h.db.state.subscriptions.get(USER)?.status).toBe("active");
    // Nothing was canceled outright.
    expect(h.stripe.state.calls.filter((c) => c === "subscriptions.cancel")).toEqual([]);
  });

  it("is idempotent: a second request changes nothing in Stripe", async () => {
    const sub = await subscribed();
    await scheduleCancellationAtPeriodEnd(USER);
    const updates = () => h.stripe.state.calls.filter((c) => c === "subscriptions.update").length;
    const before = updates();
    const again = await scheduleCancellationAtPeriodEnd(USER);
    expect(again).toMatchObject({ outcome: "already_scheduled", subscriptionId: sub.id });
    expect(updates()).toBe(before);
  });

  it("leaves accounts without an active subscription alone", async () => {
    expect(await scheduleCancellationAtPeriodEnd("user_none")).toEqual({ outcome: "no_live_subscription" });
    const sub = await subscribed();
    h.stripe.setSubscriptionStatus(sub.id, "past_due");
    expect(await scheduleCancellationAtPeriodEnd(USER)).toEqual({ outcome: "no_live_subscription" });
    expect(h.stripe.state.subscriptions.get(sub.id)!.cancel_at_period_end).toBe(false);
  });

  it("throws when Stripe fails, so the request stays open for the operator", async () => {
    const sub = await subscribed();
    h.stripe.failNext("subscriptions.update", { times: 1 });
    await expect(scheduleCancellationAtPeriodEnd(USER)).rejects.toThrow();
    expect(h.stripe.state.subscriptions.get(sub.id)!.cancel_at_period_end).toBe(false);
    // Retrying afterwards works.
    expect(await scheduleCancellationAtPeriodEnd(USER)).toMatchObject({ outcome: "scheduled" });
  });
});
