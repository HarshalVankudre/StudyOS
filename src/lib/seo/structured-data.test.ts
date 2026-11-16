import { describe, expect, it } from "vitest";
import type { DisplayedProPricing } from "@/lib/plan-pricing";
import { jsonLdScript, organizationLd, softwareApplicationLd } from "./structured-data";

const pricing = (offered: boolean): DisplayedProPricing => ({
  monthly: { amount: 7.99, currency: "EUR" },
  annual: null,
  offered: { month: offered, year: false },
  source: offered ? "stripe" : "configured",
});

const input = (offered: boolean) => ({
  site: "https://studyos.example/",
  description: "A study workspace made to measure.",
  language: "de",
  pro: pricing(offered),
  freeName: "Free",
  proName: "Pro",
});

describe("softwareApplicationLd", () => {
  it("lists Pro only while it is on sale, at the price the pages show", () => {
    const onSale = softwareApplicationLd(input(true));
    const offers = onSale.offers as Record<string, unknown>[];
    expect(offers.map((o) => o.name)).toEqual(["Free", "Pro"]);
    expect(offers[1]).toMatchObject({ price: "7.99", priceCurrency: "EUR", url: "https://studyos.example/pricing" });
    expect(onSale).toMatchObject({ "@type": "SoftwareApplication", url: "https://studyos.example", inLanguage: "de" });

    const comingSoon = softwareApplicationLd(input(false));
    expect((comingSoon.offers as Record<string, unknown>[]).map((o) => o.name)).toEqual(["Free"]);
  });

  it("writes whole prices without decimals", () => {
    const ld = softwareApplicationLd({ ...input(true), pro: { ...pricing(true), monthly: { amount: 8, currency: "USD" } } });
    expect((ld.offers as Record<string, unknown>[])[1].price).toBe("8");
  });
});

describe("jsonLdScript", () => {
  it("can never close the script element", () => {
    const out = jsonLdScript({ description: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual({ description: "</script><script>alert(1)</script>" });
  });

  it("describes the organization with its logo", () => {
    expect(organizationLd("https://studyos.example")).toMatchObject({ logo: "https://studyos.example/studyos-logo.png" });
  });
});
