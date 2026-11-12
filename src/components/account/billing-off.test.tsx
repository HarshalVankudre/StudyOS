// With payments not switched on, the compact surfaces offer nothing to buy
// (QA: "Buy credits" ended in "Payments aren't available right now").
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";

const m = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock("@/app/app/account-actions", () => ({ getAccountSummaryAction: m.summary }));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { fullName: "Sam", firstName: "Sam", primaryEmailAddress: { emailAddress: "s@uni.edu" } } }),
  useClerk: () => ({ openUserProfile: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return {
    useI18n: () => ({
      dict: en,
      t: (s: string, vars: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k])),
      plural: (forms: { one?: string; other: string }, n: number) =>
        (n === 1 && forms.one ? forms.one : forms.other).replace("{count}", String(n)),
      locale: "en",
      dir: "ltr",
    }),
  };
});

import { resetCreditsBusForTests } from "@/lib/credits-bus";
import { AccountMenu } from "./AccountMenu";
import { CreditChip } from "./CreditChip";
import { ComingSoon } from "./ComingSoon";

beforeEach(() => {
  resetCreditsBusForTests();
  m.summary.mockReset();
});

describe("billing off", () => {
  it("the account menu lists no purchase links", async () => {
    m.summary.mockResolvedValue({ pro: false, credits: 286, billing: false });
    render(<AccountMenu variant="header" />);
    await userEvent.click(screen.getByRole("button", { name: /View profile/ }));
    await screen.findByText("286 credits");
    expect(screen.queryByRole("menuitem", { name: new RegExp(en.account.buyCredits) })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: new RegExp(en.account.subscriptionPayments) })).toBeNull();
    expect(screen.getByRole("menuitem", { name: new RegExp(en.account.settings) })).toBeInTheDocument();
  });

  it("with billing on, the account menu offers them", async () => {
    m.summary.mockResolvedValue({ pro: false, credits: 286, billing: true });
    render(<AccountMenu variant="header" />);
    await userEvent.click(screen.getByRole("button", { name: /View profile/ }));
    expect(await screen.findByRole("menuitem", { name: new RegExp(en.account.buyCredits) })).toBeInTheDocument();
  });

  it("the credit chip shows the balance without a Buy button", async () => {
    m.summary.mockReturnValue(new Promise(() => {}));
    render(<CreditChip credits={286} billing={false} />);
    await userEvent.click(screen.getByRole("button", { name: "286 credits" }));
    expect(screen.getByText(en.credits.spentOn)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: en.credits.buy })).toBeNull();
  });

  it("pages mark the purchase as coming soon, not as a button", () => {
    render(<ComingSoon messages={en.spend} note />);
    expect(screen.getByText(en.spend.comingSoon)).toBeInTheDocument();
    expect(screen.getByText(en.spend.purchasesComingSoon)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
