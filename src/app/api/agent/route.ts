import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import {
  executeAgentEdit,
  planAgentTurn,
  workspaceAreas,
} from "@/lib/ai/agent";
import type {
  AgentArea,
  AgentResponse,
  AgentStreamEvent,
} from "@/lib/ai/agent-shared";
import { modelForPlan } from "@/lib/ai/plans";
import { addUsage, withUsageMeter, type TokenUsage } from "@/lib/ai/usage-meter";
import { getUserPlan } from "@/lib/billing";
import { chargeCredits, hasCredits, usageToCredits } from "@/lib/credits";
import { getLocale } from "@/lib/i18n/server";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import {
  WorkspaceVersionConflictError,
  applyAgentWorkspaceChange,
  getWorkspaceSnapshot,
} from "@/lib/workspace/version-service";
import {
  appendTaskEvent,
  createTask,
  isTaskCancelled,
  markTaskDone,
  markTaskError,
} from "@/lib/ai/tasks/store";
import { isAuthenticAgentEnabled } from "@/lib/flags";
import { runAgentLoop } from "@/lib/ai/agent-loop";
import { budgetForPlan } from "@/lib/ai/budgets";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  workspaceId: z.string().min(1).max(100),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(3000),
      }),
    )
    .max(12)
    .default([]),
  message: z.string().trim().min(1).max(2000),
});

const encoder = new TextEncoder();

export async function POST(request: Request) {
  // Captured before any await so the agent budget is measured from the same
  // instant as the route's `maxDuration` clock (request invocation).
  const requestStartedAt = Date.now();
  const locale = await getLocale();
  const T = getDictionary(locale);

  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: T.ai.errors.notAuthenticated }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: T.ai.errors.invalidAgentRequest }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let taskId: string | null = null;

      const send = (event: AgentStreamEvent) => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Navigation or closing the agent can cancel the response stream.
        }
      };

      try {
        const { workspaceId, history, message } = parsed.data;
        const snapshot = await getWorkspaceSnapshot(workspaceId);
        if (!snapshot) {
          send({ type: "error", message: T.ai.agent.workspaceNotFound });
          finish();
          return;
        }
        // baseVersion pins the workspace this task started from; the atomic apply
        // refuses to commit if a concurrent save advanced it in the meantime.
        const { workspace, version: baseVersion } = snapshot;

        if (!(await hasCredits(userId))) {
          send({
            type: "error",
            message: T.credits.outAgent,
          });
          finish();
          return;
        }

        // Durable record: survives a disconnect (reconnect by id) and carries a
        // cancel flag consulted before the workspace is changed.
        const task = await createTask({ workspaceId, baseVersion });
        taskId = task.id;
        send({ type: "task", taskId: task.id });

        // Persist every emitted event so a reconnect can replay the Living Story.
        // `thinking` is the exception: it's high-frequency, live-only reasoning,
        // so it streams to the client but is never persisted (a DB write per
        // delta would be wasteful and would crowd out real milestones in the
        // capped event log).
        const emit = async (event: AgentStreamEvent) => {
          send(event);
          if (event.type === "thinking") return;
          await appendTaskEvent(task.id, event).catch(() => {});
        };

        const model = modelForPlan(await getUserPlan());
        const allAreas = workspaceAreas(workspace);
        let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };

        let result: AgentResponse;

        if (isAuthenticAgentEnabled()) {
          // ---- Authentic agent tool-loop path --------------------------------
          const plan = await getUserPlan();
          const loop = await withUsageMeter(() =>
            runAgentLoop({
              workspace,
              history,
              message,
              model,
              budget: budgetForPlan(plan),
              locale,
              taskId: task.id,
              emit,
              startedAt: requestStartedAt,
            }),
          );
          result = loop.result;
          usage = addUsage(usage, loop.usage);

          // reply / clarify / no-change: no workspace to apply — settle immediately.
          if (!result.changed || !result.workspace) {
            await chargeCredits(userId, usageToCredits(usage), "agent");
            await markTaskDone(task.id, JSON.stringify(result));
            await emit({ type: "result", response: result });
            finish();
            return;
          }
        } else {
          // ---- Legacy path (unchanged): hardcoded phases + planAgentTurn/executeAgentEdit ----

          // ---- Understanding (0–15%) -----------------------------------------
          send({
            type: "phase",
            phase: "inspecting",
            message: fmt(T.ai.agent.inspecting, {
              pages: workspace.pages.length,
              databases: workspace.databases.length,
            }),
            progress: 8,
          });
          await streamInspection(send, allAreas.slice(0, 8), T);
          send({
            type: "discovery",
            discovery: {
              id: "workspace-understood",
              title: fmt(T.ai.agent.inspecting, {
                pages: workspace.pages.length,
                databases: workspace.databases.length,
              }),
            },
            progress: 15,
          });

          // ---- Shaping (15–35%) ----------------------------------------------
          send({
            type: "phase",
            phase: "planning",
            message: T.ai.agent.planning,
            progress: 22,
          });
          const planned = await withUsageMeter(() =>
            planAgentTurn(workspace, history, message, model, locale),
          );
          const decision = planned.result;
          usage = addUsage(usage, planned.usage);

          if (decision.action === "reply") {
            await chargeCredits(userId, usageToCredits(usage), "agent");
            const response: AgentResponse = { reply: decision.reply, changed: false };
            await markTaskDone(task.id, JSON.stringify(response));
            send({ type: "result", response });
            finish();
            return;
          }

          if (decision.action === "clarify") {
            await chargeCredits(userId, usageToCredits(usage), "agent");
            const response: AgentResponse = {
              reply: decision.reply,
              changed: false,
              choices: decision.choices,
            };
            await markTaskDone(task.id, JSON.stringify(response));
            send({ type: "result", response });
            finish();
            return;
          }

          // Title only: decision.plan is raw model output and could echo internal
          // ids/labels, so it is never rendered to the user. The affected areas
          // (safe, user-facing labels) are surfaced by the workspace-improved
          // discovery below.
          send({
            type: "discovery",
            discovery: {
              id: "change-shaped",
              title: T.ai.agent.planning,
            },
            progress: 34,
          });

          // ---- Improving (35–75%) --------------------------------------------
          send({
            type: "phase",
            phase: "updating",
            message: T.ai.agent.updating,
            progress: 35,
          });
          const edited = await withUsageMeter(() =>
            executeAgentEdit(workspace, history, message, decision, model, locale),
          );
          result = edited.result;
          usage = addUsage(usage, edited.usage);

          if (!result.workspace) {
            throw new Error("Agent edit completed without a workspace");
          }
          send({
            type: "discovery",
            discovery: {
              id: "workspace-improved",
              title: T.ai.agent.updating,
              detail: decision.affectedAreas
                .slice(0, 3)
                .map((area) => `${area.icon ?? "•"} ${area.label}`)
                .join(" · "),
            },
            progress: 74,
          });

          // ---- Checking (75–92%) ---------------------------------------------
          send({
            type: "phase",
            phase: "validating",
            message: T.ai.agent.validating,
            progress: 75,
          });
        }

        // ---- Shared tail: cancel guard → apply → charge → done → result -----
        // (runs for both the authentic-loop edit path and the legacy edit path)

        // The user may have cancelled while the edit was being produced; never
        // apply a cancelled task's result.
        if (await isTaskCancelled(task.id)) {
          finish();
          return;
        }

        // ---- Finishing (92–100%) -------------------------------------------
        await emit({
          type: "phase",
          phase: "saving",
          message: T.ai.agent.saving,
          progress: 92,
        });
        // result.workspace is guaranteed non-null here:
        //   flag-on path: returned early above if !result.workspace
        //   legacy path: threw above if !result.workspace
        const applied = await applyAgentWorkspaceChange(
          workspaceId,
          baseVersion,
          result.workspace!,
        );
        await chargeCredits(userId, usageToCredits(usage), "agent");
        const response: AgentResponse = {
          ...result,
          workspace: applied.workspace,
          changeId: applied.changeId,
        };
        await markTaskDone(task.id, JSON.stringify(response));
        await emit({ type: "result", response });
        finish();
      } catch (error) {
        console.error("[StudyOS] streamed agent failed:", error);
        if (taskId) await markTaskError(taskId, "error").catch(() => {});
        send({
          type: "error",
          message:
            error instanceof WorkspaceVersionConflictError
              ? T.ai.agent.workspaceChanged
              : T.ai.agent.error,
        });
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function streamInspection(
  send: (event: AgentStreamEvent) => void,
  areas: AgentArea[],
  T: Dictionary,
) {
  for (const [index, area] of areas.entries()) {
    send({
      type: "phase",
      phase: "inspecting",
      message: fmt(T.ai.agent.inspectingArea, { area: area.label }),
      // Stay within the Understanding band and at/above the opening 8% so the
      // emitted stream itself never regresses (not just the consumer's view).
      progress: Math.min(14, 8 + index * 0.8),
    });
  }
}
