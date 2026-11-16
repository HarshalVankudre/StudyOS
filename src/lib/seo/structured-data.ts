/**
 * Structured data (schema.org JSON-LD) for the public pages, so search
 * engines and AI assistants can tell what StudyOS is and what it costs.
 *
 * It must say only what the pages say: the Free plan always, Pro only while
 * it is actually on sale (with billing off the pages show "coming soon"), at
 * the price the pages show (lib/plan-pricing.ts).
 */
import type { DisplayedProPricing } from "@/lib/plan-pricing";

export interface SoftwareLdInput {
  /** Absolute site origin, no trailing slash (lib/site.ts siteUrl()). */
  site: string;
  description: string;
  /** BCP-47 language of the page. */
  language: string;
  pro: DisplayedProPricing;
  /** Names of the two plans as the page shows them. */
  freeName: string;
  proName: string;
}

type Ld = Record<string, unknown>;

/** A price as schema.org wants it: a plain decimal string. */
function priceText(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function softwareApplicationLd(input: SoftwareLdInput): Ld {
  const site = input.site.replace(/\/+$/, "");
  const offers: Ld[] = [
    {
      "@type": "Offer",
      name: input.freeName,
      price: "0",
      priceCurrency: input.pro.monthly.currency,
      url: `${site}/pricing`,
    },
  ];
  if (input.pro.offered.month) {
    offers.push({
      "@type": "Offer",
      name: input.proName,
      price: priceText(input.pro.monthly.amount),
      priceCurrency: input.pro.monthly.currency,
      url: `${site}/pricing`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: priceText(input.pro.monthly.amount),
        priceCurrency: input.pro.monthly.currency,
        billingDuration: "P1M",
        unitText: "MONTH",
      },
    });
  }
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "StudyOS",
    url: site,
    image: `${site}/opengraph-image`,
    description: input.description,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    inLanguage: input.language,
    offers,
  };
}

export function organizationLd(site: string): Ld {
  const origin = site.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "StudyOS",
    url: origin,
    logo: `${origin}/studyos-logo.png`,
  };
}

export interface FreeToolLdInput {
  /** Absolute site origin, no trailing slash (lib/site.ts siteUrl()). */
  site: string;
  /** The tool's path ("/tools/grade-calculator"). */
  path: string;
  name: string;
  description: string;
  /** BCP-47 language of the page. */
  language: string;
}

/** A free tool on the site (no account, nothing to pay), as a web application. */
export function freeToolLd(input: FreeToolLdInput): Ld {
  const site = input.site.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: input.name,
    url: `${site}${input.path}`,
    description: input.description,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    browserRequirements: "Requires JavaScript",
    inLanguage: input.language,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: "StudyOS", url: site },
  };
}

/** Questions and answers shown on the page, word for word, as an FAQ page. */
export function faqPageLd(items: readonly { question: string; answer: string }[], language: string): Ld {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: language,
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/**
 * The script body: JSON with "<" escaped, so a string in the data can never
 * close the script element (the Next.js JSON-LD guide's advice).
 */
export function jsonLdScript(data: Ld | Ld[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
