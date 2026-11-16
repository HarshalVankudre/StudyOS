/**
 * The settings that prepare StudyOS's Stripe Checkout for selling in the EU
 * (and anywhere else). Each is off until the owner sets it, once the Stripe
 * account is set up for it, so nothing changes for an account that is not:
 *
 *   STRIPE_AUTOMATIC_TAX=1   Stripe Tax on both checkouts: tax from the buyer's
 *                            billing address (always collected), saved to the
 *                            customer; businesses can enter a VAT ID (Stripe
 *                            Tax applies the reverse charge).
 *   STRIPE_TAX_BEHAVIOR      "inclusive" (default) or "exclusive": whether the
 *                            credit pack's inline price includes tax, and what
 *                            the pricing pages say about VAT. Stripe Prices
 *                            (Pro, a Stripe-priced pack) must come out the
 *                            same way (their own tax behavior, else the Stripe
 *                            Tax default): one that does not, or cannot be
 *                            told, is not offered (lib/plan-pricing.ts).
 *   STRIPE_PACK_INVOICES=1   an invoice (PDF, with the tax on it) for each
 *                            credit pack; subscriptions always produce invoices.
 *                            (With STRIPE_TERMS_CONSENT on, packs get one anyway.)
 *   STRIPE_TERMS_CONSENT=1   a required checkbox: the buyer agrees to the Terms
 *                            and asks for immediate performance, acknowledging
 *                            what that means for the EU/UK right of withdrawal.
 *                            For a credit pack the confirmation of it is sent
 *                            on a durable medium: the pack's invoice (always
 *                            created then) repeats it, and so does the receipt.
 *
 * The three switches read 1, true, yes or on (any case) as on, and 0, false,
 * no, off or nothing as off. Anything else is off too, and the startup check
 * (lib/ops/env.ts) names the variable, so a typo never goes unnoticed.
 *
 * What the checkout sessions get from them is in lib/checkout-options.ts.
 * This module only reads the environment (no dictionaries), so the startup
 * check (lib/ops/env.ts) and client-safe code can use it.
 */
type Env = Record<string, string | undefined>;

/** Whether a price includes tax (Stripe's `tax_behavior`). */
export type TaxBehavior = "inclusive" | "exclusive";

export interface CheckoutConfig {
  /** STRIPE_AUTOMATIC_TAX: Stripe Tax on both checkouts. */
  automaticTax: boolean;
  /** STRIPE_TAX_BEHAVIOR (default inclusive, the EU consumer norm: the price shown is the price paid). */
  taxBehavior: TaxBehavior;
  /** STRIPE_PACK_INVOICES: an invoice for each credit pack. */
  packInvoices: boolean;
  /** STRIPE_TERMS_CONSENT: the required Terms checkbox with the withdrawal text. */
  termsConsent: boolean;
}

/** The on/off settings of this module. */
export const CHECKOUT_SWITCHES = ["STRIPE_AUTOMATIC_TAX", "STRIPE_PACK_INVOICES", "STRIPE_TERMS_CONSENT"] as const;

const ON_WORDS = new Set(["1", "true", "yes", "on"]);
const OFF_WORDS = new Set(["", "0", "false", "no", "off"]);

/** A switch's value: true (on), false (off or unset), or null (neither: treated as off). */
export function parseSwitch(raw: string | undefined): boolean | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (ON_WORDS.has(value)) return true;
  if (OFF_WORDS.has(value)) return false;
  return null;
}

const isOn = (env: Env, name: string) => parseSwitch(env[name]) === true;

/** The switches set to a value that is neither on nor off (they are off), for the startup warning. */
export function unreadableSwitches(env: Env = process.env): string[] {
  return CHECKOUT_SWITCHES.filter((name) => parseSwitch(env[name]) === null);
}

/** Is STRIPE_TAX_BEHAVIOR unset or one of the two values it can take? */
export function isValidTaxBehavior(raw: string | undefined): boolean {
  const value = raw?.trim();
  return !value || value === "inclusive" || value === "exclusive";
}

export function checkoutConfig(env: Env = process.env): CheckoutConfig {
  return {
    automaticTax: isOn(env, "STRIPE_AUTOMATIC_TAX"),
    taxBehavior: env.STRIPE_TAX_BEHAVIOR?.trim() === "exclusive" ? "exclusive" : "inclusive",
    packInvoices: isOn(env, "STRIPE_PACK_INVOICES"),
    termsConsent: isOn(env, "STRIPE_TERMS_CONSENT"),
  };
}

/**
 * How tax relates to the prices StudyOS shows and charges: "inclusive" (they
 * include VAT where it applies), "exclusive" (VAT is added at checkout), or
 * null while Stripe Tax is off (no tax is charged, so nothing is said). The
 * pricing pages state it; the credit pack's inline price is created with it.
 */
export function pricesTaxBehavior(env: Env = process.env): TaxBehavior | null {
  const config = checkoutConfig(env);
  return config.automaticTax ? config.taxBehavior : null;
}
