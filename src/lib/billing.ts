/**
 * Billing rules (server-only). Every money decision lives here so the
 * checkout actions, the checkout success redirect and the Stripe webhook all
 * apply the same rules:
 *
 *  - one Stripe customer per user, reused for every checkout;
 *  - at most one live Pro subscription per user (checkout is blocked while one
 *    exists; a duplicate that slips through anyway is canceled and refunded);
 *  - subscription status always comes from the LIVE Stripe subscription, never
 *    from a replayed or out-of-order event payload;
 *  - credits are granted only for money actually received;
 *  - nothing is written for an account that has been deleted.
 */
import { auth } from "@clerk/nextjs/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { stripe, stripeId } from "@/lib/stripe";
import type { Plan } from "@/lib/ai/plans";
import {
  CREDIT_PACK_PRICE_USD,
  CREDIT_PACK_SIZE,
  grantCredits,
  PRO_MONTHLY_CREDITS,
} from "@/lib/credits";

// ---- Plan -------------------------------------------------------------------

/** The current user's plan — "pro" when they have an active subscription. */
export async function getUserPlan(): Promise<Plan> {
  const { userId } = await auth();
  if (userId) {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (sub?.status === "active") return "pro";
  }
  // Dev-only override (no subscription): act as a given plan while testing.
  // Never honoured in production, where it would hand out Pro for free.
  if (process.env.NODE_ENV !== "production") {
    const override = process.env.STUDYOS_PLAN;
    if (override === "pro" || override === "free") return override;
  }
  return "free";
}

/** Has the signed-in user got an active Pro subscription? */
export async function isPro(): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  return sub?.status === "active";
}

// ---- Status mapping ---------------------------------------------------------

/** Stripe statuses that mean "Pro right now". */
const ACTIVE_STATUSES = new Set<string>(["active", "trialing"]);
/** Stripe statuses of a subscription that can never bill again. */
const ENDED_STATUSES = new Set<string>(["canceled", "incomplete_expired"]);

/** Our stored status: "active" while Pro, else Stripe's own status. */
export function planStatus(stripeStatus: string): string {
  return ACTIVE_STATUSES.has(stripeStatus) ? "active" : stripeStatus;
}

function currentPeriodEnd(sub: Stripe.Subscription): Date | null {
  const ends = (sub.items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((n): n is number => typeof n === "number");
  return ends.length ? new Date(Math.max(...ends) * 1000) : null;
}

/**
 * True when a Stripe cancel error means the subscription is already gone
 * (canceled or never existed) — a non-transient client (4xx) error we can
 * safely treat as "billing stopped". Transient errors (network, 5xx, rate
 * limit) return false so callers abort rather than orphan live billing.
 */
export function isSubscriptionAlreadyGone(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; type?: string };
  return e.code === "resource_missing" || e.type === "StripeInvalidRequestError";
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

// ---- Audit + tombstones -----------------------------------------------------

/** Has this user deleted their account? (Late webhooks must not revive it.) */
export async function isDeletedAccount(userId: string): Promise<boolean> {
  const row = await prisma.deletedAccount.findUnique({ where: { userId } });
  return row !== null;
}

type BillingEventInput = {
  userId?: string | null;
  kind: string;
  stripeObjectId: string;
  paymentIntentId?: string | null;
  amountCents?: number | null;
  credits?: number | null;
  detail?: string | null;
};

/** Record a billing event once; returns false when it was already recorded. */
export async function recordBillingEvent(
  data: BillingEventInput,
): Promise<boolean> {
  try {
    await prisma.billingEvent.create({ data });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

async function hasBillingEvent(kind: string, stripeObjectId: string) {
  const row = await prisma.billingEvent.findUnique({
    where: { kind_stripeObjectId: { kind, stripeObjectId } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Refund a payment in full, idempotently. A refund Stripe refuses as a
 * client error (e.g. already refunded) is reported, not thrown, so a webhook
 * does not retry forever; transient errors throw so Stripe retries.
 */
async function refundPayment(
  paymentIntentId: string,
  reason: "duplicate" | "requested_by_customer",
): Promise<{ ok: boolean; amount: number; error?: string }> {
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason },
      { idempotencyKey: `studyos-refund-${reason}-${paymentIntentId}` },
    );
    return { ok: true, amount: refund.amount };
  } catch (err) {
    const e = err as { type?: string; code?: string };
    if (e?.type === "StripeInvalidRequestError") {
      return { ok: false, amount: 0, error: e.code ?? "invalid_request" };
    }
    throw err;
  }
}

/**
 * Cancel a subscription that must not exist (a duplicate, or one created for
 * a deleted account) and refund its latest paid invoice. Recorded as a
 * BillingEvent so its invoices never grant credits.
 */
async function cancelAndRefund(
  userId: string,
  sub: Stripe.Subscription,
  kind: "duplicate_subscription" | "deleted_account_subscription",
): Promise<void> {
  try {
    await stripe.subscriptions.cancel(sub.id);
  } catch (err) {
    if (!isSubscriptionAlreadyGone(err)) throw err;
  }
  let refunded = 0;
  const notes: string[] = [];
  const invoiceId = stripeId(sub.latest_invoice);
  if (invoiceId) {
    const payments = await stripe.invoicePayments.list({
      invoice: invoiceId,
      limit: 10,
    });
    for (const p of payments.data) {
      if (p.status !== "paid") continue;
      const pi = stripeId(p.payment?.payment_intent ?? null);
      if (!pi) {
        notes.push(`manual refund needed: ${p.id}`);
        continue;
      }
      const r = await refundPayment(
        pi,
        kind === "duplicate_subscription" ? "duplicate" : "requested_by_customer",
      );
      if (r.ok) refunded += r.amount;
      else notes.push(`refund ${pi} failed: ${r.error}`);
    }
  }
  await recordBillingEvent({
    userId,
    kind,
    stripeObjectId: sub.id,
    amountCents: refunded,
    detail: [invoiceId && `invoice ${invoiceId}`, ...notes]
      .filter(Boolean)
      .join("; ") || null,
  });
}

// ---- Subscription state -----------------------------------------------------

export type ApplyOutcome =
  /** Written to the user's row. */
  | "ok"
  /** An old subscription the user no longer uses ended; nothing written. */
  | "stale"
  /** Not active and the user has no billing row; nothing written. */
  | "untracked"
  /** A second live subscription: canceled and refunded. */
  | "duplicate"
  /** The account was deleted: nothing written, live billing stopped. */
  | "deleted_account";

/**
 * Bring the user's row in line with a LIVE Stripe subscription (retrieved
 * from Stripe, not taken from an event payload, so replays and out-of-order
 * delivery cannot resurrect or kill Pro). Safe to call repeatedly.
 */
export async function applyLiveSubscription(
  userId: string,
  sub: Stripe.Subscription,
): Promise<ApplyOutcome> {
  if (await isDeletedAccount(userId)) {
    if (!ENDED_STATUSES.has(sub.status)) {
      await cancelAndRefund(userId, sub, "deleted_account_subscription");
    }
    return "deleted_account";
  }

  const status = planStatus(sub.status);
  const row = await prisma.subscription.findUnique({ where: { userId } });

  if (row?.stripeSubscriptionId && row.stripeSubscriptionId !== sub.id) {
    // Not the subscription we track. An ending one never downgrades the user.
    if (status !== "active") return "stale";
    const tracked = await retrieveSubscriptionOrNull(row.stripeSubscriptionId);
    if (tracked && ACTIVE_STATUSES.has(tracked.status)) {
      // Two live subscriptions: keep the one we already track.
      await cancelAndRefund(userId, sub, "duplicate_subscription");
      return "duplicate";
    }
    if (tracked && !ENDED_STATUSES.has(tracked.status)) {
      // The tracked one is failing (past_due/unpaid/…) and this one replaced
      // it: stop the old one so a later retry cannot charge the card again.
      try {
        await stripe.subscriptions.cancel(tracked.id);
      } catch (err) {
        if (!isSubscriptionAlreadyGone(err)) throw err;
      }
      await recordBillingEvent({
        userId,
        kind: "replaced_subscription",
        stripeObjectId: tracked.id,
        detail: `replaced by ${sub.id}`,
      });
    }
    // The tracked one is gone (or now stopped): adopt this one.
  }
  if (!row && status !== "active") return "untracked";

  const fields = {
    status,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: stripeId(sub.customer) ?? row?.stripeCustomerId ?? null,
    currentPeriodEnd: currentPeriodEnd(sub),
  };
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, ...fields },
    update: fields,
  });
  return "ok";
}

async function retrieveSubscriptionOrNull(
  id: string,
): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(id);
  } catch (err) {
    if (isSubscriptionAlreadyGone(err)) return null;
    throw err;
  }
}

/** Retrieve a subscription by id and apply its live state. */
export async function syncSubscription(
  userId: string,
  subscriptionId: string,
): Promise<ApplyOutcome> {
  const live = await stripe.subscriptions.retrieve(subscriptionId);
  return applyLiveSubscription(userId, live);
}

// ---- Pro invoice credits ----------------------------------------------------

type LegacyLine = { type?: string; proration?: boolean };

/**
 * A line that pays for a full subscription period: a subscription line that
 * is not a proration and costs more than zero after discounts. Excludes $0
 * invoices (100% coupons, trials) and plan-change proration adjustments.
 */
function isPaidPeriodLine(line: Stripe.InvoiceLineItem): boolean {
  const details = line.parent?.subscription_item_details ?? null;
  const legacy = line as unknown as LegacyLine; // pre-Basil webhook shape
  if (!details && legacy.type !== "subscription") return false;
  const proration = details ? details.proration : Boolean(legacy.proration);
  if (proration) return false;
  const discount = (line.discount_amounts ?? []).reduce(
    (sum, d) => sum + d.amount,
    0,
  );
  return line.amount - discount > 0;
}

/** The paid subscription period an invoice buys, or null when it buys none. */
export async function paidPeriodOfInvoice(
  inv: Stripe.Invoice,
): Promise<{ start: Date; end: Date } | null> {
  let line = inv.lines?.data?.find(isPaidPeriodLine);
  if (!line && (!inv.lines || inv.lines.has_more)) {
    const all = await stripe.invoices.listLineItems(inv.id, { limit: 100 });
    line = all.data.find(isPaidPeriodLine);
  }
  if (!line) return null;
  return {
    start: new Date(line.period.start * 1000),
    end: new Date(line.period.end * 1000),
  };
}

/**
 * Grant the Pro allowance a paid invoice buys (one month's credits now) and
 * record its paid period, from which a multi-month (annual) period accrues
 * the remaining monthly allowances on each anniversary. Idempotent per
 * invoice. Returns whether credits were granted.
 */
export async function grantProInvoice(
  userId: string,
  inv: Stripe.Invoice,
  subscriptionId: string,
): Promise<boolean> {
  // An invoice of a subscription we canceled and refunded as a duplicate (or
  // for a deleted account) never grants.
  if (
    (await hasBillingEvent("duplicate_subscription", subscriptionId)) ||
    (await hasBillingEvent("deleted_account_subscription", subscriptionId))
  ) {
    return false;
  }
  const period = await paidPeriodOfInvoice(inv);
  if (!period) return false;
  await grantCredits(
    userId,
    PRO_MONTHLY_CREDITS,
    "pro_monthly",
    `pro_grant:${inv.id}`,
  );
  // Move the allowance period forward only (a late invoice for an older
  // period must not rewind it), and only for the subscription we track.
  await prisma.subscription.updateMany({
    where: {
      userId,
      stripeSubscriptionId: subscriptionId,
      OR: [
        { allowancePeriodStart: null },
        { allowancePeriodStart: { lt: period.start } },
      ],
    },
    data: { allowancePeriodStart: period.start, allowancePeriodEnd: period.end },
  });
  return true;
}

// ---- Credit packs -----------------------------------------------------------

export type PackOutcome =
  | "granted"
  | "not_pack"
  | "unpaid"
  | "reversed"
  | "deleted_account";

/**
 * Grant a purchased credit pack once the money has actually arrived
 * (payment_status "paid": delayed methods such as bank debits complete later
 * via checkout.session.async_payment_succeeded). Idempotent per session.
 */
export async function grantCreditPack(
  userId: string,
  session: Stripe.Checkout.Session,
): Promise<PackOutcome> {
  if (session.mode !== "payment" || session.metadata?.kind !== "credits") {
    return "not_pack";
  }
  if (session.payment_status !== "paid") return "unpaid";
  const pi = stripeId(session.payment_intent);

  if (await isDeletedAccount(userId)) {
    // Paid after deleting the account (a checkout left open in another tab):
    // there is nobody to credit, so give the money back.
    if (pi) {
      const r = await refundPayment(pi, "requested_by_customer");
      await recordBillingEvent({
        userId,
        kind: "deleted_account_payment",
        stripeObjectId: session.id,
        paymentIntentId: pi,
        amountCents: r.amount,
        detail: r.ok ? null : `refund failed: ${r.error}`,
      });
    }
    return "deleted_account";
  }

  // Refunded or disputed before we ever granted it: never grant.
  if (pi) {
    const reversal = await prisma.billingEvent.findFirst({
      where: { paymentIntentId: pi, kind: { in: ["refund", "dispute"] } },
      select: { id: true },
    });
    if (reversal) return "reversed";
  }

  const amount = Number(session.metadata.credits) || CREDIT_PACK_SIZE;
  await grantCredits(
    userId,
    amount,
    "credit_purchase",
    `credit_purchase:${session.id}`,
  );
  return "granted";
}

// ---- Checkout ---------------------------------------------------------------

/**
 * The user's Stripe customer id, creating (and storing) one on first use so
 * every checkout — subscription or credit pack — lands on the same customer.
 * The idempotency key makes a double submit create one customer, not two.
 */
export async function ensureStripeCustomer(
  userId: string,
  email: string | null | undefined,
): Promise<string> {
  const row = await prisma.subscription.findUnique({ where: { userId } });
  if (row?.stripeCustomerId) return row.stripeCustomerId;

  const params: Stripe.CustomerCreateParams = {
    metadata: { userId },
    ...(email ? { email } : {}),
  };
  const opts = { idempotencyKey: `studyos-customer-${userId}` };
  let customer: Stripe.Customer;
  try {
    customer = await stripe.customers.create(params, opts);
  } catch (err) {
    // A concurrent request holding the same key: wait for it, then replay.
    if ((err as { type?: string })?.type !== "StripeIdempotencyError") throw err;
    await new Promise((r) => setTimeout(r, 750));
    customer = await stripe.customers.create(params, opts);
  }

  // Fill the slot only if still empty, then read back the winner.
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, stripeCustomerId: customer.id },
    update: {},
  });
  await prisma.subscription.updateMany({
    where: { userId, stripeCustomerId: null },
    data: { stripeCustomerId: customer.id },
  });
  const stored = await prisma.subscription.findUnique({ where: { userId } });
  return stored?.stripeCustomerId ?? customer.id;
}

export type ProCheckoutResult =
  | { url: string }
  | { blocked: "already_subscribed" };

/**
 * Start a Pro subscription checkout, unless the user already has a live
 * subscription (checked in our database AND on Stripe, since the webhook may
 * not have landed yet). Older open subscription checkouts for the same
 * customer are expired so two tabs cannot both complete.
 */
export async function createProCheckout(opts: {
  userId: string;
  email: string | null | undefined;
  priceId: string;
  origin: string;
}): Promise<ProCheckoutResult> {
  const { userId, priceId, origin } = opts;
  const row = await prisma.subscription.findUnique({ where: { userId } });
  if (row?.status === "active") {
    // Trust but verify: a missed cancellation webhook must not lock a
    // former subscriber out of resubscribing.
    const tracked = row.stripeSubscriptionId
      ? await retrieveSubscriptionOrNull(row.stripeSubscriptionId)
      : null;
    if (!tracked || ACTIVE_STATUSES.has(tracked.status)) {
      return { blocked: "already_subscribed" };
    }
    await applyLiveSubscription(userId, tracked);
  }

  const customer = await ensureStripeCustomer(userId, opts.email);
  const existing = await stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 100,
  });
  const live = existing.data.find((s) => !ENDED_STATUSES.has(s.status));
  if (live) {
    // Heal a missed webhook so the app shows Pro immediately.
    if (ACTIVE_STATUSES.has(live.status)) {
      await applyLiveSubscription(userId, live).catch(() => undefined);
    }
    return { blocked: "already_subscribed" };
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    subscription_data: { metadata: { userId } },
    metadata: { userId, kind: "pro" },
    allow_promotion_codes: true,
    success_url: `${origin}/app?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
  });

  await expireOlderSubscriptionCheckouts(customer, session).catch(
    () => undefined,
  );

  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return { url: session.url };
}

/**
 * Expire every open subscription checkout for this customer that is older
 * than `mine` (ties broken by id), so exactly one stays payable even when two
 * tabs start checkout at once.
 */
async function expireOlderSubscriptionCheckouts(
  customer: string,
  mine: Stripe.Checkout.Session,
): Promise<void> {
  const open = await stripe.checkout.sessions.list({
    customer,
    status: "open",
    limit: 100,
  });
  for (const s of open.data) {
    if (s.id === mine.id || s.mode !== "subscription") continue;
    const older =
      s.created < mine.created || (s.created === mine.created && s.id < mine.id);
    if (!older) continue;
    await stripe.checkout.sessions.expire(s.id).catch(() => undefined);
  }
}

/** Start a one-time credit pack checkout on the user's Stripe customer. */
export async function createCreditPackCheckout(opts: {
  userId: string;
  email: string | null | undefined;
  origin: string;
}): Promise<{ url: string }> {
  const { userId, origin } = opts;
  const customer = await ensureStripeCustomer(userId, opts.email);
  const metadata = {
    userId,
    kind: "credits",
    credits: String(CREDIT_PACK_SIZE),
  };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${CREDIT_PACK_SIZE.toLocaleString("en-US")} StudyOS credits`,
          },
          unit_amount: CREDIT_PACK_PRICE_USD * 100,
        },
        quantity: 1,
      },
    ],
    client_reference_id: userId,
    metadata,
    // Also on the PaymentIntent, so refunds/disputes are traceable to the pack.
    payment_intent_data: { metadata },
    success_url: `${origin}/app?credits=${CREDIT_PACK_SIZE}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/credits`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return { url: session.url };
}

// ---- Checkout success redirect ----------------------------------------------

/**
 * After Stripe Checkout returns, verify the session and apply its effect:
 *   - a subscription → apply the subscription's LIVE status (so replaying an
 *     old success URL after cancelling cannot restore Pro);
 *   - a credit pack → grant it only if paid.
 * Best-effort and idempotent (the webhook reconciles if this misses).
 */
export async function reconcileCheckoutSession(sessionId: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.client_reference_id !== userId) return;
    if (session.mode === "subscription") {
      const subId = stripeId(session.subscription);
      if (subId) await syncSubscription(userId, subId);
    } else if (session.mode === "payment") {
      await grantCreditPack(userId, session);
    }
  } catch {
    // The webhook will reconcile if this best-effort path fails.
  }
}

// ---- Account deletion -------------------------------------------------------

/**
 * Tombstone a deleted account (call AFTER its data is erased). Webhooks that
 * arrive later then neither recreate billing rows nor grant credits, and any
 * subscription or pack paid after deletion is canceled/refunded.
 */
export async function markAccountDeleted(userId: string): Promise<void> {
  await prisma.deletedAccount.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

/**
 * Stop all billing for a user before their account is deleted: cancel every
 * subscription that could still bill — the tracked one, every one on their
 * Stripe customer, and any other carrying their userId metadata (legacy
 * duplicates created on separate customers) — and expire open checkouts.
 * Throws when a cancellation fails for a reason other than "already gone",
 * so the caller can abort instead of orphaning live billing.
 */
export async function cancelAllBillingForUser(userId: string): Promise<void> {
  const row = await prisma.subscription.findUnique({ where: { userId } });
  const ids = new Set<string>();
  if (row?.stripeSubscriptionId) ids.add(row.stripeSubscriptionId);

  if (row?.stripeCustomerId) {
    const list = await stripe.subscriptions.list({
      customer: row.stripeCustomerId,
      status: "all",
      limit: 100,
    });
    for (const s of list.data) if (!ENDED_STATUSES.has(s.status)) ids.add(s.id);
  }

  // Clerk ids are [A-Za-z0-9_]; anything else is never interpolated.
  if (/^[A-Za-z0-9_]+$/.test(userId)) {
    try {
      const found = await stripe.subscriptions.search({
        query: `metadata['userId']:'${userId}'`,
        limit: 100,
      });
      for (const s of found.data) {
        if (!ENDED_STATUSES.has(s.status)) ids.add(s.id);
      }
    } catch {
      // Search is unavailable in some regions and lags ~1 minute; the
      // customer listing above already covers every checkout made since
      // customers were reused.
    }
  }

  for (const id of ids) {
    try {
      await stripe.subscriptions.cancel(id);
    } catch (err) {
      if (!isSubscriptionAlreadyGone(err)) throw err;
    }
  }

  if (row?.stripeCustomerId) {
    try {
      const open = await stripe.checkout.sessions.list({
        customer: row.stripeCustomerId,
        status: "open",
        limit: 100,
      });
      await Promise.allSettled(
        open.data.map((s) => stripe.checkout.sessions.expire(s.id)),
      );
    } catch {
      // Best effort: a checkout completed after deletion is refunded by the
      // webhook (the account is tombstoned).
    }
  }
}
