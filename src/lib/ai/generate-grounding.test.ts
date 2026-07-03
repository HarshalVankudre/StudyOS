import { afterEach, describe, expect, it, vi } from "vitest";
import { planWorkspace, generateWorkspace } from "./generate";
import { sampleWorkspace } from "@/lib/workspace/sample";

/**
 * The crux of syllabus grounding: the student's pasted course material must
 * actually reach the model prompt (not just be accepted and dropped). These
 * stub OpenRouter and assert the syllabus text lands in the request body.
 */
function stubOpenRouter(content: string) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    (stubOpenRouter as unknown as { body: string }).body = String(init.body);
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }], usage: {} }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("syllabus grounding reaches the model", () => {
  it("planWorkspace injects the syllabus into the plan prompt", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const plan = JSON.stringify({
      workspaceName: "X",
      summary: "s",
      components: [
        { id: "dashboard", kind: "dashboard", label: "D", icon: "🏠", description: "d" },
        { id: "courses", kind: "courses", label: "C", icon: "📚", description: "c" },
        { id: "assignments", kind: "assignments", label: "A", icon: "📝", description: "a" },
      ],
    });
    const fetchMock = stubOpenRouter(plan);
    await planWorkspace("CS student", "model", "", "en", "PHYS 200 Final on 2026-12-10");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = (stubOpenRouter as unknown as { body: string }).body;
    expect(body).toContain("PHYS 200 Final on 2026-12-10");
    expect(body.toLowerCase()).toContain("syllabus");
  });

  it("generateWorkspace injects the syllabus into the build prompt", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = stubOpenRouter(JSON.stringify(sampleWorkspace));
    await generateWorkspace(
      "CS student",
      "model",
      "",
      undefined,
      "en",
      "BIO 101 midterm 2026-10-05",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = (stubOpenRouter as unknown as { body: string }).body;
    expect(body).toContain("BIO 101 midterm 2026-10-05");
  });

  it("omits the grounding block entirely when no syllabus is given", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    stubOpenRouter(JSON.stringify(sampleWorkspace));
    await generateWorkspace("CS student", "model", "", undefined, "en", "");
    const body = (stubOpenRouter as unknown as { body: string }).body;
    expect(body.toLowerCase()).not.toContain("provided their own course material");
  });
});
