// src/lib/ai/agent-loop.ts
import "server-only";
import type { Workspace } from "@/lib/workspace/types";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { streamChatCompletion, type ChatMessage } from "./openrouter";
import { WORKSPACE_SHAPE, languageDirective } from "./generate";
import { applyAgentOps, type AgentOp } from "./agent-ops";
import { assertResultWithinLimits } from "./limits";
import { toolRegistry } from "./tools/registry";
import { skillRegistry } from "./skills/registry";
import "./skills/catalog"; // ensure Stage-1 skills + their tools are registered
import { workspaceAreas } from "./agent";
import type { AgentBudget } from "./budgets";
import {
  TaskCancelledError,
  isTaskCancelledError,
  throwIfTaskCancelled,
} from "./tasks/cancellation";
import {
  parseAgentPlan,
  parseAgentStep,
  type AgentPlanDecision,
} from "./agent-protocol";
import type {
  AgentArea,
  AgentMessage,
  AgentPhase,
  AgentResponse,
  AgentStreamEvent,
} from "./agent-shared";
import { getDictionary } from "@/lib/i18n/dictionaries";

const MAX_HISTORY = 8;

/** Thrown when a model call is cut off by the wall-clock deadline (not an error). */
class ModelDeadlineError extends Error {
  constructor() {
    super("model deadline reached");
    this.name = "ModelDeadlineError";
  }
}

export interface RunAgentLoopParams {
  workspace: Workspace;
  history: AgentMessage[];
  message: string;
  model: string;
  budget: AgentBudget;
  locale: Locale;
  taskId: string;
  /** Owner (Clerk userId); forwarded to tools so produced assets are owner-scoped. */
  ownerId: string;
  /**
   * Task cancellation signal. When it aborts, the loop stops the in-flight model
   * call, refuses further tool/validation work, and rejects with
   * `TaskCancelledError` (never a fallback reply) so the route exits cleanly.
   */
  signal?: AbortSignal;
  emit: (event: AgentStreamEvent) => void | Promise<void>;
  now?: () => number;
  /**
   * Wall-clock origin for the budget, in ms. Pass the request-handler start time
   * so the budget is measured from request invocation (which is also when the
   * route's `maxDuration` clock starts) rather than from loop entry — otherwise
   * the awaited route preamble silently eats into the reserved save tail.
   * Defaults to `now()` (loop entry) for tests.
   */
  startedAt?: number;
}

/** Per-tool, plain-language hint about the input JSON, injected into the loop prompt. */
const TOOL_INPUT_HINTS: Record<string, string> = {
  summarize_workspace: "{}",
  find_entities: '{"query":"<substring>"}',
  read_area: '{"id":"<page or database id>"}',
  inspect_workspace: "{}",
  apply_ops:
    '{"ops":[ <minimal operations; same vocabulary as the editor> ]}  // e.g. {"op":"update_page","pageId":"<id>","title":"<new>"}',
  run_in_sandbox:
    '{"inputs":[{"path":"main.tex","content":"..."}],"setup":[],"run":["pdflatex -interaction=nonstopmode main.tex","pdftoppm -png -r 200 main.pdf out/page"],"outputs":["out/page-1.png"],"timeoutSec":90}',
};

/**
 * Returns the subset of `skill.toolIds` that are registered AND enabled.
 * Disabled tools (e.g. flag-off) are invisible to the model.
 */
export function selectAllowedTools(skillToolIds: string[]): string[] {
  return skillToolIds.filter((id) => {
    const def = toolRegistry.get(id);
    return !!def && def.enabled !== false;
  });
}

export async function runAgentLoop(params: RunAgentLoopParams): Promise<AgentResponse> {
  const { workspace, history, message, model, budget, taskId, ownerId } = params;
  const locale = params.locale ?? DEFAULT_LOCALE;
  const now = params.now ?? (() => Date.now());
  const emit = params.emit;
  // Anchor the budget at request start (see `startedAt`) so the awaited route
  // preamble counts against it — the route's maxDuration clock starts there too.
  const deadline = (params.startedAt ?? now()) + budget.wallTimeMs;
  // Reserve a slice of the wall budget for the post-loop tail (validate, apply,
  // charge, persist) so a model call near the deadline cannot run past the
  // route's maxDuration and get hard-killed mid-save.
  const TAIL_RESERVE_MS = 10_000;
  const modelDeadline = deadline - TAIL_RESERVE_MS;
  const areas = workspaceAreas(workspace);
  const dict = getDictionary(locale);

  let modelTurns = 0;
  // Gate against the model deadline (not the full wall deadline) so no new turn
  // starts inside the reserved save-tail window.
  const overBudget = () =>
    now() >= modelDeadline || modelTurns >= budget.maxModelTurns;

  // One model call: streams the model's reasoning ("thinking") to the client
  // under `phase`, and aborts at the model deadline so a single turn cannot
  // overrun the budget. The signal is the wall-clock deadline ONLY — never the
  // request signal — so the durable task keeps working if the client drops and
  // can be recovered on reconnect.
  const callModel = async (
    messages: ChatMessage[],
    maxTokens: number,
    phase: AgentPhase,
    opts?: { temperature?: number },
  ): Promise<string> => {
    // Fail fast if the task was already cancelled before this turn started — the
    // model deadline signal alone can't represent a user Stop.
    throwIfTaskCancelled(params.signal);
    const remaining = modelDeadline - now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (remaining > 0) {
      timer = setTimeout(() => controller.abort(), remaining);
    } else {
      // Out of budget already — abort up front rather than issue an
      // un-timeboxed request that could run past maxDuration.
      controller.abort();
    }
    // Link task cancellation to this turn's deadline controller so a Stop aborts
    // the in-flight model call. Preserve the task's abort reason so the catch can
    // tell a user Stop (TaskCancelledError) apart from the wall-clock deadline.
    const abortFromTask = () =>
      controller.abort(params.signal?.reason ?? new TaskCancelledError());
    params.signal?.addEventListener("abort", abortFromTask, { once: true });
    try {
      return await streamChatCompletion(model, messages, maxTokens, {
        temperature: opts?.temperature,
        signal: controller.signal,
        onReasoning: (delta) => {
          void emit({ type: "thinking", phase, delta });
        },
      });
    } catch (error) {
      // User cancellation is classified first: it must never be mistaken for the
      // graceful deadline path (which would degrade to a fallback reply).
      if (params.signal?.aborted) throw new TaskCancelledError();
      // Translate our own deadline-abort into a typed signal so every caller can
      // distinguish "ran out of time" from a genuine transport/model error
      // deterministically (not by re-reading the clock).
      if (controller.signal.aborted) throw new ModelDeadlineError();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      params.signal?.removeEventListener("abort", abortFromTask);
    }
  };

  // Cancellation is checked at loop entry and at each model/tool/validation
  // boundary below; an aborted task throws TaskCancelledError out of the loop.
  throwIfTaskCancelled(params.signal);

  // ---- Plan ----------------------------------------------------------
  await emit({ type: "phase", phase: "planning", message: dict.agentChat.phase.planning, progress: 18 });
  let plan: AgentPlanDecision;
  try {
    modelTurns += 1;
    const planRaw = await callModel(buildPlanMessages(history, message, areas, locale), 1400, "planning", { temperature: 0.2 });
    try {
      plan = parseAgentPlan(planRaw);
    } catch {
      // one bounded repair
      modelTurns += 1;
      const retry = await callModel(buildPlanMessages(history, message, areas, locale, true), 1400, "planning", { temperature: 0 });
      plan = parseAgentPlan(retry);
    }
  } catch (error) {
    // Running out of budget during planning should degrade gracefully (a plain
    // reply), exactly like the step loop — not surface as a hard agent error.
    if (error instanceof ModelDeadlineError) {
      return { reply: dict.ai.agent.fallbackReply, changed: false };
    }
    throw error;
  }

  if (plan.action === "reply") return { reply: plan.reply, changed: false };
  if (plan.action === "clarify") return { reply: plan.reply, changed: false, choices: plan.choices };

  // ---- Execute ----
  const skill = skillRegistry.get(plan.skillId) ?? skillRegistry.get("precise-edit");
  if (!skill) throw new Error("no skill available");
  const affectedAreas = resolveAreas(plan.affectedAreaIds, areas);
  await emit({ type: "plan", summary: plan.summary, areas: affectedAreas });
  for (const area of affectedAreas) await emit({ type: "area", areaId: area.id, status: "queued", progress: 35 });

  let candidate = workspace;
  let changed = false;
  let toolCalls = 0;
  let repairs = 0;
  const observations: ChatMessage[] = [];
  const allowedTools = selectAllowedTools(skill.toolIds);

  await emit({ type: "phase", phase: "updating", message: dict.agentChat.phase.updating, progress: 40 });

  let finalReply = dict.ai.agent.fallbackReply;
  while (!overBudget() && toolCalls < budget.maxToolCalls) {
    modelTurns += 1;
    let stepRaw: string;
    try {
      stepRaw = await callModel(
        buildStepMessages(candidate, message, skill.instructions, allowedTools, observations, locale),
        4000,
        "updating",
        { temperature: 0.1 },
      );
    } catch (error) {
      // Hitting the model deadline mid-turn is expected near the budget ceiling:
      // stop gracefully and finalize with what the loop has so far. Re-throw
      // anything else (a genuine transport/model error).
      if (error instanceof ModelDeadlineError) break;
      throw error;
    }
    let step;
    try {
      step = parseAgentStep(stepRaw);
    } catch (error) {
      if (repairs >= budget.maxRepairs) break;
      repairs += 1;
      observations.push({ role: "user", content: `Your last message was not valid JSON (${error instanceof Error ? error.message : "parse error"}). Reply with exactly one JSON object: a tool call or {"action":"final","reply":"..."}.` });
      continue;
    }

    if (step.action === "final") {
      finalReply = step.reply;
      break;
    }

    // tool call
    toolCalls += 1;
    if (!allowedTools.includes(step.tool)) {
      observations.push({ role: "user", content: `Tool "${step.tool}" is not available for this task. Available: ${allowedTools.join(", ")}.` });
      continue;
    }
    const ctx = {
      taskId,
      ownerId,
      workspaceJson: JSON.stringify(candidate),
      signal: params.signal,
    };
    const def = toolRegistry.get(step.tool);
    try {
      const output = await toolRegistry.run(step.tool, step.input, ctx);
      // The orchestrator owns the candidate: fold a successful apply_ops in.
      if (step.tool === "apply_ops" && (output as { ok?: boolean }).ok) {
        const ops = (step.input as { ops: AgentOp[] }).ops;
        candidate = applyAgentOps(candidate, ops);
        changed = true;
        for (const area of affectedAreas) await emit({ type: "area", areaId: area.id, status: "working", progress: 60 });
      } else if (step.tool === "apply_ops") {
        if (repairs >= budget.maxRepairs) break;
        repairs += 1;
      }
      if (def?.toProgress) {
        const progress = def.toProgress(step.input as never, output as never);
        await emit({ type: "discovery", discovery: { id: `tool-${toolCalls}`, title: progress.title, detail: progress.detail }, progress: 65 });
      }
      observations.push({ role: "assistant", content: JSON.stringify(step) });
      observations.push({ role: "user", content: `Observation from ${step.tool}: ${JSON.stringify(output).slice(0, 4000)}` });
    } catch (error) {
      // A cancelled task surfaces here as a tool abort — never feed it back as a
      // recoverable tool failure; let it end the loop.
      if (isTaskCancelledError(error, params.signal)) throw error;
      observations.push({ role: "user", content: `Tool ${step.tool} failed: ${error instanceof Error ? error.message : "error"}. Choose another action.` });
    }
  }

  // ---- Validate the candidate before handing it to the route ----
  // Cancellation boundary: don't spend validation work on a stopped task.
  throwIfTaskCancelled(params.signal);
  await emit({ type: "phase", phase: "validating", message: dict.agentChat.phase.validating, progress: 80 });
  for (const area of affectedAreas) await emit({ type: "area", areaId: area.id, status: "complete", progress: 88 });

  if (!changed) return { reply: finalReply, changed: false, affectedAreas };

  assertResultWithinLimits(JSON.stringify(candidate));
  const validated = safeParseWorkspace(candidate);
  if (!validated.success) {
    throw new Error(`Agent produced an invalid workspace: ${validated.error.issues[0]?.message ?? "schema"}`);
  }
  return { reply: finalReply, changed: true, workspace: validated.data, affectedAreas };
}

function resolveAreas(ids: string[], areas: AgentArea[]): AgentArea[] {
  const found = ids.map((id) => areas.find((a) => a.id === id)).filter((a): a is AgentArea => Boolean(a));
  return found.length ? found : areas.slice(0, 6);
}

function buildPlanMessages(history: AgentMessage[], message: string, areas: AgentArea[], locale: Locale, corrective = false): ChatMessage[] {
  const system = [
    "You are the planning layer of the StudyOS workspace agent. Decide what to do for the latest message.",
    "Return exactly one JSON object and nothing else, one of:",
    '{"action":"reply","reply":"<concise answer, no edit needed>"}',
    '{"action":"clarify","reply":"<one question>","choices":[{"id":"a","label":"<short>","value":"<full answer>"}]}  // 2-4 choices, only when materially ambiguous',
    '{"action":"execute","skillId":"<precise-edit|study-planner>","summary":"<one-sentence user-facing goal>","affectedAreaIds":["<existing id>"]}',
    "Pick study-planner for exam/assignment/revision/schedule work; otherwise precise-edit.",
    corrective ? "Your previous reply was not valid JSON. Return ONLY the JSON object." : "",
    "Valid workspace area ids:",
    JSON.stringify(areas),
    languageDirective(locale),
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: system },
    ...history.slice(-MAX_HISTORY).map((h): ChatMessage => ({ role: h.role, content: h.content })),
    { role: "user", content: `Workspace summary: ${areas.length} area(s).\nLatest user message: ${message}` },
  ];
}

function buildStepMessages(ws: Workspace, message: string, skillInstructions: string, allowedTools: string[], observations: ChatMessage[], locale: Locale): ChatMessage[] {
  const catalog = allowedTools.map((id) => `- ${id}: input ${TOOL_INPUT_HINTS[id] ?? "{}"}`).join("\n");
  const system = [
    "You are executing a StudyOS workspace change as a step-by-step tool loop.",
    "Skill guidance:", skillInstructions,
    "Return exactly one JSON object per turn, no prose:",
    '{"action":"tool","tool":"<id>","input":{...}}  OR  {"action":"final","reply":"<1-3 sentence summary of what you changed>"}',
    "Available tools:", catalog,
    "Rules: inspect before editing; stage changes only via apply_ops with the SMALLEST operations; reuse existing ids; cells are keyed by property id (select/status = option id, dates = ISO strings); after a successful apply_ops, verify then return final.",
    "Operation shapes for any full objects you include:", WORKSPACE_SHAPE,
    languageDirective(locale),
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `Workspace JSON:\n${JSON.stringify(ws)}\n\nUser request: ${message}` },
    ...observations.slice(-12),
  ];
}
