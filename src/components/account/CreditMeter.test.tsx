import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { LOW_CREDIT_THRESHOLD } from "@/lib/credits-info";
import { emitCreditsBalance } from "@/lib/credits-bus";

vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({
    dict: {
      credits: { label: "AI credits", amount: "{count} credits", low: "Low", runningLow: "Running low" },
    },
    t: (s: string, vars: Record<string, unknown>) =>
      s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k])),
    locale: "en",
  }),
}));

import { CreditMeter } from "./CreditMeter";

describe("CreditMeter", () => {
  it("renders the seeded balance", () => {
    render(<CreditMeter initial={500} />);
    expect(screen.getByText("500 credits")).toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });

  it("shows the Low tag under the threshold", () => {
    render(<CreditMeter initial={LOW_CREDIT_THRESHOLD - 1} />);
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("updates live when a charged action broadcasts a new balance", () => {
    render(<CreditMeter initial={500} />);
    act(() => emitCreditsBalance(12));
    expect(screen.getByText("12 credits")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument(); // 12 <= threshold
  });
});
