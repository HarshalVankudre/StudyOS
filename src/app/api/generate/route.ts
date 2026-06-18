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
import { addUsage, withUsageMeter } from "@/lib/ai/usage-meter";
import { getUserPlan } from "@/lib/billing";
import { chargeCredits, hasCredits, usageToCredits } from "@/lib/credits";
import { getLocale } from "@/lib/i18n/server";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
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
  const locale = await getLocale();
  const T = getDictionary(locale);

  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: T.ai.errors.notAuthenticated }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: T.ai.errors.describeBeforeGenerating },
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

        if (!(await hasCredits(userId))) {
          send({
            type: "error",
            message:
              "You're out of AI credits. Add more from the Pricing page to keep generating.",
          });
          finish();
          return;
        }

        send({
          type: "phase",
          phase: "analyzing",
          message: T.ai.generate.phase.analyzing,
          progress: 8,
        });

        send({
          type: "phase",
          phase: "planning",
          message: T.ai.generate.phase.planning,
          progress: 18,
        });
        const planned = await withUsageMeter(() =>
          planWorkspace(prompt, model, preferences, locale),
        );
        const plan = planned.result;
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
          message: T.ai.generate.phase.generating,
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

        const generated = await withUsageMeter(() =>
          generateWorkspace(prompt, model, preferences, plan, locale),
        );
        const workspace = generated.result;
        if (ticker) clearInterval(ticker);
        ticker = null;

        // Spend credits for the GLM 5.2 tokens this generation actually used.
        await chargeCredits(
          userId,
          usageToCredits(addUsage(planned.usage, generated.usage)),
          "generate",
        );

        send({
          type: "phase",
          phase: "validating",
          message: T.ai.generate.phase.validating,
          progress: 88,
        });
        for (const component of plan.components) {
          send({
            type: "component",
            componentId: component.id,
            status: "complete",
            progress: 100,
            detail: componentDetail(workspace, component.kind, T),
          });
          await sleep(55);
        }

        send({
          type: "phase",
          phase: "saving",
          message: T.ai.generate.phase.saving,
          progress: 97,
        });
        const workspaceId = await saveNewWorkspace(workspace);
        send({ type: "complete", workspaceId });
        finish();
      } catch (error) {
        console.error("[StudyOS] streamed generation failed:", error);
        send({
          type: "error",
          message: T.ai.generate.error,
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
  T: Dictionary,
): string {
  const database = (term: string) =>
    workspace.databases.find((item) =>
      `${item.name} ${item.description ?? ""}`.toLowerCase().includes(term),
    );
  const d = T.ai.generate.detail;

  switch (kind) {
    case "dashboard":
      return fmt(d.dashboard, { count: workspace.pages.length });
    case "courses":
      return fmt(d.courses, { count: database("course")?.rows.length ?? 0 });
    case "assignments":
    case "projects":
    case "exams":
      return fmt(d.trackedItems, {
        count: database("assignment")?.rows.length ?? 0,
      });
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
      return fmt(d.scheduled, { count: datedRows });
    }
    case "readings":
      return fmt(d.readings, { count: database("reading")?.rows.length ?? 0 });
    case "habits":
      return fmt(d.habits, { count: database("habit")?.rows.length ?? 0 });
    case "grades":
      return fmt(d.grades, { count: database("grade")?.rows.length ?? 0 });
    case "notes":
      return d.notes;
    default:
      return d.generic;
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
