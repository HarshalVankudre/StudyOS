// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  getCreditBalance: vi.fn(),
  checkUsageLimit: vi.fn(),
  saveNewWorkspace: vi.fn(),
}));

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
  getCreditBalance: mocks.getCreditBalance,
  // 1 credit per 100 tokens keeps the arithmetic visible in assertions.
  usageToCredits: (usage: { promptTokens: number; completionTokens: number }) =>
    Math.ceil((usage.promptTokens + usage.completionTokens) / 100),
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: mocks.checkUsageLimit,
  recordFunnelEvent: vi.fn(),
}));
vi.mock("@/lib/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/workspace/store", () => ({ saveNewWorkspace: mocks.saveNewWorkspace }));

import { POST } from "./route";
import { POST as CANCEL } from "./cancel/route";
import { GenerationCancelledError, GenerationFailedError } from "@/lib/ai/generate";
import { en } from "@/lib/i18n/dictionaries/en";

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
  mocks.getCreditBalance.mockResolvedValue(100);
  mocks.chargeCredits.mockImplementation(async (_user: string, amount: number) => amount);
  mocks.saveNewWorkspace.mockResolvedValue("ws-new");
  mocks.planWorkspace.mockImplementation(async () => {
    recordUsage({ prompt_tokens: 300, completion_tokens: 100 });
    return PLAN;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/generate", () => {
  it("saves and charges for a successful generation", async () => {
    mocks.generateWorkspace.mockImplementation(async () => {
      recordUsage({ prompt_tokens: 1500, completion_tokens: 500 });
      return sampleWorkspace;
    });
    const stream = await events(await POST(request({ prompt: "CS student" })));
    expect(stream.at(-1)).toMatchObject({ type: "complete", workspaceId: "ws-new", credits: 24 });
    expect(mocks.saveNewWorkspace).toHaveBeenCalledOnce();
    expect(mocks.chargeCredits).toHaveBeenCalledWith("user-1", 24, "generate");
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
  });

  it("out of credits stops before any model call, with a code the client can act on", async () => {
    mocks.hasCredits.mockResolvedValue(false);
    const stream = await events(await POST(request({ prompt: "CS student" })));
    expect(stream).toEqual([
      { type: "error", code: "out_of_credits", message: en.credits.outGenerate },
    ]);
    expect(mocks.planWorkspace).not.toHaveBeenCalled();
  });

  it("cancel stops the server work: nothing is saved and only consumed tokens are billed", async () => {
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
    // Planning (400 tokens) + the cut-off call (200 tokens) = 6 credits, nothing more.
    expect(mocks.chargeCredits).toHaveBeenCalledTimes(1);
    expect(mocks.chargeCredits).toHaveBeenCalledWith("user-1", 6, "generate_cancelled");
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
    await vi.waitFor(() => expect(mocks.chargeCredits).toHaveBeenCalled());
    expect(mocks.saveNewWorkspace).not.toHaveBeenCalled();
    expect(mocks.chargeCredits).toHaveBeenCalledWith("user-1", 4, "generate_cancelled");
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
