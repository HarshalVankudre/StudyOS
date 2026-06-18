import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import {
  generateWorkspace,
  planWorkspace,
} from "@/lib/ai/generate";
import {
  type GenerationEvent,
  type GenerationComponentKind,
} from "@/lib/ai/generation-progress";
import { formatPreferences } from "@/lib/ai/onboarding";
import { modelForPlan } from "@/lib/ai/plans";
import { getUserPlan } from "@/lib/billing";
import { saveNewWorkspace } from "@/lib/workspace/store";
import type { Workspace } from "@/lib/workspace/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  answers: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(300),
        answers: z.array(z.string().trim().min(1).max(120)).max(10),
      }),
    )
    .max(10)
    .default([]),
});

const encoder = new TextEncoder();

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Describe your studies before generating a workspace." },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let ticker: ReturnType<typeof setInterval> | null = null;

      const send = (event: GenerationEvent) => {
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
          // The browser may have cancelled the request during navigation.
        }
      };

      try {
        const { prompt, answers } = parsed.data;
        const preferences = formatPreferences(answers);
        const model = modelForPlan(await getUserPlan());

        send({
          type: "phase",
          phase: "analyzing",
          message: "Reading your courses, goals, and preferences",
          progress: 8,
        });

        send({
          type: "phase",
          phase: "planning",
          message: "Choosing the right workspace components",
          progress: 18,
        });
        const plan = await planWorkspace(prompt, model, preferences);
        send({ type: "plan", plan });
        for (const component of plan.components) {
          send({
            type: "component",
            componentId: component.id,
            status: "queued",
            progress: 6,
          });
        }

        send({
          type: "phase",
          phase: "generating",
          message: "Generating your complete workspace in one pass",
          progress: 30,
        });

        const componentProgress = new Map(
          plan.components.map((component) => [component.id, 6]),
        );
        let tick = 0;
        ticker = setInterval(() => {
          if (request.signal.aborted || plan.components.length === 0) return;
          const activeCount = Math.min(
            plan.components.length,
            1 + Math.floor(tick / 2),
          );
          for (let index = 0; index < activeCount; index += 1) {
            const component = plan.components[index];
            const current = componentProgress.get(component.id) ?? 6;
            const next = Math.min(82, current + 5 + ((tick + index) % 4));
            componentProgress.set(component.id, next);
            send({
              type: "component",
              componentId: component.id,
              status: "generating",
              progress: next,
            });
          }
          tick += 1;
        }, 550);

        const workspace = await generateWorkspace(
          prompt,
          model,
          preferences,
          plan,
        );
        if (ticker) clearInterval(ticker);
        ticker = null;

        send({
          type: "phase",
          phase: "validating",
          message: "Checking links, views, fields, and starter data",
          progress: 88,
        });
        for (const component of plan.components) {
          send({
            type: "component",
            componentId: component.id,
            status: "complete",
            progress: 100,
            detail: componentDetail(workspace, component.kind),
          });
          await sleep(55);
        }

        send({
          type: "phase",
          phase: "saving",
          message: "Saving your editable workspace",
          progress: 97,
        });
        const workspaceId = await saveNewWorkspace(workspace);
        send({ type: "complete", workspaceId });
        finish();
      } catch (error) {
        console.error("[StudyOS] streamed generation failed:", error);
        send({
          type: "error",
          message:
            "The workspace could not be generated. Please try again with a shorter description.",
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

function componentDetail(
  workspace: Workspace,
  kind: GenerationComponentKind,
): string {
  const database = (term: string) =>
    workspace.databases.find((item) =>
      `${item.name} ${item.description ?? ""}`.toLowerCase().includes(term),
    );

  switch (kind) {
    case "dashboard":
      return `${workspace.pages.length} editable pages connected`;
    case "courses":
      return `${database("course")?.rows.length ?? 0} courses added`;
    case "assignments":
    case "projects":
    case "exams":
      return `${database("assignment")?.rows.length ?? 0} tracked items added`;
    case "planner": {
      const datedRows = workspace.databases.reduce(
        (total, item) =>
          total +
          item.rows.filter((row) =>
            item.properties.some(
              (property) =>
                property.type === "date" &&
                typeof row.cells[property.id] === "string",
            ),
          ).length,
        0,
      );
      return `${datedRows} items scheduled`;
    }
    case "readings":
      return `${database("reading")?.rows.length ?? 0} reading items added`;
    case "habits":
      return `${database("habit")?.rows.length ?? 0} routines added`;
    case "grades":
      return `${database("grade")?.rows.length ?? 0} grade rows added`;
    case "notes":
      return "Editable note structure created";
    default:
      return "Component created and connected";
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
