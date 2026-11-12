import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import {
  GenerationCancelledError,
  GenerationFailedError,
  generateWorkspace,
  generationTaskKey,
  planWorkspace,
} from "@/lib/ai/generate";
import {
  type GenerationEvent,
  type GenerationComponentKind,
} from "@/lib/ai/generation-progress";
import { formatPreferences } from "@/lib/ai/onboarding";
import { modelForPlan } from "@/lib/ai/plans";
import {
  resolveTimeZone,
  studentClock,
  timeZoneFromCookieHeader,
} from "@/lib/ai/student-clock";
import { registerActiveTask } from "@/lib/ai/tasks/cancellation";
import { addUsage, withUsageMeter, type TokenUsage } from "@/lib/ai/usage-meter";
import { getUserPlan } from "@/lib/billing";
import {
  chargeCredits,
  getCreditBalance,
  hasCredits,
  usageToCredits,
} from "@/lib/credits";
import { checkUsageLimit, recordFunnelEvent } from "@/lib/usage-limits";
import { getLocale } from "@/lib/i18n/server";
import { MAX_SOURCE_INPUT, normalizeSourceText } from "@/lib/import/syllabus";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import { saveNewWorkspace } from "@/lib/workspace/store";
import type { Workspace } from "@/lib/workspace/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Model work must finish by this long after the request started, leaving the
 * rest of maxDuration for validation, saving and charging.
 */
const GENERATION_BUDGET_MS = 270_000;

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
  // Optional pasted/uploaded course material (a syllabus) to ground on.
  // Re-normalized + hard-capped server-side by normalizeSourceText.
  sourceText: z.string().max(MAX_SOURCE_INPUT).optional().default(""),
  // The browser's IANA zone: the model is told the student's local date.
  timeZone: z.string().max(100).optional(),
  // Client-chosen id so POST /api/generate/cancel can stop this run.
  generationId: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,64}$/)
    .optional(),
});

const encoder = new TextEncoder();
const NO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0 };

/**
 * Run `fn` under a usage meter and keep the usage even when it throws, so a
 * cancelled run can be billed for exactly what it consumed.
 */
async function metered<T>(
  fn: () => Promise<T>,
): Promise<{ result?: T; error?: unknown; usage: TokenUsage }> {
  const { result, usage } = await withUsageMeter(async () => {
    try {
      return { ok: true as const, value: await fn() };
    } catch (error) {
      return { ok: false as const, error };
    }
  });
  return result.ok ? { result: result.value, usage } : { error: result.error, usage };
}

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
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

  // Cancellation: the student's Cancel aborts the fetch (which disconnects
  // this request and cancels the response stream) and also calls the cancel
  // endpoint, which aborts this controller through the task registry. Any of
  // the three stops model calls, and nothing is saved after it.
  const generation = new AbortController();
  const signal = generation.signal;
  const cancel = () => {
    if (!signal.aborted) generation.abort(new GenerationCancelledError());
  };
  const unregister = parsed.data.generationId
    ? registerActiveTask(generationTaskKey(userId, parsed.data.generationId), generation)
    : () => {};
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let ticker: ReturnType<typeof setInterval> | null = null;
      // Tokens consumed so far: billed only on success, or (what was really
      // consumed) on cancel. A failed generation is never billed.
      let usage: TokenUsage = NO_USAGE;

      const send = (event: GenerationEvent) => {
        if (closed || signal.aborted) return;
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

      const throwIfCancelled = () => {
        if (signal.aborted) throw new GenerationCancelledError();
      };

      try {
        const { prompt, answers } = parsed.data;
        const sourceText = normalizeSourceText(parsed.data.sourceText);
        const preferences = formatPreferences(answers);
        const model = modelForPlan(await getUserPlan());
        const clock = studentClock(
          resolveTimeZone([
            parsed.data.timeZone,
            timeZoneFromCookieHeader(request.headers.get("cookie")),
          ]),
        );

        if (!(await hasCredits(userId))) {
          send({
            type: "error",
            code: "out_of_credits",
            message: T.credits.outGenerate,
          });
          finish();
          return;
        }

        // Throttle after the credit gate: credits bound total spend, this
        // bounds burst rate (abuse, runaway clients).
        if (!(await checkUsageLimit(userId, "generate")).allowed) {
          send({ type: "error", code: "rate_limited", message: T.limits.rateLimited });
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
        const planned = await metered(() =>
          planWorkspace(prompt, model, preferences, locale, sourceText, { signal }),
        );
        usage = addUsage(usage, planned.usage);
        if (planned.error !== undefined) throw planned.error;
        const plan = planned.result!;
        throwIfCancelled();
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
          if (signal.aborted || plan.components.length === 0) return;
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

        const generated = await metered(() =>
          generateWorkspace(prompt, model, preferences, plan, locale, sourceText, {
            clock,
            signal,
            deadline: requestStartedAt + GENERATION_BUDGET_MS,
          }),
        );
        usage = addUsage(usage, generated.usage);
        if (ticker) clearInterval(ticker);
        ticker = null;
        if (generated.error !== undefined) throw generated.error;
        const workspace = generated.result!;
        throwIfCancelled();

        send({
          type: "phase",
          phase: "validating",
          message: T.ai.generate.phase.validating,
          progress: 88,
        });
        for (const component of plan.components) {
          throwIfCancelled();
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
        // Last gate before anything irreversible: a cancelled run is never saved.
        throwIfCancelled();
        const workspaceId = await saveNewWorkspace(workspace);
        // Charge only now that the student has a workspace.
        const creditsCost = await chargeCredits(
          userId,
          usageToCredits(usage),
          "generate",
        ).catch((error) => {
          console.error("[StudyOS] charging a generation failed:", error);
          return 0;
        });
        recordFunnelEvent(userId, "generate_complete");
        send({
          type: "complete",
          workspaceId,
          credits: creditsCost,
          balance: await getCreditBalance(userId),
        });
        finish();
      } catch (error) {
        if (error instanceof GenerationCancelledError || signal.aborted) {
          // Stopped by the student: nothing saved, and only the tokens the
          // model really consumed before the stop are billed.
          await chargeCredits(userId, usageToCredits(usage), "generate_cancelled").catch(
            () => 0,
          );
          finish();
          return;
        }
        console.error("[StudyOS] streamed generation failed:", error);
        // Nothing usable was delivered, so nothing is charged.
        send({
          type: "error",
          code: "generation_failed",
          message:
            error instanceof GenerationFailedError
              ? T.ai.generate.failedNoCharge
              : T.generate.errorBuild,
        });
        finish();
      } finally {
        unregister();
        request.signal.removeEventListener("abort", cancel);
      }
    },
    cancel() {
      // The client went away (Cancel, tab closed, navigation).
      cancel();
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
