import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import {
  executeAgentEdit,
  planAgentTurn,
  workspaceAreas,
} from "@/lib/ai/agent";
import type {
  AgentArea,
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
  getWorkspace,
  updateWorkspace,
} from "@/lib/workspace/store";

export const runtime = "nodejs";
export const maxDuration = 120;

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
      let ticker: ReturnType<typeof setInterval> | null = null;

      const send = (event: AgentStreamEvent) => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };

      const finish = () => {
        if (ticker) clearInterval(ticker);
        ticker = null;
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
        const workspace = await getWorkspace(workspaceId);
        if (!workspace) {
          send({ type: "error", message: T.ai.agent.workspaceNotFound });
          finish();
          return;
        }

        if (!(await hasCredits(userId))) {
          send({
            type: "error",
            message:
              "You're out of AI credits. Add more from the Pricing page to keep using the agent.",
          });
          finish();
          return;
        }

        const model = modelForPlan(await getUserPlan());
        const allAreas = workspaceAreas(workspace);
        let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };

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
          send({
            type: "result",
            response: { reply: decision.reply, changed: false },
          });
          finish();
          return;
        }

        if (decision.action === "clarify") {
          await chargeCredits(userId, usageToCredits(usage), "agent");
          send({
            type: "result",
            response: {
              reply: decision.reply,
              changed: false,
              choices: decision.choices,
            },
          });
          finish();
          return;
        }

        send({
          type: "plan",
          summary: decision.plan,
          areas: decision.affectedAreas,
        });
        for (const area of decision.affectedAreas) {
          send({
            type: "area",
            areaId: area.id,
            status: "queued",
            progress: 6,
          });
        }

        send({
          type: "phase",
          phase: "updating",
          message: T.ai.agent.updating,
          progress: 34,
        });

        const areaProgress = new Map(
          decision.affectedAreas.map((area) => [area.id, 6]),
        );
        let tick = 0;
        ticker = setInterval(() => {
          const activeCount = Math.min(
            decision.affectedAreas.length,
            1 + Math.floor(tick / 2),
          );
          for (let index = 0; index < activeCount; index += 1) {
            const area = decision.affectedAreas[index];
            const current = areaProgress.get(area.id) ?? 6;
            const next = Math.min(84, current + 6 + ((tick + index) % 4));
            areaProgress.set(area.id, next);
            send({
              type: "area",
              areaId: area.id,
              status: "working",
              progress: next,
            });
          }
          tick += 1;
        }, 500);

        const edited = await withUsageMeter(() =>
          executeAgentEdit(workspace, history, message, decision, model, locale),
        );
        const result = edited.result;
        usage = addUsage(usage, edited.usage);
        if (ticker) clearInterval(ticker);
        ticker = null;

        send({
          type: "phase",
          phase: "validating",
          message: T.ai.agent.validating,
          progress: 88,
        });
        for (const area of decision.affectedAreas) {
          send({
            type: "area",
            areaId: area.id,
            status: "complete",
            progress: 100,
          });
          await sleep(45);
        }

        if (!result.workspace) {
          throw new Error("Agent edit completed without a workspace");
        }
        send({
          type: "phase",
          phase: "saving",
          message: T.ai.agent.saving,
          progress: 97,
        });
        await updateWorkspace(workspaceId, result.workspace);
        await chargeCredits(userId, usageToCredits(usage), "agent");
        send({ type: "result", response: result });
        finish();
      } catch (error) {
        console.error("[StudyOS] streamed agent failed:", error);
        send({
          type: "error",
          message: T.ai.agent.error,
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
      progress: Math.min(18, 9 + index * 1.4),
    });
    await sleep(45);
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
