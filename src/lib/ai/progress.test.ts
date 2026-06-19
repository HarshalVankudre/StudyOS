import { describe, expect, it } from "vitest";
import {
  PHASE_CEILINGS,
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

  it("reaches 100 only after the result event", () => {
    const initial = createInitialAgentActivity("Opening");
    const completed = reduceAgentActivity(initial, {
      type: "result",
      response: { reply: "Done", changed: false },
    });
    expect(completed.progress).toBe(100);
  });
});
