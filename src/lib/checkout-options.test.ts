import { describe, expect, it } from "vitest";
import { checkoutConfig, isValidTaxBehavior, parseSwitch, pricesTaxBehavior, unreadableSwitches } from "./checkout-config";
import {
  checkoutSessionExtras,
  invoiceConsentFooter,
  PAYMENT_DESCRIPTION_MAX_CHARS,
  receiptConsentDescription,
  stripeCheckoutLocale,
  TERMS_MESSAGE_MAX_CHARS,
  termsConsentMessage,
} from "./checkout-options";
import { LOCALES } from "./i18n/config";
import { getDictionary } from "./i18n/dictionaries";

const ORIGIN = "https://studyos.example";
const ALL_ON = {
  STRIPE_AUTOMATIC_TAX: "1",
  STRIPE_PACK_INVOICES: "1",
  STRIPE_TERMS_CONSENT: "1",
};

describe("checkout settings", () => {
  it("are all off by default, with inclusive tax", () => {
    expect(checkoutConfig({})).toEqual({
      automaticTax: false,
      taxBehavior: "inclusive",
      packInvoices: false,
      termsConsent: false,
    });
    expect(pricesTaxBehavior({})).toBeNull();
  });

  it("switch on with 1, true, yes or on and off with 0, false, no, off or nothing, in any case and spacing", () => {
    expect(checkoutConfig({ ...ALL_ON, STRIPE_TAX_BEHAVIOR: "exclusive" })).toEqual({
      automaticTax: true,
      taxBehavior: "exclusive",
      packInvoices: true,
      termsConsent: true,
    });
    for (const on of ["1", "true", "yes", "on", " TRUE ", "Yes", "ON\n"]) {
      expect(checkoutConfig({ STRIPE_AUTOMATIC_TAX: on }).automaticTax, JSON.stringify(on)).toBe(true);
      expect(parseSwitch(on)).toBe(true);
    }
    for (const off of [undefined, "", "  ", "0", "false", "no", "off", " False ", "NO"]) {
      expect(checkoutConfig({ STRIPE_AUTOMATIC_TAX: off }).automaticTax, JSON.stringify(off)).toBe(false);
      expect(parseSwitch(off)).toBe(false);
    }
  });

  it("anything else is off too, and is named for the startup warning", () => {
    for (const odd of ["2", "enabled", "tru", "y", "on1"]) {
      expect(parseSwitch(odd), odd).toBeNull();
      expect(checkoutConfig({ STRIPE_TERMS_CONSENT: odd }).termsConsent).toBe(false);
    }
    expect(unreadableSwitches({})).toEqual([]);
    expect(unreadableSwitches({ ...ALL_ON, STRIPE_AUTOMATIC_TAX: "Yes" })).toEqual([]);
    expect(
      unreadableSwitches({ STRIPE_AUTOMATIC_TAX: "enabled", STRIPE_PACK_INVOICES: "0", STRIPE_TERMS_CONSENT: "y" }),
    ).toEqual(["STRIPE_AUTOMATIC_TAX", "STRIPE_TERMS_CONSENT"]);
  });

  it("state the tax behavior only while Stripe Tax is on; anything but exclusive is inclusive", () => {
    expect(pricesTaxBehavior({ STRIPE_TAX_BEHAVIOR: "exclusive" })).toBeNull();
    expect(pricesTaxBehavior({ STRIPE_AUTOMATIC_TAX: "1" })).toBe("inclusive");
    expect(pricesTaxBehavior({ STRIPE_AUTOMATIC_TAX: "1", STRIPE_TAX_BEHAVIOR: " exclusive " })).toBe("exclusive");
    expect(pricesTaxBehavior({ STRIPE_AUTOMATIC_TAX: "1", STRIPE_TAX_BEHAVIOR: "exclusiv" })).toBe("inclusive");
    expect(isValidTaxBehavior(undefined)).toBe(true);
    expect(isValidTaxBehavior("")).toBe(true);
    expect(isValidTaxBehavior("inclusive")).toBe(true);
    expect(isValidTaxBehavior("exclusive")).toBe(true);
    expect(isValidTaxBehavior("exclusiv")).toBe(false);
  });
});

describe("checkout language", () => {
  it("follows the app language; Arabic, which Checkout lacks, is auto", () => {
    expect(Object.fromEntries(LOCALES.map((l) => [l.code, stripeCheckoutLocale(l.code)]))).toEqual({
      en: "en",
      es: "es",
      de: "de",
      fr: "fr",
      it: "it",
      pt: "pt-BR",
      nl: "nl",
      zh: "zh",
      ja: "ja",
      ar: "auto",
    });
  });
});

describe("checkout session extras", () => {
  it("add nothing with every setting off and no language", () => {
    expect(checkoutSessionExtras("pro", { origin: ORIGIN, env: {} })).toStrictEqual({});
    expect(checkoutSessionExtras("credits", { origin: ORIGIN, env: {} })).toStrictEqual({});
  });

  it("add only the language when a language is given", () => {
    expect(checkoutSessionExtras("credits", { origin: ORIGIN, locale: "de", env: {} })).toStrictEqual({ locale: "de" });
  });

  it("Stripe Tax: automatic tax, a required address saved to the customer, VAT IDs", () => {
    const tax = {
      automatic_tax: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
    };
    const env = { STRIPE_AUTOMATIC_TAX: "1" };
    expect(checkoutSessionExtras("pro", { origin: ORIGIN, env })).toStrictEqual(tax);
    expect(checkoutSessionExtras("credits", { origin: ORIGIN, env })).toStrictEqual(tax);
  });

  it("pack invoices only on the credit pack (subscriptions invoice anyway)", () => {
    const env = { STRIPE_PACK_INVOICES: "1" };
    expect(checkoutSessionExtras("credits", { origin: ORIGIN, env })).toStrictEqual({ invoice_creation: { enabled: true } });
    expect(checkoutSessionExtras("pro", { origin: ORIGIN, env })).toStrictEqual({});
  });

  it("with the Terms checkbox on too, the pack invoice confirms the consent (the durable-medium copy)", () => {
    const env = { STRIPE_PACK_INVOICES: "1", STRIPE_TERMS_CONSENT: "1" };
    const extras = checkoutSessionExtras("credits", { origin: ORIGIN, locale: "de", env });
    expect(extras.invoice_creation).toStrictEqual({
      enabled: true,
      invoice_data: { footer: invoiceConsentFooter("de", ORIGIN) },
    });
    expect(invoiceConsentFooter("de", ORIGIN)).toContain(`${ORIGIN}/terms`);
    expect(invoiceConsentFooter("en", ORIGIN)).toMatch(/lose your right of withdrawal once they have been added/);
    for (const { code } of LOCALES) {
      const footer = invoiceConsentFooter(code, ORIGIN);
      expect(footer, code).not.toMatch(/\{[a-zA-Z]+\}|\]\(/);
      expect(footer.length, code).toBeLessThanOrEqual(5000);
    }
    // Pro has no checkout-level invoice footer (subscriptions invoice anyway).
    expect(checkoutSessionExtras("pro", { origin: ORIGIN, env }).invoice_creation).toBeUndefined();
  });

  it("terms consent: a required checkbox with the text for that checkout, in the student's language", () => {
    const env = { STRIPE_TERMS_CONSENT: "1" };
    expect(checkoutSessionExtras("credits", { origin: ORIGIN, locale: "fr", env })).toStrictEqual({
      locale: "fr",
      invoice_creation: { enabled: true, invoice_data: { footer: invoiceConsentFooter("fr", ORIGIN) } },
      payment_intent_data: { description: receiptConsentDescription("fr", ORIGIN) },
      consent_collection: { terms_of_service: "required" },
      custom_text: { terms_of_service_acceptance: { message: termsConsentMessage("credits", "fr", ORIGIN) } },
    });
    // No language given: English. Pro gets the checkbox only (its invoices are the subscription's).
    expect(checkoutSessionExtras("pro", { origin: ORIGIN, env })).toStrictEqual({
      consent_collection: { terms_of_service: "required" },
      custom_text: { terms_of_service_acceptance: { message: termsConsentMessage("pro", "en", ORIGIN) } },
    });
  });

  it("terms consent always gives the pack its durable confirmation: the invoice footer and the receipt's description, with or without STRIPE_PACK_INVOICES", () => {
    for (const packInvoices of ["", "0", "1"]) {
      const env = { STRIPE_TERMS_CONSENT: "1", STRIPE_PACK_INVOICES: packInvoices };
      const extras = checkoutSessionExtras("credits", { origin: ORIGIN, locale: "de", env });
      expect(extras.invoice_creation, packInvoices).toStrictEqual({
        enabled: true,
        invoice_data: { footer: invoiceConsentFooter("de", ORIGIN) },
      });
      expect(extras.payment_intent_data, packInvoices).toStrictEqual({ description: receiptConsentDescription("de", ORIGIN) });
    }
    // Without the checkbox nothing is confirmed, so the description stays off.
    expect(checkoutSessionExtras("credits", { origin: ORIGIN, env: { STRIPE_PACK_INVOICES: "1" } }).payment_intent_data).toBeUndefined();
    expect(receiptConsentDescription("en", ORIGIN)).toBe(
      `StudyOS credit pack. At checkout you accepted the Terms of Service (${ORIGIN}/terms) and asked for the credits to be added immediately; as a consumer in the EU, the EEA or the UK, you lose your right of withdrawal once they are added.`,
    );
    const longOrigin = `https://${"a".repeat(180)}.example.com`;
    const en = getDictionary("en").checkout.receiptConsentPack;
    for (const { code } of LOCALES) {
      const description = receiptConsentDescription(code, longOrigin);
      expect(description, code).toContain(`${longOrigin}/terms`);
      expect(description, code).not.toMatch(/\{[a-zA-Z]+\}|\]\(/);
      expect(description.length, code).toBeLessThanOrEqual(PAYMENT_DESCRIPTION_MAX_CHARS);
      // Short (a receipt line, not the invoice's paragraph), and translated.
      expect(description.replace(`${longOrigin}/terms`, "").length, code).toBeLessThanOrEqual(320);
      if (code !== "en") expect(getDictionary(code).checkout.receiptConsentPack, code).not.toBe(en);
    }
  });
});

describe("terms consent text", () => {
  it("links the Terms page and fits Stripe's limit in every language, for both checkouts", () => {
    const longOrigin = `https://${"a".repeat(180)}.example.com`;
    for (const { code } of LOCALES) {
      for (const kind of ["pro", "credits"] as const) {
        const message = termsConsentMessage(kind, code, longOrigin);
        expect(message, `${code} ${kind}`).toContain(`](${longOrigin}/terms)`);
        expect(message, `${code} ${kind}`).toMatch(/\[[^\]]+\]\(https:\/\//);
        expect(message.length, `${code} ${kind}`).toBeLessThanOrEqual(TERMS_MESSAGE_MAX_CHARS);
        expect(message, `${code} ${kind}`).not.toMatch(/\{[a-zA-Z]+\}/);
      }
    }
  });

  it("says what each purchase means for the EU/UK right of withdrawal (English source)", () => {
    const pack = termsConsentMessage("credits", "en", ORIGIN);
    expect(pack).toContain(`I agree to the [Terms of Service](${ORIGIN}/terms)`);
    expect(pack).toMatch(/add the credits to my balance immediately/);
    expect(pack).toMatch(/lose my right of withdrawal once the credits have been added to my balance/);
    const pro = termsConsentMessage("pro", "en", ORIGIN);
    expect(pro).toMatch(/start my Pro subscription immediately/);
    expect(pro).toMatch(/withdraw within 14 days, I pay for the share of the service already provided/);
    expect(pro).toMatch(/right of withdrawal ends once the service has been fully provided/);
    expect(pro).not.toEqual(pack);
  });

  it("is translated: every language has its own texts and VAT notes", () => {
    const en = getDictionary("en").checkout;
    for (const { code } of LOCALES.filter((l) => l.code !== "en")) {
      const t = getDictionary(code).checkout;
      for (const key of ["termsPack", "termsPro", "vatIncluded", "vatExcluded"] as const) {
        expect(t[key].trim().length, `${code}.${key}`).toBeGreaterThan(0);
        expect(t[key], `${code}.${key}`).not.toBe(en[key]);
      }
      expect(t.vatIncluded).not.toBe(t.vatExcluded);
    }
  });
});
