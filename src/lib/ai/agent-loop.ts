// src/lib/ai/agent-loop.ts
import "server-only";
import type { Workspace } from "@/lib/workspace/types";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { chatCompletion, type ChatMessage } from "./openrouter";
import { WORKSPACE_SHAPE, languageDirective } from "./generate";
import { applyAgentOps, type AgentOp } from "./agent-ops";
import { assertResultWithinLimits } from "./limits";
import { toolRegistry } from "./tools/registry";
import { skillRegistry } from "./skills/registry";
import "./skills/catalog"; // ensure Stage-1 skills + their tools are registered
import { workspaceAreas } from "./agent";
import type { AgentBudget } from "./budgets";
import {
  parseAgentPlan,
  parseAgentStep,
  type AgentPlanDecision,
} from "./agent-protocol";
import type {
  AgentArea,
  AgentMessage,
  AgentResponse,
  AgentStreamEvent,
} from "./agent-shared";
import { getDictionary } from "@/lib/i18n/dictionaries";

const MAX_HISTORY = 8;

export interface RunAgentLoopParams {
  workspace: Workspace;
  history: AgentMessage[];
  message: string;
  model: string;
  budget: AgentBudget;
  locale: Locale;
  taskId: string;
  emit: (event: AgentStreamEvent) => void | Promise<void>;
  now?: () => number;
}

/** Per-tool, plain-language hint about the input JSON, injected into the loop prompt. */
const TOOL_INPUT_HINTS: Record<string, string> = {
  summarize_workspace: "{}",
  find_entities: '{"query":"<substring>"}',
  read_area: '{"id":"<page or database id>"}',
  inspect_workspace: "{}",
  apply_ops:
    '{"ops":[ <minimal operations; same vocabulary as the editor> ]}  // e.g. {"op":"update_page","pageId":"<id>","title":"<new>"}',
};

export async function runAgentLoop(params: RunAgentLoopParams): Promise<AgentResponse> {
  const { workspace, history, message, model, budget, taskId } = params;
  const locale = params.locale ?? DEFAULT_LOCALE;
  const now = params.now ?? (() => Date.now());
  const emit = params.emit;
  const deadline = now() + budget.wallTimeMs;
  const areas = workspaceAreas(workspace);
  const dict = getDictionary(locale);

  let modelTurns = 0;
  const overBudget = () =>
    now() >= deadline || modelTurns >= budget.maxModelTurns;

  // ---- Plan ----------------------------------------------------------
  await emit({ type: "phase", phase: "planning", message: dict.agentChat.phase.planning, progress: 18 });
  modelTurns += 1;
  const planRaw = await chatCompletion(model, buildPlanMessages(history, message, areas, locale), 1400, { temperature: 0.2 });
  let plan: AgentPlanDecision;
  try {
    plan = parseAgentPlan(planRaw);
  } catch {
    // one bounded repair
    modelTurns += 1;
    const retry = await chatCompletion(model, buildPlanMessages(history, message, areas, locale, true), 1400, { temperature: 0 });
    plan = parseAgentPlan(retry);
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
  const allowedTools = skill.toolIds.filter((id) => toolRegistry.has(id));

  await emit({ type: "phase", phase: "updating", message: dict.agentChat.phase.updating, progress: 40 });

  let finalReply = dict.ai.agent.fallbackReply;
  while (!overBudget() && toolCalls < budget.maxToolCalls) {
    modelTurns += 1;
    const stepRaw = await chatCompletion(
      model,
      buildStepMessages(candidate, message, skill.instructions, allowedTools, observations, locale),
      4000,
      { temperature: 0.1 },
    );
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
    const ctx = { taskId, workspaceJson: JSON.stringify(candidate) };
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
      observations.push({ role: "user", content: `Tool ${step.tool} failed: ${error instanceof Error ? error.message : "error"}. Choose another action.` });
    }
  }

  // ---- Validate the candidate before handing it to the route ----
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
