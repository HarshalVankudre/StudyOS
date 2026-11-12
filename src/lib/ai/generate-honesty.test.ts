// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GenerationCancelledError,
  GenerationFailedError,
  generateWorkspace,
  planWorkspace,
} from "./generate";
import { studentClock } from "./student-clock";
import { withUsageMeter } from "./usage-meter";
import { sampleWorkspace } from "@/lib/workspace/sample";

type Reply = { status?: number; content?: string; finish?: string; usage?: Record<string, number> };

/** Stub OpenRouter with a queue of replies; records every request body. */
function stubModel(replies: Reply[]) {
  const bodies: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    if (init.signal?.aborted) throw init.signal.reason;
    const reply = replies.shift() ?? replies.at(-1) ?? {};
    if (reply.status && reply.status >= 400) {
      return new Response("upstream error", { status: reply.status });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: reply.content ?? "" }, finish_reason: reply.finish ?? "stop" }],
        usage: reply.usage ?? { prompt_tokens: 1000, completion_tokens: 500 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

const GOOD = JSON.stringify(sampleWorkspace);
const CLOCK = studentClock("America/Chicago", new Date("2026-11-12T18:05:00Z"));

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the model is told what day it is", () => {
  it("puts the student's local date, weekday, time and zone in the build prompt, after the stable prefix", async () => {
    const { bodies } = stubModel([{ content: GOOD }]);
    await generateWorkspace("CS student, add a midterm next Friday", "model", "", undefined, "en", "", {
      clock: CLOCK,
    });
    const body = JSON.parse(bodies[0]);
    const user: string = body.messages[1].content;
    expect(user).toContain("Thursday, 2026-11-12, 12:05 in America/Chicago (UTC-06:00)");
    expect(user).toContain("Fri 2026-11-20");
    // Cache-friendly: the (stable) system prompt never carries the clock.
    expect(body.messages[0].content).not.toContain("2026-11-12");
    expect(body.messages[0].content).toMatch(/never copy them/);
  });
});

describe("honest failure", () => {
  it("retries once, then fails with nothing billed", async () => {
    const { fetchMock } = stubModel([{ content: "not json" }, { content: '{"broken": true}' }]);
    const run = withUsageMeter(() =>
      generateWorkspace("CS student", "model", "", undefined, "en", "", { clock: CLOCK }),
    );
    const error = await run.catch((caught) => caught);
    expect(error).toBeInstanceOf(GenerationFailedError);
    expect((error as GenerationFailedError).reason).toBe("invalid_output");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bills only the attempt that succeeded", async () => {
    stubModel([
      { content: "garbage", usage: { prompt_tokens: 9000, completion_tokens: 9000 } },
      { content: GOOD, usage: { prompt_tokens: 1200, completion_tokens: 800 } },
    ]);
    const { result, usage } = await withUsageMeter(() =>
      generateWorkspace("CS student", "model", "", undefined, "en", "", { clock: CLOCK }),
    );
    expect(result.name).toBe(sampleWorkspace.name);
    expect(usage).toMatchObject({ promptTokens: 1200, completionTokens: 800 });
  });

  it("treats a truncated reply as a failure (and retries it)", async () => {
    const { fetchMock } = stubModel([
      { content: GOOD.slice(0, 200), finish: "length" },
      { content: GOOD },
    ]);
    await generateWorkspace("CS student", "model", "", undefined, "en", "", { clock: CLOCK });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an auth error", async () => {
    const { fetchMock } = stubModel([{ status: 401 }]);
    const error = await generateWorkspace("CS", "model", "", undefined, "en", "", { clock: CLOCK }).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(GenerationFailedError);
    expect((error as GenerationFailedError).reason).toBe("model_error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start a retry that would run past the deadline", async () => {
    const { fetchMock } = stubModel([{ content: "nope" }]);
    await expect(
      generateWorkspace("CS", "model", "", undefined, "en", "", {
        clock: CLOCK,
        deadline: Date.now() - 1,
      }),
    ).rejects.toBeInstanceOf(GenerationFailedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never serves a template in production when no AI key is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const error = await generateWorkspace("CS", "model").catch((caught) => caught);
    expect(error).toBeInstanceOf(GenerationFailedError);
    expect((error as GenerationFailedError).reason).toBe("not_configured");
  });
});

describe("cancellation", () => {
  it("stops before calling the model when already cancelled", async () => {
    const { fetchMock } = stubModel([{ content: GOOD }]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateWorkspace("CS", "model", "", undefined, "en", "", { clock: CLOCK, signal: controller.signal }),
    ).rejects.toBeInstanceOf(GenerationCancelledError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the in-flight call and does not retry", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const run = generateWorkspace("CS", "model", "", undefined, "en", "", {
      clock: CLOCK,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(GenerationCancelledError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("planning rethrows a cancel instead of falling back to a template plan", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );
    const run = planWorkspace("CS", "model", "", "en", "", { signal: controller.signal });
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(GenerationCancelledError);
  });
});

describe("syllabus grading weights and exam dates", () => {
  const syllabus = [
    "CS 201 Data Structures",
    "Grading: Problem sets 30%, Midterm 25%, Final exam 45%",
    "Midterm exam — Thursday, January 21",
  ].join("\n");

  it("are listed for the model as data", async () => {
    const { bodies } = stubModel([{ content: GOOD }]);
    await generateWorkspace("CS student", "model", "", undefined, "en", syllabus, { clock: CLOCK });
    const user: string = JSON.parse(bodies[0]).messages[1].content;
    expect(user).toContain("GRADED ITEMS FOUND");
    expect(user).toContain('"name":"Midterm","weightPercent":25,"date":"2027-01-21"');
  });

  it("land in the workspace's assignment data even when the model drops them", async () => {
    // The model "forgets" every graded item.
    const forgetful = structuredClone(sampleWorkspace);
    forgetful.databases.find((db) => db.id === "db-assignments")!.rows = [];
    stubModel([{ content: JSON.stringify(forgetful) }]);
    const workspace = await generateWorkspace("CS student", "model", "", undefined, "en", syllabus, {
      clock: CLOCK,
    });
    const assignments = workspace.databases.find((db) => db.id === "db-assignments")!;
    const cells = assignments.rows.map((row) => ({
      name: row.cells["a-name"],
      weight: row.cells["a-weight"],
      due: row.cells["a-due"],
    }));
    expect(cells).toEqual([
      { name: "Midterm", weight: 25, due: "2027-01-21" },
      { name: "Final exam", weight: 45, due: undefined },
    ]);
    // "Problem sets 30%" is shared by many items: a grading category, not a row.
    expect(assignments.grading?.categories).toEqual([
      expect.objectContaining({ name: "Problem sets", weight: 30 }),
    ]);
  });

  it("are applied in the no-key development mock too", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const workspace = await generateWorkspace("CS student", "model", "", undefined, "en", syllabus, {
      clock: CLOCK,
    });
    const text = JSON.stringify(workspace);
    // The mock has no final exam row, so the syllabus's one is added…
    expect(text).toContain('"a-name":"Final exam","a-weight":45');
    // …but its "Problem Set" rows already cover "Problem sets": no duplicate.
    expect(text).not.toContain('"a-name":"Problem sets"');
    // Mock starter dates are relative to the student's today, not the server's.
    expect(text).toContain("2026-11-14");
  });
});
