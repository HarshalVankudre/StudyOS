import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";

const m = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock("@/app/app/account-actions", () => ({ getAccountSummaryAction: m.summary }));
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

import { emitCreditsBalance, resetCreditsBusForTests } from "@/lib/credits-bus";
import { LOW_CREDIT_THRESHOLD } from "@/lib/credits-info";
import { LOW_CREDITS_SNOOZE_MS, LowCreditsNotice } from "./LowCreditsNotice";

const L = en.credits.lowNotice;

// jsdom's storage is not reliable under every Node version; a plain in-memory one.
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

beforeEach(() => {
  resetCreditsBusForTests();
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  // The live balance re-reads from the server on mount; keep it pending.
  m.summary.mockReset().mockReturnValue(new Promise(() => {}));
});

describe("LowCreditsNotice", () => {
  it("says how many credits are left and offers Pro and more credits", async () => {
    render(<LowCreditsNotice credits={12} showPro />);
    expect(await screen.findByRole("heading", { name: L.title })).toBeInTheDocument();
    expect(screen.getByText(/You have 12 credits left\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: L.seePro })).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("link", { name: L.more })).toHaveAttribute("href", "/app/credits");
  });

  it("offers no Pro link to a Pro student or while Pro is not on sale", async () => {
    render(<LowCreditsNotice credits={3} showPro={false} />);
    await screen.findByRole("heading", { name: L.title });
    expect(screen.queryByRole("link", { name: L.seePro })).toBeNull();
  });

  it("stays away above the threshold, and goes once credits arrive", async () => {
    const { unmount } = render(<LowCreditsNotice credits={LOW_CREDIT_THRESHOLD + 1} showPro />);
    expect(screen.queryByRole("heading", { name: L.title })).toBeNull();
    unmount();

    render(<LowCreditsNotice credits={10} showPro />);
    await screen.findByRole("heading", { name: L.title });
    act(() => emitCreditsBalance(1010));
    expect(screen.queryByRole("heading", { name: L.title })).toBeNull();
  });

  it("hides for a week in this browser", async () => {
    const { unmount } = render(<LowCreditsNotice credits={10} showPro />);
    await userEvent.click(await screen.findByRole("button", { name: L.snooze }));
    expect(screen.queryByRole("heading", { name: L.title })).toBeNull();
    unmount();

    render(<LowCreditsNotice credits={10} showPro />);
    expect(screen.queryByRole("heading", { name: L.title })).toBeNull();
  });

  it("comes back when the week is over", async () => {
    window.localStorage.setItem("studyos_low_credits_snoozed_at", String(Date.now() - LOW_CREDITS_SNOOZE_MS - 1000));
    render(<LowCreditsNotice credits={10} showPro />);
    expect(await screen.findByRole("heading", { name: L.title })).toBeInTheDocument();
  });
});
