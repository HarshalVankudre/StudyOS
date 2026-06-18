/**
 * StudyOS in-workspace AI agent.
 *
 * Each turn has an explicit planning pass before any mutation. The planner sees
 * the complete workspace and decides whether to answer, clarify, or edit. For
 * edits it names the affected pages/databases, then a second call atomically
 * rewrites and validates the complete workspace.
 */
import { z } from "zod";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import type { Workspace } from "@/lib/workspace/types";
import {
  type AgentArea,
  type AgentChoice,
  type AgentMessage,
  type AgentResponse,
} from "./agent-shared";
import { extractJson, WORKSPACE_SHAPE } from "./generate";
import { chatCompletion, type ChatMessage } from "./openrouter";

const MAX_HISTORY = 8;

const decisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reply"),
    reply: z.string().min(1),
  }),
  z.object({
    action: z.literal("clarify"),
    reply: z.string().min(1),
    choices: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1).max(80),
          value: z.string().min(1).max(300),
        }),
      )
      .min(2)
      .max(4),
  }),
  z.object({
    action: z.literal("edit"),
    plan: z.string().min(1).max(400),
    affectedAreaIds: z.array(z.string()).min(1),
  }),
]);

export type AgentDecision =
  | { action: "reply"; reply: string }
  | { action: "clarify"; reply: string; choices: AgentChoice[] }
  | {
      action: "edit";
      plan: string;
      affectedAreaIds: string[];
      affectedAreas: AgentArea[];
    };

export async function planAgentTurn(
  current: Workspace,
  history: AgentMessage[],
  message: string,
  model: string,
): Promise<AgentDecision> {
  requireAgentKey();

  const areas = workspaceAreas(current);
  const messages: ChatMessage[] = [
    { role: "system", content: buildPlannerSystemPrompt(areas) },
    ...history.slice(-MAX_HISTORY).map(
      (item): ChatMessage => ({
        role: item.role,
        content: item.content,
      }),
    ),
    {
      role: "user",
      content: [
        "Complete current workspace JSON:",
        JSON.stringify(current),
        "",
        `Latest user message: ${message}`,
      ].join("\n"),
    },
  ];

  const raw = await chatCompletion(model, messages, 1400);
  const parsed = decisionSchema.safeParse(extractJson(raw));
  if (!parsed.success) {
    throw new Error(`Agent planning returned invalid JSON: ${parsed.error.message}`);
  }

  if (parsed.data.action !== "edit") return parsed.data;

  const affectedAreas = parsed.data.affectedAreaIds
    .map((id) => areas.find((area) => area.id === id))
    .filter((area): area is AgentArea => Boolean(area));

  return {
    ...parsed.data,
    affectedAreas:
      affectedAreas.length > 0
        ? affectedAreas
        : inferAllRelevantAreas(current),
  };
}

export async function executeAgentEdit(
  current: Workspace,
  history: AgentMessage[],
  message: string,
  decision: Extract<AgentDecision, { action: "edit" }>,
  model: string,
): Promise<AgentResponse> {
  requireAgentKey();

  const messages: ChatMessage[] = [
    { role: "system", content: buildEditorSystemPrompt() },
    ...history.slice(-MAX_HISTORY).map(
      (item): ChatMessage => ({
        role: item.role,
        content: item.content,
      }),
    ),
    {
      role: "user",
      content: [
        "Complete current workspace JSON:",
        JSON.stringify(current),
        "",
        `User request: ${message}`,
        "",
        `Approved edit plan: ${decision.plan}`,
        `Affected workspace areas: ${decision.affectedAreas
          .map((area) => `${area.type}:${area.id}:${area.label}`)
          .join(", ")}`,
        "",
        "Return the complete updated workspace and a concise reply.",
      ].join("\n"),
    },
  ];

  const raw = await chatCompletion(model, messages, 7000);
  const result = parseEditReply(raw);
  return {
    ...result,
    affectedAreas: decision.affectedAreas,
  };
}

/** Compatibility helper for non-streaming callers. */
export async function runAgent(
  current: Workspace,
  history: AgentMessage[],
  message: string,
  model: string,
): Promise<AgentResponse> {
  const decision = await planAgentTurn(current, history, message, model);
  if (decision.action === "reply") {
    return { reply: decision.reply, changed: false };
  }
  if (decision.action === "clarify") {
    return {
      reply: decision.reply,
      changed: false,
      choices: decision.choices,
    };
  }
  return executeAgentEdit(current, history, message, decision, model);
}

export function workspaceAreas(workspace: Workspace): AgentArea[] {
  return [
    ...workspace.pages.map(
      (page): AgentArea => ({
        id: page.id,
        type: "page",
        label: page.title,
        icon: page.icon,
      }),
    ),
    ...workspace.databases.map(
      (database): AgentArea => ({
        id: database.id,
        type: "database",
        label: database.name,
        icon: database.icon,
      }),
    ),
  ];
}

function inferAllRelevantAreas(workspace: Workspace): AgentArea[] {
  return workspaceAreas(workspace).slice(0, 10);
}

function parseEditReply(raw: string): AgentResponse {
  const data = extractJson(raw) as Record<string, unknown>;
  const reply =
    typeof data.reply === "string" && data.reply.trim()
      ? data.reply.trim()
      : "Updated your workspace.";
  const parsed = safeParseWorkspace(data.workspace);
  if (!parsed.success) {
    throw new Error(`Agent returned an invalid workspace: ${parsed.error.message}`);
  }
  return { reply, changed: true, workspace: parsed.data };
}

function requireAgentKey() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "The AI agent needs an OpenRouter API key (add OPENROUTER_API_KEY to .env.local).",
    );
  }
}

function buildPlannerSystemPrompt(areas: AgentArea[]): string {
  return [
    "You are the planning and safety layer for the StudyOS workspace agent.",
    "You receive the complete saved workspace and the conversation. Decide what should happen BEFORE any data is changed.",
    "",
    "Return exactly one JSON object and nothing else.",
    "",
    "1) Answer without editing:",
    '{"action":"reply","reply":"<concise answer>"}',
    "",
    "2) Ask a clarifying question:",
    '{"action":"clarify","reply":"<one clear question>","choices":[{"id":"a","label":"<short button label>","value":"<complete answer sent back to you>"}]}',
    "",
    "3) Plan an edit:",
    '{"action":"edit","plan":"<specific one-sentence plan>","affectedAreaIds":["<existing page or database id>"]}',
    "",
    "CLARIFICATION RULES:",
    "- If a request is ambiguous, contradictory, references an unclear item, has multiple materially different interpretations, or lacks information needed to avoid a wrong change, you MUST clarify before editing.",
    "- Give 2–4 mutually exclusive, useful choices. Never make a destructive or broad assumption.",
    "- Do not clarify when the user gave enough detail for a safe reversible edit.",
    "",
    "WORKSPACE-AWARE EDITING RULES:",
    "- Inspect the whole workspace, not only the visible page.",
    "- Identify every existing page/database affected directly or through references.",
    "- For broad requests, include all relevant areas. Example: adding a course may affect Courses, planner/schedule, dashboard, assignment course options, notes, and grade trackers.",
    "- Preserve unrelated areas.",
    "",
    "Valid workspace area ids:",
    JSON.stringify(areas),
  ].join("\n");
}

function buildEditorSystemPrompt(): string {
  return [
    "You are the StudyOS workspace editor. The planning layer has already approved a clear edit.",
    "Return exactly one JSON object and nothing else:",
    '{"reply":"<1–3 concise sentences describing the result>","workspace":<COMPLETE updated workspace>}',
    "",
    "GLOBAL CONSISTENCY RULES:",
    "- You have a complete overview of the workspace. Apply the request everywhere it logically affects, including linked pages, database views, select options, dashboard blocks, calendars, schedules, and related starter rows.",
    "- Use the approved affected-area list as the minimum scope, but update another area if required to keep references and data consistent.",
    "- Preserve everything unrelated. Keep existing ids and values unless the request requires changing them.",
    "- Return the COMPLETE workspace, never a patch or fragment.",
    "- Invent unique ids for new entities.",
    "- cells are keyed by property id. select/status values are option ids; multi_select/relation are arrays of ids; dates are ISO strings; checkboxes are booleans; numbers are numbers.",
    "- If adding a database, expose it with a database_view block. New pages need an icon and useful blocks.",
    "- Keep homePageId valid. Never leave broken database/view references.",
    "- Unknown real-world facts should remain TBD rather than being invented.",
    "- Valid colors: zinc, red, rose, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink.",
    "",
    "The workspace must match this shape:",
    WORKSPACE_SHAPE,
  ].join("\n");
}
