/**
 * The public footer carries the withdrawal function and the cancellation
 * button, in the statutory wording, once billing is configured (without
 * payments no contract can be concluded).
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteFooterLinks } from "./SiteFooterLinks";

afterEach(() => vi.unstubAllEnvs());

describe("SiteFooterLinks", () => {
  it("links /withdraw and /cancel with the statutory labels when billing is on", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_1");
    render(<SiteFooterLinks dict={getDictionary("de")} />);
    expect(screen.getByRole("link", { name: "Vertrag widerrufen" })).toHaveAttribute("href", "/withdraw");
    expect(screen.getByRole("link", { name: "Verträge hier kündigen" })).toHaveAttribute("href", "/cancel");
  });

  it("leaves them out while billing is off", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_PRICE_PRO", "");
    const en = getDictionary("en");
    render(<SiteFooterLinks dict={en} />);
    expect(screen.queryByRole("link", { name: en.contractNotices.withdrawLink })).toBeNull();
    expect(screen.queryByRole("link", { name: en.contractNotices.cancelLink })).toBeNull();
    expect(screen.getByRole("link", { name: en.legal.terms })).toHaveAttribute("href", "/terms");
  });
});
