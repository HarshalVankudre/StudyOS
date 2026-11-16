import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakeDb, createFakeStripe } from "@/test/billing-fakes";

// Selling in the EU (lib/checkout-config.ts, lib/checkout-options.ts): what
// each setting does to the checkout sessions, and that granting and taking
// back a credit pack stay right with tax and with a Stripe-priced pack. The
// real webhook, billing and credits code, on the in-memory fakes.
const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  stripe: null as unknown as ReturnType<typeof createFakeStripe>,
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
vi.mock("@/lib/usage-limits", () => ({ recordFunnelEvent: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: h.authUser })) }));
vi.mock("@/lib/ops/report-error", () => ({ reportError: vi.fn() }));

import { POST } from "./route";
import { webhookRequest } from "@/test/billing-fakes";
import { createCreditPackCheckout, createProCheckout, packInfoFromSession, reconcileCheckoutSession } from "@/lib/billing";
import { invoiceConsentFooter, receiptConsentDescription, termsConsentMessage } from "@/lib/checkout-options";
import { CREDIT_PACK_PRICE_USD, CREDIT_PACK_SIZE, TRIAL_CREDITS } from "@/lib/credits";

const USER = "user_1";
const ORIGIN = "https://studyos.example";
const SETTINGS = ["STRIPE_AUTOMATIC_TAX", "STRIPE_TAX_BEHAVIOR", "STRIPE_PACK_INVOICES", "STRIPE_TERMS_CONSENT"];

const send = (type: string, object: unknown) => POST(webhookRequest({ type, data: { object } }));
const sessionIdOf = (url: string) => url.split("/").pop()!;
const purchases = () => h.db.ledgerFor(USER).filter((l) => l.reason === "credit_purchase");

/** The parameters of every checkout session created, in order. */
function captureSessions() {
  const create = vi.spyOn(h.stripe.stripe.checkout.sessions, "create");
  return () => create.mock.calls.map((call) => call[0] as Record<string, unknown>);
}

function settings(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

/** A Stripe one-time Price for the pack (setPrice defaults to a monthly one). */
function packPrice(id: string, over: Record<string, unknown> = {}) {
  h.stripe.setPrice(id, { type: "one_time", recurring: null, ...over });
}

async function buyPack(opts: { priceId?: string; amountTotal?: number } = {}) {
  const { url } = await createCreditPackCheckout({ userId: USER, email: "a@b.c", origin: ORIGIN, priceId: opts.priceId });
  return h.stripe.completePackCheckout(sessionIdOf(url), { amountTotal: opts.amountTotal });
}

beforeEach(() => {
  h.db.reset();
  h.stripe.reset();
  h.authUser = null;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  settings(Object.fromEntries(SETTINGS.map((name) => [name, ""])));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// What the two checkouts sent before these settings existed.
const proParams = (customer: string) => ({
  mode: "subscription",
  customer,
  line_items: [{ price: "price_month", quantity: 1 }],
  client_reference_id: USER,
  subscription_data: { metadata: { userId: USER } },
  metadata: { userId: USER, kind: "pro" },
  allow_promotion_codes: true,
  success_url: `${ORIGIN}/app?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${ORIGIN}/pricing`,
});
const packMetadata = { userId: USER, kind: "credits", credits: String(CREDIT_PACK_SIZE) };
const packParams = (customer: string) => ({
  mode: "payment",
  customer,
  line_items: [
    {
      price_data: {
        currency: "usd",
        product_data: { name: `${CREDIT_PACK_SIZE.toLocaleString("en-US")} StudyOS credits` },
        unit_amount: CREDIT_PACK_PRICE_USD * 100,
      },
      quantity: 1,
    },
  ],
  client_reference_id: USER,
  metadata: packMetadata,
  payment_intent_data: { metadata: packMetadata },
  success_url: `${ORIGIN}/app?credits=${CREDIT_PACK_SIZE}&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${ORIGIN}/app/credits`,
});
const TAX = {
  automatic_tax: { enabled: true },
  customer_update: { address: "auto", name: "auto" },
  billing_address_collection: "required",
  tax_id_collection: { enabled: true },
};

describe("checkout session parameters", () => {
  async function bothCheckouts(opts: { locale?: "de" | "ar"; packPriceId?: string } = {}) {
    const sessions = captureSessions();
    const pro = await createProCheckout({ userId: USER, email: "a@b.c", priceId: "price_month", origin: ORIGIN, locale: opts.locale });
    if (!("url" in pro)) throw new Error("blocked");
    await createCreditPackCheckout({ userId: USER, email: "a@b.c", origin: ORIGIN, locale: opts.locale, priceId: opts.packPriceId });
    const [proSent, packSent] = sessions();
    const customer = proSent.customer as string;
    return { proSent, packSent, customer };
  }

  it("every setting off and no language: exactly the parameters sent before", async () => {
    const { proSent, packSent, customer } = await bothCheckouts();
    expect(proSent).toStrictEqual(proParams(customer));
    expect(packSent).toStrictEqual(packParams(customer));
  });

  it("STRIPE_TAX_BEHAVIOR alone changes nothing while Stripe Tax is off", async () => {
    settings({ STRIPE_TAX_BEHAVIOR: "exclusive" });
    const { proSent, packSent, customer } = await bothCheckouts();
    expect(proSent).toStrictEqual(proParams(customer));
    expect(packSent).toStrictEqual(packParams(customer));
  });

  it("the student's language is Checkout's language (Arabic: auto)", async () => {
    let sent = await bothCheckouts({ locale: "de" });
    expect(sent.proSent).toStrictEqual({ ...proParams(sent.customer), locale: "de" });
    expect(sent.packSent).toStrictEqual({ ...packParams(sent.customer), locale: "de" });
    h.db.reset();
    h.stripe.reset();
    vi.restoreAllMocks();
    sent = await bothCheckouts({ locale: "ar" });
    expect(sent.proSent.locale).toBe("auto");
    expect(sent.packSent.locale).toBe("auto");
  });

  it("STRIPE_AUTOMATIC_TAX: Stripe Tax on both; the inline pack price is tax-inclusive by default", async () => {
    settings({ STRIPE_AUTOMATIC_TAX: "1" });
    const { proSent, packSent, customer } = await bothCheckouts();
    expect(proSent).toStrictEqual({ ...proParams(customer), ...TAX });
    const pack = packParams(customer);
    expect(packSent).toStrictEqual({
      ...pack,
      ...TAX,
      line_items: [{ ...pack.line_items[0], price_data: { ...pack.line_items[0].price_data, tax_behavior: "inclusive" } }],
    });
  });

  it("STRIPE_TAX_BEHAVIOR=exclusive: the inline pack price is tax-exclusive", async () => {
    settings({ STRIPE_AUTOMATIC_TAX: "1", STRIPE_TAX_BEHAVIOR: "exclusive" });
    const { packSent } = await bothCheckouts();
    expect((packSent.line_items as { price_data: { tax_behavior: string } }[])[0].price_data.tax_behavior).toBe("exclusive");
  });

  it("STRIPE_PACK_INVOICES: an invoice for the pack only", async () => {
    settings({ STRIPE_PACK_INVOICES: "1" });
    const { proSent, packSent, customer } = await bothCheckouts();
    expect(proSent).toStrictEqual(proParams(customer));
    expect(packSent).toStrictEqual({ ...packParams(customer), invoice_creation: { enabled: true } });
  });

  it("STRIPE_TERMS_CONSENT: a required Terms checkbox with each checkout's own text, in the student's language", async () => {
    settings({ STRIPE_TERMS_CONSENT: "1" });
    const { proSent, packSent, customer } = await bothCheckouts({ locale: "de" });
    const consent = (kind: "pro" | "credits") => ({
      consent_collection: { terms_of_service: "required" },
      custom_text: { terms_of_service_acceptance: { message: termsConsentMessage(kind, "de", ORIGIN) } },
    });
    expect(proSent).toStrictEqual({ ...proParams(customer), locale: "de", ...consent("pro") });
    expect(packSent).toStrictEqual({
      ...packParams(customer),
      locale: "de",
      ...consent("credits"),
      // The durable confirmation, without STRIPE_PACK_INVOICES: the invoice
      // footer, and the receipt's description merged with the pack metadata.
      invoice_creation: { enabled: true, invoice_data: { footer: invoiceConsentFooter("de", ORIGIN) } },
      payment_intent_data: { description: receiptConsentDescription("de", ORIGIN), metadata: packMetadata },
    });
    expect(JSON.stringify(packSent.custom_text)).toContain(`[Nutzungsbedingungen](${ORIGIN}/terms)`);
  });

  it("the consent confirmation never replaces the pack's metadata, so refunds and disputes stay traceable", async () => {
    settings({ STRIPE_TERMS_CONSENT: "yes", STRIPE_PACK_INVOICES: "1" });
    const { packSent } = await bothCheckouts();
    expect(packSent.payment_intent_data).toStrictEqual({
      description: receiptConsentDescription("en", ORIGIN),
      metadata: packMetadata,
    });
    const { session, chargeId } = await buyPack();
    await send("checkout.session.completed", session);
    await send("charge.refunded", h.stripe.refundCharge(chargeId));
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS);
  });

  it("everything on together", async () => {
    settings({ STRIPE_AUTOMATIC_TAX: "1", STRIPE_TAX_BEHAVIOR: "exclusive", STRIPE_PACK_INVOICES: "1", STRIPE_TERMS_CONSENT: "1" });
    const { proSent, packSent } = await bothCheckouts({ locale: "de" });
    expect(Object.keys(proSent).sort()).toEqual(
      [...Object.keys(proParams("c")), "locale", ...Object.keys(TAX), "consent_collection", "custom_text"].sort(),
    );
    expect(Object.keys(packSent).sort()).toEqual(
      [...Object.keys(packParams("c")), "locale", ...Object.keys(TAX), "invoice_creation", "consent_collection", "custom_text"].sort(),
    );
  });

  it("a Stripe pack price replaces the inline USD price and nothing else (no inline tax behavior)", async () => {
    packPrice("price_pack_eur", { currency: "eur", unit_amount: 999 });
    let sent = await bothCheckouts({ packPriceId: "price_pack_eur" });
    expect(sent.packSent).toStrictEqual({ ...packParams(sent.customer), line_items: [{ price: "price_pack_eur", quantity: 1 }] });
    h.db.reset();
    h.stripe.reset();
    vi.restoreAllMocks();
    settings({ STRIPE_AUTOMATIC_TAX: "1" });
    packPrice("price_pack_eur", { currency: "eur", unit_amount: 999 });
    sent = await bothCheckouts({ packPriceId: "price_pack_eur" });
    expect(sent.packSent.line_items).toStrictEqual([{ price: "price_pack_eur", quantity: 1 }]);
    expect(sent.packSent.automatic_tax).toEqual({ enabled: true });
  });
});

describe("granting a pack with tax and with a Stripe price", () => {
  it("exclusive tax: the total is above the list price, and the pack is granted exactly once", async () => {
    settings({ STRIPE_AUTOMATIC_TAX: "1", STRIPE_TAX_BEHAVIOR: "exclusive" });
    // 19% German VAT on top of the list price.
    const total = Math.round(CREDIT_PACK_PRICE_USD * 100 * 1.19);
    const { session } = await buyPack({ amountTotal: total });
    expect(session.amount_total).toBeGreaterThan(CREDIT_PACK_PRICE_USD * 100);
    await send("checkout.session.completed", session);
    await send("checkout.session.completed", session);
    await send("checkout.session.async_payment_succeeded", session);
    h.authUser = USER;
    await reconcileCheckoutSession(session.id); // the success redirect
    expect(purchases()).toEqual([expect.objectContaining({ delta: CREDIT_PACK_SIZE })]);
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE);
  });

  it("a Stripe price in EUR is granted like the USD pack", async () => {
    packPrice("price_pack_eur", { currency: "eur", unit_amount: 999 });
    const { session } = await buyPack({ priceId: "price_pack_eur" });
    expect(session).toMatchObject({ currency: "eur", amount_total: 999 });
    await send("checkout.session.completed", session);
    await send("checkout.session.completed", session);
    expect(purchases()).toEqual([expect.objectContaining({ delta: CREDIT_PACK_SIZE })]);
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE);
  });

  it("what is granted depends on our metadata, never on the amount: another payment on the account grants nothing", async () => {
    // A one-off payment made outside StudyOS's checkout (e.g. a payment link
    // on the same Stripe account), for the same user and the pack's amount.
    const foreign = {
      id: "cs_foreign",
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      client_reference_id: USER,
      metadata: {},
      amount_total: CREDIT_PACK_PRICE_USD * 100,
      currency: "usd",
      payment_intent: "pi_foreign",
    };
    await send("checkout.session.completed", foreign);
    expect(purchases()).toHaveLength(0);
  });

  it("the pack's invoice (STRIPE_PACK_INVOICES) pays for no subscription and grants nothing more", async () => {
    settings({ STRIPE_PACK_INVOICES: "1" });
    const { session } = await buyPack();
    await send("checkout.session.completed", session);
    const res = await send("invoice.paid", {
      id: "in_pack",
      object: "invoice",
      customer: session.customer,
      parent: null,
      total: session.amount_total,
      amount_paid: session.amount_total,
    });
    expect(res.status).toBe(200);
    expect(purchases()).toHaveLength(1);
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE);
  });
});

describe("taking back a taxed pack", () => {
  const TOTAL = Math.round(CREDIT_PACK_PRICE_USD * 100 * 1.19); // list price + 19% VAT

  async function taxedPack() {
    settings({ STRIPE_AUTOMATIC_TAX: "1", STRIPE_TAX_BEHAVIOR: "exclusive" });
    const bought = await buyPack({ amountTotal: TOTAL });
    await send("checkout.session.completed", bought.session);
    return bought;
  }

  it("a refund takes the share of the pack it is of the total charged, tax included", async () => {
    const { chargeId } = await taxedPack();
    // Half the charged total back: half the pack.
    await send("charge.refunded", h.stripe.refundCharge(chargeId, TOTAL / 2));
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE / 2);
    // A refund of the pre-tax list price is not the whole payment, so not the whole pack.
    await send("charge.refunded", h.stripe.refundCharge(chargeId, CREDIT_PACK_PRICE_USD * 100 - TOTAL / 2));
    const taken = Math.floor((CREDIT_PACK_SIZE * CREDIT_PACK_PRICE_USD * 100) / TOTAL);
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE - taken);
    expect(h.db.balance(USER)).toBeGreaterThan(TRIAL_CREDITS);
    // The rest (the VAT) back too: the whole pack.
    await send("charge.refunded", h.stripe.refundCharge(chargeId));
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS);
    expect(h.db.ledgerSum(USER)).toBe(h.db.balance(USER));
  });

  it("a dispute of the charged total takes the whole pack; won, it is given back", async () => {
    const { chargeId } = await taxedPack();
    const dispute = h.stripe.dispute(chargeId, { id: "dp_tax" });
    expect(dispute.amount).toBe(TOTAL);
    await send("charge.dispute.created", dispute);
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS);
    await send("charge.dispute.closed", { ...dispute, status: "won" });
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE);
  });

  it("a refund of a EUR-priced pack is measured in the same currency and total", async () => {
    packPrice("price_pack_eur", { currency: "eur", unit_amount: 999 });
    const { session, chargeId } = await buyPack({ priceId: "price_pack_eur" });
    await send("checkout.session.completed", session);
    await send("charge.refunded", h.stripe.refundCharge(chargeId, 333));
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE - Math.floor((CREDIT_PACK_SIZE * 333) / 999));
  });
});

describe("a dispute's currency and amount", () => {
  const share = (cents: number, total: number) => Math.floor((CREDIT_PACK_SIZE * cents) / total);

  it("a dispute in another currency than the pack's total takes the whole pack; won, all of it comes back", async () => {
    packPrice("price_pack_eur", { currency: "eur", unit_amount: 999 });
    const { session, chargeId } = await buyPack({ priceId: "price_pack_eur" });
    await send("checkout.session.completed", session);
    // Stated in another currency: its 500 cannot be compared with the EUR 9.99.
    const dispute = h.stripe.dispute(chargeId, { amount: 500, currency: "usd" });
    await send("charge.dispute.created", dispute);
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS);
    await send("charge.dispute.closed", { ...dispute, status: "won" });
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE);
    expect(h.db.ledgerSum(USER)).toBe(h.db.balance(USER));
  });

  it("a dispute of at least 98% of the charged total takes the whole pack; less takes its share", async () => {
    const total = CREDIT_PACK_PRICE_USD * 100;
    let bought = await buyPack();
    await send("checkout.session.completed", bought.session);
    await send("charge.dispute.created", h.stripe.dispute(bought.chargeId, { amount: Math.ceil(total * 0.98) }));
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS);

    h.db.reset();
    h.stripe.reset();
    bought = await buyPack();
    await send("checkout.session.completed", bought.session);
    const below = Math.floor(total * 0.97);
    await send("charge.dispute.created", h.stripe.dispute(bought.chargeId, { amount: below }));
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE - share(below, total));
  });

  it("a dispute in the pack's own currency is measured against its total, as before", async () => {
    packPrice("price_pack_eur", { currency: "eur", unit_amount: 999 });
    const { session, chargeId } = await buyPack({ priceId: "price_pack_eur" });
    await send("checkout.session.completed", session);
    await send("charge.dispute.created", h.stripe.dispute(chargeId, { amount: 333, currency: "eur" }));
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE - share(333, 999));
  });

  it("an older Adaptive Pricing session (currency_conversion) is measured in the price's currency, by the grant and the reversals alike", async () => {
    packPrice("price_pack_eur", { currency: "eur", unit_amount: 999 });
    const { session, chargeId } = await buyPack({ priceId: "price_pack_eur" });
    // The pre-2025-03-31 shape: the buyer's currency at the top level, the
    // price's in currency_conversion (the webhook and the SDK read alike here).
    const stored = h.stripe.state.sessions.get(session.id)!;
    Object.assign(stored, {
      amount_total: 1100,
      currency: "usd",
      currency_conversion: { amount_subtotal: 999, amount_total: 999, fx_rate: "1.101", source_currency: "eur" },
    });
    await send("checkout.session.completed", { ...stored });
    expect(purchases()).toEqual([expect.objectContaining({ delta: CREDIT_PACK_SIZE })]);
    await send("charge.refunded", h.stripe.refundCharge(chargeId, 333));
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS + CREDIT_PACK_SIZE - share(333, 999));
    // A dispute of the rest, in the price's currency, takes what is left.
    await send("charge.dispute.created", h.stripe.dispute(chargeId, { amount: 666, currency: "eur" }));
    expect(h.db.balance(USER)).toBe(TRIAL_CREDITS);
  });

  it("packInfoFromSession prefers currency_conversion and falls back to the session's total", () => {
    const base = { id: "cs_1", metadata: { credits: "1000" } };
    expect(
      packInfoFromSession(USER, { ...base, amount_total: 1100, currency: "usd", currency_conversion: { amount_total: 999, source_currency: "EUR" } } as never),
    ).toMatchObject({ amountCents: 999, currency: "eur", credits: 1000 });
    expect(packInfoFromSession(USER, { ...base, amount_total: 1190, currency: "usd", currency_conversion: null } as never)).toMatchObject({
      amountCents: 1190,
      currency: "usd",
    });
    expect(packInfoFromSession(USER, { ...base, amount_total: null, currency: null } as never)).toMatchObject({
      amountCents: CREDIT_PACK_PRICE_USD * 100,
      currency: "usd",
    });
  });
});
