// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleWorkspace } from "@/lib/workspace/sample";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import {
  generateWorkspace,
  normalizePlanReply,
  parseGeneratedWorkspace,
  planQuestionsDetailed,
  planWorkspace,
} from "./generate";
import { studentClock } from "./student-clock";

/**
 * Model output that breaks a limit the prompt did not state (or the model
 * routinely exceeds) is trimmed or repaired; only output with nothing usable
 * in it is rejected.
 */

function stubModel(contents: string[]) {
  const bodies: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    const content = contents.shift() ?? "";
    return new Response(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

const reports = () =>
  (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const LONG = "A component description that runs well past the old hundred-and-forty character limit, because the model likes to explain exactly what each tracker will do for the student.";

describe("the workspace plan", () => {
  it("states its limits in the prompt", async () => {
    const { bodies } = stubModel([JSON.stringify({ workspaceName: "X", summary: "s", components: [] })]);
    await planWorkspace("CS student", "model");
    const system: string = JSON.parse(bodies[0]).messages[0].content;
    expect(system).toMatch(/description: one short sentence, at most \d+ characters/);
    expect(system).toMatch(/icon: exactly one emoji/);
  });

  it("keeps the model's plan when a description is too long (the QA ZodError)", async () => {
    stubModel([
      JSON.stringify({
        workspaceName: "Econ & Calc HQ",
        summary: "Deadlines and grades.",
        components: [
          { id: "dashboard", kind: "dashboard", label: "Dashboard", icon: "🏠", description: LONG },
          { id: "courses", kind: "courses", label: "Courses", icon: "📚", description: "Both courses." },
          { id: "problem-sets", kind: "assignments", label: "Problem Sets", icon: "✏️", description: LONG },
        ],
      }),
    ]);
    const plan = await planWorkspace("Econ student", "model");
    expect(plan.workspaceName).toBe("Econ & Calc HQ");
    expect(plan.components.map((c) => c.id)).toEqual(["dashboard", "courses", "problem-sets"]);
    expect(plan.components[0].description.length).toBeLessThanOrEqual(140);
    expect(plan.components[0].description.endsWith("…")).toBe(true);
    // No fallback was reported.
    expect(reports().some((line) => line.includes("planWorkspace"))).toBe(false);
  });

  it("repairs icons, ids, kinds and labels", () => {
    const plan = normalizePlanReply({
      workspaceName: "W".repeat(120),
      components: [
        { id: "Lab Notebook!", kind: "lab", label: "Lab Notebook", icon: "🧪🔬 lab", description: "" },
        { id: "lab-notebook", kind: "notes", label: "Lab Notebook", icon: "", description: "Notes." },
        { kind: "grades", label: "", icon: "💯", description: "No label: dropped." },
      ],
    })!;
    expect(plan.workspaceName.length).toBeLessThanOrEqual(80);
    expect(plan.components).toEqual([
      { id: "lab-notebook", kind: "custom", label: "Lab Notebook", icon: "🧪", description: "Lab Notebook" },
      { id: "lab-notebook-2", kind: "notes", label: "Lab Notebook", icon: "🗒️", description: "Notes." },
    ]);
  });

  it("falls back only when there is no component at all", async () => {
    expect(normalizePlanReply({ workspaceName: "X", components: [] })).toBeNull();
    expect(normalizePlanReply("nope")).toBeNull();
    stubModel(["not json"]);
    const plan = await planWorkspace("CS student", "model");
    expect(plan.components.length).toBeGreaterThanOrEqual(3);
    expect(reports().some((line) => line.includes("planWorkspace"))).toBe(true);
  });
});

describe("the onboarding questions", () => {
  it("keeps the model's questions when one label is too long", async () => {
    stubModel([
      JSON.stringify({
        questions: [
          {
            id: "track",
            question: "What do you want to keep track of?",
            type: "multi",
            options: [
              { id: "ps", label: "Problem sets and the weekly online homework in both courses", emoji: "✏️" },
              { id: "ex", label: "Exams", emoji: "🧪" },
            ],
          },
        ],
      }),
    ]);
    const result = await planQuestionsDetailed("Econ student", "model");
    expect(result.fromModel).toBe(true);
    expect(result.questions[0].options[0].label.length).toBeLessThanOrEqual(40);
  });

  it("uses the default questions when the reply has none", async () => {
    stubModel(['{"questions":[]}']);
    const result = await planQuestionsDetailed("Econ student", "model");
    expect(result.fromModel).toBe(false);
    expect(result.questions.length).toBeGreaterThan(0);
  });
});

describe("the generated workspace", () => {
  it("repairs a reply with a few bad pieces instead of throwing it away", () => {
    const reply = structuredClone(sampleWorkspace) as unknown as Record<string, unknown>;
    const pages = reply.pages as Array<{ blocks: unknown[] }>;
    pages[0].blocks.push({ id: "x", type: "toggle", text: "An unknown block type with text" });
    pages[0].blocks.push({ id: "y", type: "flashcards", cards: [{ id: "c", front: "Q".repeat(3000), back: "A" }] });
    const dbs = reply.databases as Array<{ views: unknown[] }>;
    dbs[1].views.push({ id: "bad", name: "Exams", type: "table", filters: [{ propertyId: "a-type", operator: "equals", value: "ty-exam" }] });
    const workspace = parseGeneratedWorkspace(JSON.stringify(reply));
    expect(safeParseWorkspace(workspace).success).toBe(true);
    const home = workspace.pages[0];
    expect(home.blocks.find((b) => b.id === "x")).toMatchObject({ type: "paragraph" });
    const deck = home.blocks.find((b) => b.id === "y");
    expect(deck?.type === "flashcards" && deck.cards[0].front.length).toBe(2000);
    // The rest of the workspace is intact.
    expect(workspace.databases).toHaveLength(sampleWorkspace.databases.length);
    expect(reports().some((line) => line.includes("repaired"))).toBe(true);
  });

  it("still rejects a reply with no workspace in it", () => {
    expect(() => parseGeneratedWorkspace("Sorry, I can't")).toThrow(/invalid workspace/);
    expect(() => parseGeneratedWorkspace('{"name":"x","pages":[],"databases":[]}')).toThrow(/invalid workspace/);
  });

  it("a repaired reply is used without a second paid call", async () => {
    const reply = structuredClone(sampleWorkspace) as unknown as { pages: Array<{ blocks: unknown[] }> };
    reply.pages[0].blocks.push({ id: "x", type: "kanban" });
    const { fetchMock } = stubModel([JSON.stringify(reply)]);
    const workspace = await generateWorkspace("CS", "model", "", undefined, "en", "", {
      clock: studentClock("UTC", new Date("2026-11-12T12:00:00Z")),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(workspace.pages.length).toBeGreaterThan(0);
  });
});
