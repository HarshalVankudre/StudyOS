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
import { extractJson, WORKSPACE_SHAPE, languageDirective } from "./generate";
import { applyAgentOps, agentOpsSchema, type AgentOp } from "./agent-ops";
import { assertResultWithinLimits } from "./limits";
import { streamChatCompletion, type ChatMessage } from "./openrouter";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";

const MAX_HISTORY = 8;

/**
 * Shared options for the legacy model calls. `signal` lets a cancelled task
 * abort an in-flight OpenRouter request; `onReasoning` forwards streamed
 * "thinking" deltas so the legacy path shows live reasoning like the authentic
 * loop does. Both are optional — every existing caller keeps working unchanged.
 */
export interface AgentModelCallOptions {
  signal?: AbortSignal;
  onReasoning?: (text: string) => void;
}

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
  locale: Locale = DEFAULT_LOCALE,
  options: AgentModelCallOptions = {},
): Promise<AgentDecision> {
  requireAgentKey();

  const areas = workspaceAreas(current);
  const messages: ChatMessage[] = [
    { role: "system", content: buildPlannerSystemPrompt(areas, locale) },
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

  const raw = await streamChatCompletion(model, messages, 1400, {
    signal: options.signal,
    onReasoning: options.onReasoning,
  });
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
  locale: Locale = DEFAULT_LOCALE,
  options: AgentModelCallOptions = {},
): Promise<AgentResponse> {
  requireAgentKey();

  const messages: ChatMessage[] = [
    { role: "system", content: buildEditorSystemPrompt(locale) },
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
        "Return a concise reply and ONLY the operations needed for this change.",
      ].join("\n"),
    },
  ];

  // Operations are small, so this call stays cheap and fast no matter how large
  // the workspace is — the model never re-emits unchanged data.
  const raw = await streamChatCompletion(model, messages, 8000, {
    signal: options.signal,
    onReasoning: options.onReasoning,
  });
  const { reply, ops } = parseEditReply(
    raw,
    getDictionary(locale).ai.agent.fallbackReply,
  );

  // Apply the patch to the saved workspace, then validate the WHOLE result so a
  // bad operation can never persist a broken workspace.
  const applied = safeParseWorkspace(applyAgentOps(current, ops));
  if (!applied.success) {
    const issue = applied.error.issues[0];
    const where = issue
      ? `${issue.path.join(".") || "(root)"} — ${issue.message}`
      : applied.error.message;
    throw new Error(`Agent edit produced an invalid workspace: ${where}`);
  }

  return {
    reply,
    changed: true,
    workspace: applied.data,
    affectedAreas: decision.affectedAreas,
  };
}

/** Compatibility helper for non-streaming callers. */
export async function runAgent(
  current: Workspace,
  history: AgentMessage[],
  message: string,
  model: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<AgentResponse> {
  const decision = await planAgentTurn(current, history, message, model, locale);
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
  return executeAgentEdit(current, history, message, decision, model, locale);
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

const editReplySchema = z.object({
  reply: z.string().optional(),
  ops: agentOpsSchema,
});

function parseEditReply(
  raw: string,
  fallbackReply: string,
): { reply: string; ops: AgentOp[] } {
  // Reject an oversized result before parsing/cloning/persisting it.
  assertResultWithinLimits(raw);
  const parsed = editReplySchema.safeParse(extractJson(raw));
  if (!parsed.success) {
    // Pin the failure to the exact field so the server log says e.g.
    // `ops.0.databaseId — Required` instead of a wall of Zod text.
    const issue = parsed.error.issues[0];
    const where = issue
      ? `${issue.path.join(".") || "(root)"} — ${issue.message}`
      : parsed.error.message;
    throw new Error(`Agent returned invalid edit operations: ${where}`);
  }
  const reply = parsed.data.reply?.trim() || fallbackReply;
  return { reply, ops: parsed.data.ops };
}

function requireAgentKey() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "The AI agent needs an OpenRouter API key (add OPENROUTER_API_KEY to .env.local).",
    );
  }
}

function buildPlannerSystemPrompt(areas: AgentArea[], locale: Locale): string {
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
    "- Do not include an Other/custom choice; the interface always adds its own text field.",
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
    languageDirective(locale),
  ].join("\n");
}

function buildEditorSystemPrompt(locale: Locale): string {
  return [
    "You are the StudyOS workspace editor. The planning layer has already approved a clear edit.",
    "Apply the change as the SMALLEST possible list of operations. NEVER resend the whole workspace — only emit what actually changes.",
    "Return exactly one JSON object and nothing else:",
    '{"reply":"<1–3 concise sentences describing the result>","ops":[ ...operations... ]}',
    "",
    "Each operation is one of (always reuse the EXACT ids from the current workspace):",
    '- {"op":"update_row","databaseId":"<id>","rowId":"<id>","cells":{"<propertyId>":<value>}}   // change only these cells',
    '- {"op":"add_row","databaseId":"<id>","row":{"id":"<new>","cells":{...}}}',
    '- {"op":"delete_row","databaseId":"<id>","rowId":"<id>"}',
    '- {"op":"update_database","databaseId":"<id>","name"?,"icon"?,"description"?}',
    '- {"op":"add_database","database":<full Database>}',
    '- {"op":"delete_database","databaseId":"<id>"}',
    '- {"op":"replace_database","database":<full Database with the SAME id>}   // only for large single-database restructuring',
    '- {"op":"add_property","databaseId":"<id>","property":<DatabaseProperty>}',
    '- {"op":"update_property","databaseId":"<id>","property":<DatabaseProperty with the SAME id>}',
    '- {"op":"delete_property","databaseId":"<id>","propertyId":"<id>"}',
    '- {"op":"add_view","databaseId":"<id>","view":<DatabaseView>}',
    '- {"op":"update_view","databaseId":"<id>","view":<DatabaseView with the SAME id>}',
    '- {"op":"delete_view","databaseId":"<id>","viewId":"<id>"}',
    '- {"op":"add_page","page":<full Page>}',
    '- {"op":"update_page","pageId":"<id>","title"?,"icon"?}',
    '- {"op":"delete_page","pageId":"<id>"}',
    '- {"op":"set_page_blocks","pageId":"<id>","blocks":[<Block>...]}   // replace a page\'s blocks',
    '- {"op":"replace_page","page":<full Page with the SAME id>}',
    '- {"op":"update_workspace","name"?,"icon"?,"homePageId"?}',
    "",
    "RULES:",
    "- Emit ONLY operations needed for the request; never touch unrelated rows, properties, views, pages, or databases.",
    "- Apply the request everywhere it logically affects (e.g. adding a course may need new rows in several databases, a new select option, and a dashboard block) — but express each as its own minimal operation.",
    "- Reuse existing ids exactly. Invent new unique ids only for brand-new rows/properties/views/pages/databases.",
    "- cells are keyed by property id. select/status values are option ids; multi_select/relation are arrays of ids; dates are ISO strings; checkboxes are booleans; numbers are numbers.",
    "- When adding a database, also surface it with a database_view block on a relevant page (via set_page_blocks or replace_page). Never leave broken database/view references.",
    "- Unknown real-world facts should remain TBD rather than invented.",
    "- Valid colors: zinc, red, rose, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink.",
    "",
    "Shapes for any full objects you include (Database/Page/Block/etc.):",
    WORKSPACE_SHAPE,
    languageDirective(locale),
  ].join("\n");
}
