// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordUsage } from "@/lib/ai/usage-meter";
import type { KitComplete } from "@/lib/materials/pipeline";
import type { KitEvent } from "@/lib/materials/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getMaterial: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
  getCreditBalance: vi.fn(),
  checkUsageLimit: vi.fn(),
  claimFailure: vi.fn(),
  releaseFailure: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/materials/store", () => ({ getMaterial: mocks.getMaterial }));
vi.mock("@/lib/materials/model", () => ({
  modelComplete: () => mocks.complete,
  mockComplete: mocks.complete,
}));
vi.mock("@/lib/ai/provider", () => ({ isAiConfigured: () => true }));
vi.mock("@/lib/billing", () => ({ getUserPlan: vi.fn(async () => "free") }));
vi.mock("@/lib/credits", () => ({
  reserveCredits: mocks.reserve,
  settleCreditHold: mocks.settle,
  releaseCreditHold: mocks.release,
  getCreditBalance: mocks.getCreditBalance,
  // 1 credit per 100 tokens keeps the arithmetic visible.
  usageToCredits: (usage: { promptTokens: number; completionTokens: number }) =>
    Math.ceil((usage.promptTokens + usage.completionTokens) / 100),
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: mocks.checkUsageLimit,
  claimOutcomeSlot: mocks.claimFailure,
  releaseOutcomeSlot: mocks.releaseFailure,
  recordFunnelEvent: vi.fn(),
}));
vi.mock("@/lib/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));

import { POST } from "./route";
import { POST as CANCEL } from "./cancel/route";
import { en } from "@/lib/i18n/dictionaries/en";

const PAGE = "The mitochondrion is the site of aerobic respiration and produces most of the cell's ATP.";
const MATERIAL = { id: "mat-1", workspaceId: "ws-1", title: "Cells", pages: [PAGE] };
const GOOD_REPLY = JSON.stringify({
  cards: [
    {
      front: "Where does aerobic respiration take place?",
      back: "In the mitochondrion",
      page: 1,
      quote: "The mitochondrion is the site of aerobic respiration",
    },
  ],
});

function request(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/materials/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: "ws-1",
      materialId: "mat-1",
      outputs: { notes: false, flashcards: true, quiz: false },
      amount: "standard",
      ...body,
    }),
  });
}

async function events(response: Response): Promise<KitEvent[]> {
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as KitEvent);
}

beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  mocks.getMaterial.mockImplementation(async (user: string, id: string, ws: string) =>
    user === "user-1" && id === "mat-1" && ws === "ws-1" ? MATERIAL : null,
  );
  mocks.checkUsageLimit.mockResolvedValue({ allowed: true, remaining: 5 });
  mocks.claimFailure.mockResolvedValue({ allowed: true, slot: "slot-1" });
  mocks.releaseFailure.mockResolvedValue(undefined);
  mocks.getCreditBalance.mockResolvedValue(100);
  mocks.reserve.mockImplementation(async (userId: string, o: { estimate: number }) => ({
    id: "hold-1",
    userId,
    amount: o.estimate,
    reason: "study_kit",
  }));
  mocks.settle.mockImplementation(async (_hold: unknown, amount: number) => amount);
  mocks.release.mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/materials/generate", () => {
  it("delivers a verified kit and charges for it, never more than the cap shown", async () => {
    mocks.complete.mockImplementation((async () => {
      recordUsage({ prompt_tokens: 600, completion_tokens: 400 });
      return GOOD_REPLY;
    }) as KitComplete);
    const stream = await events(await POST(request()));
    expect(stream[0]).toMatchObject({ type: "start", estimate: 9, maxCredits: 20 });
    const done = stream.at(-1) as Extract<KitEvent, { type: "complete" }>;
    expect(done.type).toBe("complete");
    expect(done.result.cards[0].source).toMatchObject({ materialId: "mat-1", page: 1 });
    // The cap was reserved before any model call, then settled to the real cost.
    expect(mocks.reserve).toHaveBeenCalledWith("user-1", { estimate: 20, min: 20, reason: "study_kit" });
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]);
    expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ id: "hold-1" }), 10);

    // A run that used far more than expected is charged the promised cap.
    mocks.complete.mockImplementation((async () => {
      recordUsage({ prompt_tokens: 50_000, completion_tokens: 50_000 });
      return GOOD_REPLY;
    }) as KitComplete);
    await events(await POST(request()));
    expect(mocks.settle).toHaveBeenLastCalledWith(expect.objectContaining({ id: "hold-1" }), 20);
  });

  it("charges nothing when nothing verifiable was made, and says so", async () => {
    mocks.complete.mockImplementation((async () => {
      recordUsage({ prompt_tokens: 600, completion_tokens: 400 });
      return JSON.stringify({ cards: [{ front: "Q?", back: "A", page: 1, quote: "An invented sentence that appears nowhere in the material" }] });
    }) as KitComplete);
    const stream = await events(await POST(request()));
    expect(stream.at(-1)).toEqual({ type: "error", code: "generation_failed", message: en.materials.errors.failedNoCharge });
    expect(mocks.settle).not.toHaveBeenCalled();
    // The hold goes back in full; the failure counts against the daily quota.
    expect(mocks.release).toHaveBeenCalledWith(expect.objectContaining({ id: "hold-1" }));
    expect(mocks.claimFailure).toHaveBeenCalledWith("user-1", "study_kit_failed");
    expect(mocks.releaseFailure).not.toHaveBeenCalled();
  });

  it("pauses new kits after a few failed ones, before any model call or hold", async () => {
    mocks.claimFailure.mockResolvedValue({ allowed: false, slot: null });
    const stream = await events(await POST(request()));
    expect(stream).toEqual([
      { type: "error", code: "too_many_failures", message: en.materials.errors.tooManyFailures },
    ]);
    expect(mocks.claimFailure).toHaveBeenCalledWith("user-1", "study_kit_failed");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("a parallel run that loses the race for the credits is refused before any model call", async () => {
    mocks.reserve.mockResolvedValue(null);
    const stream = await events(await POST(request()));
    expect(stream.at(-1)).toMatchObject({ type: "error", code: "out_of_credits" });
    expect(mocks.complete).not.toHaveBeenCalled();
    // Not a failed run: the failure slot claimed up front is withdrawn.
    expect(mocks.releaseFailure).toHaveBeenCalledWith("slot-1");
  });

  it("stops before any model call without enough credits, or past the rate limit", async () => {
    // One section: typical 9, but a run needs one section's full cap (20).
    mocks.getCreditBalance.mockResolvedValue(15);
    const stream = await events(await POST(request()));
    expect(stream).toEqual([
      { type: "error", code: "out_of_credits", message: en.materials.errors.outOfCredits.replace("{estimate}", "20") },
    ]);
    expect(mocks.reserve).not.toHaveBeenCalled();
    mocks.getCreditBalance.mockResolvedValue(100);
    mocks.checkUsageLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    expect((await events(await POST(request()))).at(-1)).toMatchObject({ code: "rate_limited" });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("someone else's material (or a trashed workspace's) is not found", async () => {
    mocks.auth.mockResolvedValue({ userId: "intruder" });
    const stream = await events(await POST(request()));
    expect(stream).toEqual([{ type: "error", code: "not_found", message: en.materials.errors.notFound }]);
    expect(mocks.getMaterial).toHaveBeenCalledWith("intruder", "mat-1", "ws-1");
  });

  it("cancel stops the server work: nothing delivered, only consumed tokens billed, only by the owner", async () => {
    let started!: () => void;
    const callStarted = new Promise<void>((resolve) => (started = resolve));
    mocks.complete.mockImplementation((async (_s, _u, { signal }) => {
      const aborted = new Promise((resolve) => signal.addEventListener("abort", resolve));
      started();
      await aborted;
      // The cut-off model call reports what it consumed so far.
      recordUsage({ prompt_tokens: 300, completion_tokens: 0 });
      throw new Error("aborted");
    }) as KitComplete);

    const response = await POST(request({ generationId: "kit-12345678" }));
    const streamed = events(response);
    await callStarted;

    mocks.auth.mockResolvedValueOnce({ userId: "intruder" });
    const foreign = await CANCEL(
      new Request("http://localhost/api/materials/generate/cancel", {
        method: "POST",
        body: JSON.stringify({ generationId: "kit-12345678" }),
      }),
    );
    expect(await foreign.json()).toEqual({ cancelled: false });

    const own = await CANCEL(
      new Request("http://localhost/api/materials/generate/cancel", {
        method: "POST",
        body: JSON.stringify({ generationId: "kit-12345678" }),
      }),
    );
    expect(await own.json()).toEqual({ cancelled: true });

    const stream = await streamed;
    expect(stream.some((e) => e.type === "complete" || e.type === "error")).toBe(false);
    expect(mocks.settle).toHaveBeenCalledTimes(1);
    expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ id: "hold-1" }), 3, {
      reason: "study_kit_cancelled",
    });
    // Not a failed run: the failure slot claimed up front is withdrawn.
    expect(mocks.releaseFailure).toHaveBeenCalledWith("slot-1");
  });

  it("rejects malformed requests", async () => {
    expect((await POST(request({ outputs: { notes: false, flashcards: false, quiz: false } }))).status).toBe(400);
    expect((await POST(request({ materialId: "../../x" }))).status).toBe(400);
    expect((await POST(request({ amount: "infinite" }))).status).toBe(400);
  });
});
