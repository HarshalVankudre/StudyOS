// Every surface that shows the credit balance shows the same, latest one
// (the QA bug: header chip 244 while the account menu said 265).
import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { emitCreditsBalance, refreshCreditsBalance, resetCreditsBusForTests } from "@/lib/credits-bus";
import { AccountMenu } from "./AccountMenu";
import { CreditChip } from "./CreditChip";
import { CreditMeter } from "./CreditMeter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  resetCreditsBusForTests();
  m.summary.mockReset();
});

describe("credit balance on every surface", () => {
  it("a stale server-rendered chip and the account menu agree on the fresh balance", async () => {
    m.summary.mockResolvedValue({ pro: false, credits: 265 });
    render(
      <>
        <div data-testid="chip">
          <CreditChip credits={244} />
        </div>
        <div data-testid="meter">
          <CreditMeter initial={244} />
        </div>
        <div data-testid="menu">
          <AccountMenu variant="sidebar" />
        </div>
      </>,
    );
    // Before the fresh read lands, the server-rendered value.
    expect(within(screen.getByTestId("chip")).getByText("244 credits")).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(within(screen.getByTestId("chip")).getByText("265 credits")).toBeInTheDocument(),
    );
    expect(within(screen.getByTestId("meter")).getByText("265 credits")).toBeInTheDocument();
    expect(within(screen.getByTestId("menu")).getByText("265 credits · Free")).toBeInTheDocument();
  });

  it("an AI action's settled balance updates every surface at once", async () => {
    m.summary.mockResolvedValue({ pro: false, credits: 265 });
    render(
      <>
        <div data-testid="chip">
          <CreditChip credits={265} />
        </div>
        <div data-testid="menu">
          <AccountMenu variant="sidebar" />
        </div>
      </>,
    );
    await vi.waitFor(() => expect(within(screen.getByTestId("menu")).getByText("265 credits · Free")).toBeInTheDocument());
    act(() => emitCreditsBalance(232));
    expect(within(screen.getByTestId("chip")).getByText("232 credits")).toBeInTheDocument();
    expect(within(screen.getByTestId("menu")).getByText("232 credits · Free")).toBeInTheDocument();
  });

  it("a read that started before an AI action settled never overwrites the newer balance", async () => {
    const slow = deferred<{ pro: boolean; credits: number }>();
    m.summary.mockReturnValueOnce(slow.promise);
    render(<CreditMeter initial={300} />);
    // The read started (mount); meanwhile an agent turn settles at 280 ...
    act(() => emitCreditsBalance(280));
    expect(screen.getByText("280 credits")).toBeInTheDocument();
    // ... and the read, made while the turn still held credits, lands late.
    await act(async () => {
      slow.resolve({ pro: false, credits: 260 });
      await slow.promise;
    });
    expect(screen.getByText("280 credits")).toBeInTheDocument();
  });

  it("several surfaces mounting at once share one server read", async () => {
    m.summary.mockResolvedValue({ pro: false, credits: 50 });
    render(
      <>
        <CreditChip credits={50} />
        <CreditMeter initial={50} />
      </>,
    );
    await act(async () => {
      await refreshCreditsBalance();
    });
    expect(m.summary).toHaveBeenCalledTimes(1);
  });
});
