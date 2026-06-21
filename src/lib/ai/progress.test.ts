import { describe, expect, it } from "vitest";
import {
  PHASE_CEILINGS,
  THINKING_BUFFER_MAX,
  advanceAnimatedProgress,
  createInitialAgentActivity,
  reduceAgentActivity,
} from "./progress";

describe("Living Story progress", () => {
  it("never decreases confirmed progress", () => {
    const initial = createInitialAgentActivity("Opening");
    const atThirty = reduceAgentActivity(initial, {
      type: "phase",
      phase: "planning",
      message: "Shaping",
      progress: 30,
    });
    const stale = reduceAgentActivity(atThirty, {
      type: "phase",
      phase: "planning",
      message: "Still shaping",
      progress: 20,
    });
    expect(stale.progress).toBe(30);
  });

  it("deduplicates discoveries by id", () => {
    const initial = createInitialAgentActivity("Opening");
    const first = reduceAgentActivity(initial, {
      type: "discovery",
      discovery: { id: "layout", title: "Layout understood" },
      progress: 14,
    });
    const second = reduceAgentActivity(first, {
      type: "discovery",
      discovery: { id: "layout", title: "Layout understood again" },
      progress: 14,
    });
    expect(second.discoveries).toEqual([
      { id: "layout", title: "Layout understood again" },
    ]);
  });

  it("animates within a phase without crossing its ceiling", () => {
    let display = 35;
    for (let index = 0; index < 200; index += 1) {
      display = advanceAnimatedProgress(display, 35, "updating");
    }
    expect(display).toBe(PHASE_CEILINGS.updating - 2);
  });

  it("clamps confirmed progress to the active phase ceiling", () => {
    const initial = createInitialAgentActivity("Opening"); // inspecting, ceiling 15
    const overshoot = reduceAgentActivity(initial, {
      type: "discovery",
      discovery: { id: "x", title: "X" },
      progress: 90,
    });
    expect(overshoot.progress).toBe(PHASE_CEILINGS.inspecting);
  });

  it("reaches 100 only after the result event", () => {
    const initial = createInitialAgentActivity("Opening");
    const completed = reduceAgentActivity(initial, {
      type: "result",
      response: { reply: "Done", changed: false },
    });
    expect(completed.progress).toBe(100);
  });

  it("accumulates streamed thinking, caps the buffer, and leaves progress alone", () => {
    let s = createInitialAgentActivity("start");
    const before = s.progress;
    s = reduceAgentActivity(s, { type: "thinking", phase: "planning", delta: "abc" });
    s = reduceAgentActivity(s, { type: "thinking", phase: "planning", delta: "def" });
    expect(s.thinking).toBe("abcdef");
    expect(s.progress).toBe(before); // thinking is live narration, not progress

    const capped = reduceAgentActivity(s, {
      type: "thinking",
      phase: "updating",
      delta: "x".repeat(THINKING_BUFFER_MAX + 500),
    });
    expect(capped.thinking?.length).toBe(THINKING_BUFFER_MAX);
    expect(capped.thinking?.endsWith("x")).toBe(true);
  });

  it("records a plan and updates area status", () => {
    let s = createInitialAgentActivity("start");
    s = reduceAgentActivity(s, { type: "plan", summary: "Coordinating", areas: [{ id: "p1", type: "page", label: "Home" }] });
    expect(s.plan?.summary).toBe("Coordinating");
    expect(s.areas).toHaveLength(1);
    s = reduceAgentActivity(s, { type: "area", areaId: "p1", status: "working", progress: 60 });
    expect(s.areas.find((a) => a.id === "p1")?.status).toBe("working");
  });
});
