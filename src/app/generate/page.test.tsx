import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  balance: vi.fn(),
  plan: vi.fn(),
  models: { free: "z-ai/glm-5.2", pro: "z-ai/glm-5.2" } as Record<string, string>,
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/credits", () => ({ getCreditBalance: mocks.balance }));
vi.mock("@/lib/billing", () => ({ getUserPlan: mocks.plan }));
vi.mock("@/lib/ai/plans", () => ({ modelForPlan: (plan: string) => mocks.models[plan] }));
vi.mock("./GeneratorClient", () => ({
  GeneratorClient: (props: {
    initialPrompt?: string;
    outOfCredits?: boolean;
    minCredits?: number;
    costs: { build: number; buildMax: number };
    balance: number | null;
    signupCredits: number;
    billing: boolean;
  }) => (
    <div
      data-testid="generator"
      data-initial-prompt={props.initialPrompt}
      data-min-credits={String(props.minCredits)}
      data-out-of-credits={String(Boolean(props.outOfCredits))}
      data-costs={JSON.stringify(props.costs)}
      data-balance={String(props.balance)}
      data-signup={String(props.signupCredits)}
      data-billing={String(props.billing)}
    />
  ),
}));

import GeneratePage from "./page";
import { buildQuote, TRIAL_CREDITS } from "@/lib/price-list";

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.balance.mockResolvedValue(500);
  mocks.plan.mockResolvedValue("free");
  mocks.models.free = "z-ai/glm-5.2";
});
afterEach(() => vi.unstubAllEnvs());

const generator = () => screen.getByTestId("generator");

describe("generate page", () => {
  test("passes a landing-page prompt into the generator", async () => {
    render(await GeneratePage({ searchParams: Promise.resolve({ prompt: "Organic chemistry finals" }) }));
    expect(generator()).toHaveAttribute("data-initial-prompt", "Organic chemistry finals");
  });

  test("ignores repeated prompt parameters", async () => {
    render(await GeneratePage({ searchParams: Promise.resolve({ prompt: ["first", "second"] }) }));
    expect(generator()).toHaveAttribute("data-initial-prompt", "");
  });

  test("tells the generator up front when the student is out of credits", async () => {
    mocks.balance.mockResolvedValue(1);
    render(await GeneratePage({ searchParams: Promise.resolve({}) }));
    expect(generator()).toHaveAttribute("data-out-of-credits", "true");
    expect(generator()).toHaveAttribute("data-balance", "1");
  });

  test("a failed credit lookup never blocks the generator", async () => {
    mocks.balance.mockRejectedValue(new Error("db down"));
    render(await GeneratePage({ searchParams: Promise.resolve({}) }));
    expect(generator()).toHaveAttribute("data-out-of-credits", "false");
    expect(generator()).toHaveAttribute("data-balance", "null");
  });

  test("prices the build for the model the student's plan runs: the list price, or the real cost when higher", async () => {
    mocks.models.free = "claude-haiku-5-5";
    const view = render(await GeneratePage({ searchParams: Promise.resolve({}) }));
    expect(generator()).toHaveAttribute("data-min-credits", "30");
    expect(JSON.parse(generator().getAttribute("data-costs")!)).toEqual({ build: 30, buildMax: 30 });
    view.unmount();

    mocks.models.free = "z-ai/glm-5.2";
    render(await GeneratePage({ searchParams: Promise.resolve({}) }));
    const glm = buildQuote("z-ai/glm-5.2");
    expect(glm.price).toBeGreaterThan(30);
    expect(generator()).toHaveAttribute("data-min-credits", String(glm.price));
    expect(JSON.parse(generator().getAttribute("data-costs")!)).toEqual({ build: glm.price, buildMax: glm.max });
  });

  test("hands over the sign-up grant and whether payments are on", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const view = render(await GeneratePage({ searchParams: Promise.resolve({}) }));
    expect(generator()).toHaveAttribute("data-signup", String(TRIAL_CREDITS));
    expect(generator()).toHaveAttribute("data-billing", "false");
    view.unmount();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_month");
    render(await GeneratePage({ searchParams: Promise.resolve({}) }));
    expect(generator()).toHaveAttribute("data-billing", "true");
  });
});
