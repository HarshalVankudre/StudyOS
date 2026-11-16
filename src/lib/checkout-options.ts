/**
 * What StudyOS's Stripe Checkout sessions get from the EU selling settings
 * (lib/checkout-config.ts): Stripe Tax, the credit pack's invoice and the
 * required Terms checkbox, plus the checkout language, which always follows
 * the student's app language (it needs no setup on Stripe; Arabic, which
 * Checkout does not offer, is "auto": the browser's language).
 *
 * With every setting off and no language given, nothing is added: the
 * sessions are exactly what they were before these settings existed.
 * Server-side (it reads the dictionaries for the consent text).
 */
import type Stripe from "stripe";
import { checkoutConfig } from "@/lib/checkout-config";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";

type Env = Record<string, string | undefined>;
type SessionParams = Stripe.Checkout.SessionCreateParams;
type StripeLocale = Stripe.Checkout.SessionCreateParams.Locale;

/** Which checkout a session is for. */
export type CheckoutKind = "pro" | "credits";

/** Stripe Checkout's language for each app language. */
const STRIPE_LOCALES: Record<Locale, StripeLocale> = {
  en: "en",
  es: "es",
  de: "de",
  fr: "fr",
  it: "it",
  // The app's Portuguese is Brazilian ("você", "arquivo").
  pt: "pt-BR",
  nl: "nl",
  // Simplified Chinese (zh-HK and zh-TW are Traditional).
  zh: "zh",
  ja: "ja",
  // Checkout has no Arabic: Stripe picks from the browser's language.
  ar: "auto",
};

export function stripeCheckoutLocale(locale: Locale): StripeLocale {
  return STRIPE_LOCALES[locale] ?? "auto";
}

/** Stripe's limit for custom_text.terms_of_service_acceptance.message. */
export const TERMS_MESSAGE_MAX_CHARS = 1200;

/**
 * The text beside Checkout's Terms checkbox (Markdown, linking the Terms
 * page), in the student's language: they agree to the Terms and ask for
 * immediate performance. For a credit pack, an EU/UK consumer's right of
 * withdrawal ends once the credits are added to the balance; for Pro,
 * withdrawing within 14 days means paying for the share already provided,
 * and the right ends once the service has been fully provided.
 */
export function termsConsentMessage(kind: CheckoutKind, locale: Locale, origin: string): string {
  const text = getDictionary(locale).checkout;
  return fmt(kind === "pro" ? text.termsPro : text.termsPack, { terms: `${origin}/terms` });
}

/**
 * The credit pack invoice's footer when the Terms checkbox is on: a plain-text
 * confirmation of the consent and the acknowledgment, in the student's
 * language (Stripe invoice footers take no Markdown).
 */
export function invoiceConsentFooter(locale: Locale, origin: string): string {
  return fmt(getDictionary(locale).checkout.invoiceConsentPack, { terms: `${origin}/terms` });
}

/** Stripe's limit for a PaymentIntent's description. */
export const PAYMENT_DESCRIPTION_MAX_CHARS = 1000;

/**
 * The credit pack payment's description when the Terms checkbox is on: a
 * short plain-text confirmation of the consent, in the student's language.
 * Stripe prints it on the payment's receipt email.
 */
export function receiptConsentDescription(locale: Locale, origin: string): string {
  return fmt(getDictionary(locale).checkout.receiptConsentPack, { terms: `${origin}/terms` });
}

/**
 * The session parameters the settings (and the language) add to a checkout of
 * `kind`. A `payment_intent_data` in them is to be MERGED with the caller's own
 * (lib/billing.ts createCreditPackCheckout), never spread over it.
 */
export function checkoutSessionExtras(
  kind: CheckoutKind,
  opts: { origin: string; locale?: Locale; env?: Env },
): Partial<SessionParams> {
  const config = checkoutConfig(opts.env);
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const extras: Partial<SessionParams> = {};
  if (opts.locale) extras.locale = stripeCheckoutLocale(opts.locale);
  if (config.automaticTax) {
    extras.automatic_tax = { enabled: true };
    // Required with an existing customer: Checkout saves the address (where
    // the tax is due) and the name (shown with a VAT ID) to it.
    extras.customer_update = { address: "auto", name: "auto" };
    // The buyer's location for VAT, even when the card would not need it.
    extras.billing_address_collection = "required";
    extras.tax_id_collection = { enabled: true };
  }
  if (kind === "credits" && config.termsConsent) {
    // The confirmation on a durable medium that the withdrawal waiver needs
    // (in Germany, § 356 (5) BGB), whatever STRIPE_PACK_INVOICES says: the
    // invoice PDF repeats what the buyer agreed to at the checkbox, and the
    // payment's description puts a short version on Stripe's receipt. Both
    // reach the buyer only while Stripe's customer emails for successful
    // payments are on (the startup check reminds the owner, lib/ops/env.ts).
    extras.invoice_creation = {
      enabled: true,
      invoice_data: { footer: invoiceConsentFooter(locale, opts.origin) },
    };
    extras.payment_intent_data = { description: receiptConsentDescription(locale, opts.origin) };
  } else if (kind === "credits" && config.packInvoices) {
    extras.invoice_creation = { enabled: true };
  }
  if (config.termsConsent) {
    extras.consent_collection = { terms_of_service: "required" };
    extras.custom_text = {
      terms_of_service_acceptance: {
        message: termsConsentMessage(kind, locale, opts.origin),
      },
    };
  }
  return extras;
}
