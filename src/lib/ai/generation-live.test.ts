import { describe, expect, it } from "vitest";
import { createLiveProgress } from "./generation-live";
import type { GenerationEvent, WorkspaceGenerationPlan } from "./generation-progress";

const PLAN: WorkspaceGenerationPlan = {
  workspaceName: "Econ HQ",
  summary: "s",
  components: [
    { id: "dashboard", kind: "dashboard", label: "Dashboard", icon: "🏠", description: "d" },
    { id: "courses", kind: "courses", label: "Courses", icon: "📚", description: "c" },
    { id: "problem-sets", kind: "assignments", label: "Problem Sets", icon: "✏️", description: "p" },
  ],
};

const MESSAGES = {
  locale: "en",
  generating: "Generating",
  database: "Setting up {name}",
  rows: { one: "{name}: {count} item so far", other: "{name}: {count} items so far" },
  page: "Writing the “{title}” page",
};

const phases = (events: GenerationEvent[]) =>
  events.flatMap((e) => (e.type === "phase" ? [{ message: e.message, progress: e.progress }] : []));

describe("createLiveProgress", () => {
  it("names what is being written and lights up the matching component", () => {
    const live = createLiveProgress(PLAN, MESSAGES);
    const first = live.handle({ type: "database", name: "Courses", chars: 200, attempt: 1 });
    expect(phases(first)[0].message).toBe("Setting up Courses");
    expect(first).toContainEqual({ type: "component", componentId: "courses", status: "generating", progress: 30 });

    const rows = live.handle({ type: "rows", database: "Courses", count: 4, chars: 900, attempt: 1 });
    expect(phases(rows)[0].message).toBe("Courses: 4 items so far");
    expect(rows).toContainEqual({ type: "component", componentId: "courses", status: "generating", progress: 50 });

    // A new database for another component: the earlier one is as good as done.
    const next = live.handle({ type: "database", name: "Problem sets & homework", chars: 1200, attempt: 1 });
    expect(next).toContainEqual({ type: "component", componentId: "courses", status: "generating", progress: 90 });
    expect(next).toContainEqual({ type: "component", componentId: "problem-sets", status: "generating", progress: 30 });

    const page = live.handle({ type: "page", title: "Dashboard", chars: 5000, attempt: 1 });
    expect(phases(page)[0].message).toBe("Writing the “Dashboard” page");
  });

  it("moves the bar with the reply but never past the build phase", () => {
    const live = createLiveProgress(PLAN, MESSAGES);
    let last = 0;
    for (let chars = 0; chars <= 60_000; chars += 1_500) {
      for (const p of phases(live.handle({ type: "text", chars, attempt: 1 }))) {
        expect(p.progress).toBeGreaterThanOrEqual(last);
        expect(p.progress).toBeLessThanOrEqual(86);
        expect(p.message).toBe("Generating");
        last = p.progress;
      }
    }
    expect(last).toBe(86);
  });

  it("the timer only nudges, and never completes a component", () => {
    const live = createLiveProgress(PLAN, MESSAGES);
    for (let i = 0; i < 200; i += 1) {
      for (const event of live.tick()) {
        expect(event.type).toBe("component");
        if (event.type === "component") {
          expect(event.status).toBe("generating");
          expect(event.progress).toBeLessThanOrEqual(85);
        }
      }
    }
  });
});
