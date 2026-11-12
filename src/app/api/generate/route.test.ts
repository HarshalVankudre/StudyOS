// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordUsage } from "@/lib/ai/usage-meter";
import { sampleWorkspace } from "@/lib/workspace/sample";
import type { GenerationEvent } from "@/lib/ai/generation-progress";
import type { StudentClock } from "@/lib/ai/student-clock";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  planWorkspace: vi.fn(),
  generateWorkspace: vi.fn(),
  hasCredits: vi.fn(),
  chargeCredits: vi.fn(),
  reserveCredits: vi.fn(),
  settleCreditHold: vi.fn(),
  releaseCreditHold: vi.fn(),
  getCreditBalance: vi.fn(),
  checkUsageLimit: vi.fn(),
  claimOutcomeSlot: vi.fn(),
  releaseOutcomeSlot: vi.fn(),
  workspaceLimitReached: vi.fn(),
  saveNewWorkspace: vi.fn(),
  normalizeSourceText: vi.fn(),
  // The model the student's plan runs: the configured Haiku (real cost
  // within the list price) unless a test makes it an expensive one.
  model: "claude-haiku-5-5",
}));
vi.mock("@/lib/ai/plans", () => ({ modelForPlan: () => mocks.model }));
vi.mock("@/lib/import/syllabus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/import/syllabus")>();
  mocks.normalizeSourceText.mockImplementation(actual.normalizeSourceText);
  return { ...actual, normalizeSourceText: mocks.normalizeSourceText };
});

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/ai/generate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/generate")>();
  return {
    ...actual,
    planWorkspace: mocks.planWorkspace,
    generateWorkspace: mocks.generateWorkspace,
  };
});
vi.mock("@/lib/billing", () => ({ getUserPlan: vi.fn(async () => "free") }));
vi.mock("@/lib/credits", () => ({
  hasCredits: mocks.hasCredits,
  chargeCredits: mocks.chargeCredits,
  reserveCredits: mocks.reserveCredits,
  settleCreditHold: mocks.settleCreditHold,
  releaseCreditHold: mocks.releaseCreditHold,
  getCreditBalance: mocks.getCreditBalance,
  // 1 credit per 100 tokens keeps the arithmetic visible in assertions,
  // and $0.0001 per credit of model spend.
  usageToCredits: (usage: { promptTokens: number; completionTokens: number }) =>
    Math.ceil((usage.promptTokens + usage.completionTokens) / 100),
  usageToUsd: (usage: { promptTokens: number; completionTokens: number }) =>
    Math.ceil((usage.promptTokens + usage.completionTokens) / 100) * 0.0001,
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: mocks.checkUsageLimit,
  claimOutcomeSlot: mocks.claimOutcomeSlot,
  releaseOutcomeSlot: mocks.releaseOutcomeSlot,
  workspaceLimitReached: mocks.workspaceLimitReached,
  MAX_WORKSPACES_PER_USER: 200,
  recordFunnelEvent: vi.fn(),
}));
vi.mock("@/lib/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/workspace/store", () => ({ saveNewWorkspace: mocks.saveNewWorkspace }));

import { POST } from "./route";
import { POST as CANCEL } from "./cancel/route";
import { GenerationCancelledError, GenerationFailedError } from "@/lib/ai/generate";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { ACTION_PRICES, buildQuote, buildTypicalUsd, chargeForPartial } from "@/lib/price-list";

const HAIKU = "claude-haiku-5-5";
/** A build's price on the configured model: the list price, 30. */
const PRICE = buildQuote(HAIKU).price;
/** What a build stopped after `credits` of model spend is charged (lib/price-list.ts). */
const stoppedAt = (credits: number) =>
  chargeForPartial(buildQuote(HAIKU), credits, (credits * 0.0001) / buildTypicalUsd(HAIKU));

/** Payments switched on: the refusals may point to buying credits (lib/credit-messages). */
function billingOn() {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_month");
}

const HOLD = { id: "hold-1", userId: "user-1", amount: PRICE, reason: "generate" };

const PLAN = {
  workspaceName: "Study HQ",
  summary: "s",
  components: [
    { id: "dashboard", kind: "dashboard", label: "Dashboard", icon: "🏠", description: "d" },
    { id: "courses", kind: "courses", label: "Courses", icon: "📚", description: "c" },
  ],
};

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function events(response: Response): Promise<GenerationEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GenerationEvent);
}

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.hasCredits.mockResolvedValue(true);
  mocks.checkUsageLimit.mockResolvedValue({ allowed: true, remaining: 5 });
  mocks.claimOutcomeSlot.mockResolvedValue({ allowed: true, slot: "slot-1" });
  mocks.releaseOutcomeSlot.mockResolvedValue(undefined);
  mocks.normalizeSourceText.mockImplementation((text: string) => text.trim());
  mocks.workspaceLimitReached.mockResolvedValue(false);
  mocks.getCreditBalance.mockResolvedValue(100);
  mocks.chargeCredits.mockImplementation(async (_user: string, amount: number) => amount);
  mocks.reserveCredits.mockReset();
  mocks.reserveCredits.mockResolvedValue(HOLD);
  mocks.settleCreditHold.mockReset();
  mocks.settleCreditHold.mockImplementation(async (_hold: unknown, actual: number) => actual);
  mocks.releaseCreditHold.mockReset();
  mocks.releaseCreditHold.mockResolvedValue(true);
  mocks.saveNewWorkspace.mockResolvedValue("ws-new");
  mocks.planWorkspace.mockImplementation(async () => {
    recordUsage({ prompt_tokens: 300, completion_tokens: 100 });
    return PLAN;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/generate", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("saves and charges a successful build its list price", async () => {
    mocks.generateWorkspace.mockImplementation(async () => {
      recordUsage({ prompt_tokens: 1500, completion_tokens: 500 });
      return sampleWorkspace;
    });
    const stream = await events(await POST(request({ prompt: "CS student" })));
    // 24 credits of model spend, charged the price shown: 30.
    expect(PRICE).toBe(ACTION_PRICES.build);
    expect(stream.at(-1)).toMatchObject({ type: "complete", workspaceId: "ws-new", credits: 30 });
    expect(mocks.saveNewWorkspace).toHaveBeenCalledOnce();
    // The price was held before any model call and settled to it.
    expect(mocks.reserveCredits).toHaveBeenCalledWith("user-1", {
      estimate: 30,
      min: 30,
      reason: "generate",
    });
    expect(mocks.reserveCredits.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.planWorkspace.mock.invocationCallOrder[0],
    );
    expect(mocks.settleCreditHold).toHaveBeenCalledWith(HOLD, 30);
    expect(mocks.settleCreditHold).toHaveBeenCalledTimes(1);
    expect(mocks.chargeCredits).not.toHaveBeenCalled();
    // The failure slot claimed up front is withdrawn: this build did not fail.
    expect(mocks.claimOutcomeSlot.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.planWorkspace.mock.invocationCallOrder[0],
    );
    expect(mocks.releaseOutcomeSlot).toHaveBeenCalledWith("slot-1");
  });

  it("on a model whose real cost exceeds the price, the build is charged its real cost, shown up front", async () => {
    mocks.model = "claude-opus-5-5";
    try {
      const quote = buildQuote("claude-opus-5-5");
      expect(quote.price).toBeGreaterThan(ACTION_PRICES.build);
      mocks.getCreditBalance.mockResolvedValue(quote.max + 10);
      mocks.generateWorkspace.mockImplementation(async () => {
        recordUsage({ prompt_tokens: 9_000, completion_tokens: 3_000 }); // + 400 planning: 124 credits
        return sampleWorkspace;
      });
      const stream = await events(await POST(request({ prompt: "CS student" })));
      expect(mocks.reserveCredits).toHaveBeenCalledWith("user-1", { estimate: quote.max, min: quote.price, reason: "generate" });
      const expected = Math.min(quote.max, Math.max(30, 124));
      expect(mocks.settleCreditHold).toHaveBeenCalledWith(HOLD, expected);
      expect(stream.at(-1)).toMatchObject({ type: "complete", credits: expected });
    } finally {
      mocks.model = HAIKU;
    }
  });

  it("a build stopped after most of its work is charged at most its price", async () => {
    expect(stoppedAt(500)).toBe(PRICE);
  });

  it("a failed generation is not saved, not charged, and tells the client it can retry", async () => {
    mocks.generateWorkspace.mockImplementation(async () => {
      throw new GenerationFailedError("invalid_output");
    });
    const stream = await events(await POST(request({ prompt: "CS student" })));
    expect(stream.at(-1)).toEqual({
      type: "error",
      code: "generation_failed",
      message: en.ai.generate.failedNoCharge,
    });
    expect(mocks.saveNewWorkspace).not.toHaveBeenCalled();
    expect(mocks.chargeCredits).not.toHaveBeenCalled();
    expect(mocks.settleCreditHold).not.toHaveBeenCalled();
    expect(mocks.releaseCreditHold).toHaveBeenCalledWith(HOLD);
    // …but it counts against the small failed-generation quota: the slot
    // claimed before the build started is kept.
    expect(mocks.claimOutcomeSlot).toHaveBeenCalledWith("user-1", "generate_failed");
    expect(mocks.releaseOutcomeSlot).not.toHaveBeenCalled();
  });

  it("out of credits stops before any model call, with a code the client can act on", async () => {
    billingOn();
    mocks.getCreditBalance.mockResolvedValue(0);
    const stream = await events(await POST(request({ prompt: "CS student" })));
    expect(stream).toEqual([
      { type: "error", code: "out_of_credits", message: en.credits.outGenerate },
    ]);
    expect(mocks.planWorkspace).not.toHaveBeenCalled();
  });

  it("without payments switched on, the refusal sends nobody to buy credits", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    mocks.getCreditBalance.mockResolvedValue(0);
    const [event] = await events(await POST(request({ prompt: "CS student" })));
    expect(event).toMatchObject({ type: "error", code: "out_of_credits" });
    expect((event as { message: string }).message).toBe(en.spend.outOfCredits);
    vi.unstubAllEnvs();
  });

  it("needs the build's price to start (no full build for 1 credit)", async () => {
    billingOn();
    mocks.getCreditBalance.mockResolvedValue(PRICE - 1);
    const stream = await events(await POST(request({ prompt: "CS student" })));
    expect(stream).toEqual([
      {
        type: "error",
        code: "out_of_credits",
        message: fmt(en.credits.belowGenerateMinimum, { min: PRICE }),
      },
    ]);
    expect(mocks.planWorkspace).not.toHaveBeenCalled();
    expect(mocks.checkUsageLimit).not.toHaveBeenCalled();

    mocks.getCreditBalance.mockResolvedValue(PRICE);
    mocks.generateWorkspace.mockResolvedValue(sampleWorkspace);
    const ok = await events(await POST(request({ prompt: "CS student" })));
    expect(ok.at(-1)).toMatchObject({ type: "complete" });
  });

  it("after a few failed builds, new ones wait (and nothing runs or is charged)", async () => {
    mocks.claimOutcomeSlot.mockResolvedValue({ allowed: false, slot: null });
    const stream = await events(await POST(request({ prompt: "CS student" })));
    expect(stream).toEqual([
      { type: "error", code: "too_many_failures", message: en.limits.failedGenerations },
    ]);
    expect(mocks.claimOutcomeSlot).toHaveBeenCalledWith("user-1", "generate_failed");
    expect(mocks.planWorkspace).not.toHaveBeenCalled();
    expect(mocks.chargeCredits).not.toHaveBeenCalled();
    expect(mocks.reserveCredits).not.toHaveBeenCalled();
    // The refused request does not use up the hourly generation limit either.
    expect(mocks.checkUsageLimit).not.toHaveBeenCalled();
  });

  it("a parallel build that finds the credits already held is refused before any model call", async () => {
    billingOn();
    mocks.reserveCredits.mockResolvedValue(null);
    const stream = await events(await POST(request({ prompt: "CS student" })));
    expect(stream).toEqual([
      {
        type: "error",
        code: "out_of_credits",
        message: fmt(en.credits.belowGenerateMinimum, { min: PRICE }),
      },
    ]);
    expect(mocks.planWorkspace).not.toHaveBeenCalled();
    expect(mocks.settleCreditHold).not.toHaveBeenCalled();
  });

  it("an unexpected error after the hold gives the credits back", async () => {
    mocks.generateWorkspace.mockResolvedValue(sampleWorkspace);
    mocks.saveNewWorkspace.mockRejectedValue(new Error("db down"));
    await events(await POST(request({ prompt: "CS student" })));
    expect(mocks.settleCreditHold).not.toHaveBeenCalled();
    expect(mocks.releaseCreditHold).toHaveBeenCalledWith(HOLD);
  });

  it("a cancelled run is not counted as a failure", async () => {
    mocks.generateWorkspace.mockRejectedValue(new GenerationCancelledError());
    await events(await POST(request({ prompt: "CS student" })));
    // The failure slot claimed up front is withdrawn.
    expect(mocks.releaseOutcomeSlot).toHaveBeenCalledWith("slot-1");
  });

  it("refuses at the workspace cap before any model call", async () => {
    mocks.workspaceLimitReached.mockResolvedValue(true);
    const stream = await events(await POST(request({ prompt: "CS student" })));
    expect(stream).toEqual([
      { type: "error", code: "workspace_limit", message: fmt(en.limits.workspaceCap, { max: 200 }) },
    ]);
    expect(mocks.planWorkspace).not.toHaveBeenCalled();
  });

  it("does no work on the source text before the gates pass", async () => {
    mocks.getCreditBalance.mockResolvedValue(0);
    await events(await POST(request({ prompt: "CS student", sourceText: " ".repeat(100_000) + "x" })));
    expect(mocks.normalizeSourceText).not.toHaveBeenCalled();
  });

  it("cancel stops the server work: nothing is saved and only the share that ran is billed", async () => {
    let started!: () => void;
    const generationStarted = new Promise<void>((resolve) => (started = resolve));
    mocks.generateWorkspace.mockImplementation(async (...args: unknown[]) => {
      const { signal } = args[6] as { signal: AbortSignal };
      const aborted = new Promise((resolve) => signal.addEventListener("abort", resolve));
      started();
      await aborted;
      // The cut-off model call reports what it consumed so far.
      recordUsage({ prompt_tokens: 200, completion_tokens: 0 });
      throw new GenerationCancelledError();
    });

    const responsePromise = POST(request({ prompt: "CS student", generationId: "gen-12345678" }));
    const response = await responsePromise;
    const streamed = events(response);
    await generationStarted;

    // Someone else cannot cancel it…
    mocks.auth.mockResolvedValueOnce({ userId: "intruder" });
    const foreign = await CANCEL(
      new Request("http://localhost/api/generate/cancel", {
        method: "POST",
        body: JSON.stringify({ generationId: "gen-12345678" }),
      }),
    );
    expect(await foreign.json()).toEqual({ cancelled: false });

    // …the owner can.
    const cancelled = await CANCEL(
      new Request("http://localhost/api/generate/cancel", {
        method: "POST",
        body: JSON.stringify({ generationId: "gen-12345678" }),
      }),
    );
    expect(await cancelled.json()).toEqual({ cancelled: true });

    const stream = await streamed;
    expect(stream.some((event) => event.type === "complete")).toBe(false);
    expect(stream.some((event) => event.type === "error")).toBe(false);
    expect(mocks.saveNewWorkspace).not.toHaveBeenCalled();
    // Planning (400 tokens) + the cut-off call (200 tokens): 6 credits of
    // spend, the share of the price that ran, never more than the price.
    expect(stoppedAt(6)).toBeGreaterThan(0);
    expect(stoppedAt(6)).toBeLessThan(PRICE);
    expect(mocks.settleCreditHold).toHaveBeenCalledTimes(1);
    expect(mocks.settleCreditHold).toHaveBeenCalledWith(HOLD, stoppedAt(6), { reason: "generate_cancelled" });
  });

  it("tells the student what a cancelled build cost", async () => {
    let started!: () => void;
    const generationStarted = new Promise<void>((resolve) => (started = resolve));
    mocks.generateWorkspace.mockImplementation(async (...args: unknown[]) => {
      const { signal } = args[6] as { signal: AbortSignal };
      const aborted = new Promise((resolve) => signal.addEventListener("abort", resolve));
      started();
      await aborted;
      recordUsage({ prompt_tokens: 200, completion_tokens: 0 });
      throw new GenerationCancelledError();
    });
    const streamed = events(await POST(request({ prompt: "CS student", generationId: "gen-87654321" })));
    await generationStarted;
    await CANCEL(
      new Request("http://localhost/api/generate/cancel", {
        method: "POST",
        body: JSON.stringify({ generationId: "gen-87654321" }),
      }),
    );
    const stream = await streamed;
    // The last event says what was charged (planning 400 + cut-off call 200 tokens).
    expect(stream.at(-1)).toEqual({ type: "cancelled", credits: stoppedAt(6) });
    expect(stream.filter((event) => event.type === "cancelled")).toHaveLength(1);
  });

  it("streams real build progress and reports the grades calculator's items", async () => {
    mocks.planWorkspace.mockResolvedValue({
      ...PLAN,
      components: [...PLAN.components, { id: "grades", kind: "grades", label: "Grades", icon: "💯", description: "g" }],
    });
    mocks.generateWorkspace.mockImplementation(async (...args: unknown[]) => {
      const { onProgress } = args[6] as { onProgress: (event: unknown) => void };
      onProgress({ type: "database", name: "Courses", chars: 120, attempt: 1 });
      onProgress({ type: "rows", database: "Courses", count: 2, chars: 600, attempt: 1 });
      return sampleWorkspace;
    });
    const stream = await events(await POST(request({ prompt: "CS student" })));
    expect(stream).toContainEqual(expect.objectContaining({ type: "phase", message: "Setting up Courses" }));
    expect(stream).toContainEqual(expect.objectContaining({ type: "phase", message: "Courses: 2 items so far" }));
    const grades = stream.find((event) => event.type === "component" && event.componentId === "grades" && event.status === "complete");
    // The sample's grades block reads its 8 assignments (there is no grades table).
    expect(grades).toMatchObject({ detail: "Grade calculator connected to 8 graded items" });
  });

  it("says “1 course”, not “1 courses”, in its progress lines", async () => {
    const oneCourse = structuredClone(sampleWorkspace);
    const courses = oneCourse.databases.find((db) => `${db.name} ${db.description ?? ""}`.toLowerCase().includes("course"))!;
    courses.rows = courses.rows.slice(0, 1);
    mocks.generateWorkspace.mockImplementation(async (...args: unknown[]) => {
      const { onProgress } = args[6] as { onProgress: (event: unknown) => void };
      onProgress({ type: "database", name: "Courses", chars: 120, attempt: 1 });
      onProgress({ type: "rows", database: "Courses", count: 1, chars: 600, attempt: 1 });
      return oneCourse;
    });
    const stream = await events(await POST(request({ prompt: "CS student" })));
    expect(stream).toContainEqual(expect.objectContaining({ type: "phase", message: "Courses: 1 item so far" }));
    const done = stream.find((event) => event.type === "component" && event.componentId === "courses" && event.status === "complete");
    expect(done).toMatchObject({ detail: "1 course added" });
  });

  it("a client disconnect also stops the run before anything is saved", async () => {
    const controller = new AbortController();
    mocks.generateWorkspace.mockImplementation(
      (...args: unknown[]) =>
        new Promise((_, reject) => {
          const { signal } = args[6] as { signal: AbortSignal };
          signal.addEventListener("abort", () => reject(new GenerationCancelledError()));
          controller.abort();
        }),
    );
    const req = new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "CS student" }),
      signal: controller.signal,
    });
    const response = await POST(req);
    await response.text().catch(() => "");
    await vi.waitFor(() => expect(mocks.settleCreditHold).toHaveBeenCalled());
    expect(mocks.saveNewWorkspace).not.toHaveBeenCalled();
    expect(mocks.settleCreditHold).toHaveBeenCalledWith(HOLD, stoppedAt(4), { reason: "generate_cancelled" });
  });

  it("passes the student's time zone (body first, then cookie) to the generator", async () => {
    mocks.generateWorkspace.mockResolvedValue(sampleWorkspace);
    await events(await POST(request({ prompt: "CS", timeZone: "Asia/Tokyo" })));
    let clock = (mocks.generateWorkspace.mock.calls[0][6] as { clock: StudentClock }).clock;
    expect(clock.timeZone).toBe("Asia/Tokyo");
    expect(clock.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await events(
      await POST(request({ prompt: "CS" }, { cookie: "studyos_tz=Europe%2FBerlin" })),
    );
    clock = (mocks.generateWorkspace.mock.calls[1][6] as { clock: StudentClock }).clock;
    expect(clock.timeZone).toBe("Europe/Berlin");
  });
});
