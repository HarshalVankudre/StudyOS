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
import { createLiveProgress } from "@/lib/ai/generation-live";
import { findDeadlineDatabase } from "@/lib/ai/generate-polish";
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
  type CreditHold,
  getCreditBalance,
  releaseCreditHold,
  reserveCredits,
  settleCreditHold,
  usageToCredits,
} from "@/lib/credits";
import { MIN_GENERATION_BALANCE } from "@/lib/credits-info";
import {
  checkUsageLimit,
  isUsageLimitReached,
  MAX_WORKSPACES_PER_USER,
  recordFunnelEvent,
  recordUsageEvent,
  workspaceLimitReached,
} from "@/lib/usage-limits";
import { getLocale } from "@/lib/i18n/server";
import { MAX_SOURCE_INPUT, normalizeSourceText } from "@/lib/import/syllabus";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import { saveNewWorkspace } from "@/lib/workspace/store";
import { reportError } from "@/lib/ops/report-error";
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
        // 240: the "Other" answer field allows that much.
        answers: z.array(z.string().trim().min(1).max(240)).max(10),
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

      const sendFinal = (event: GenerationEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      // Nothing but the final "cancelled" event goes out after a cancel.
      const send = (event: GenerationEvent) => {
        if (!signal.aborted) sendFinal(event);
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

      // Set once the gates passed and model work began: only such a run
      // counts against the failed-generation quota.
      let started = false;
      // This build's credits, reserved before any model work (see below).
      let hold: CreditHold | null = null;
      try {
        const { prompt, answers } = parsed.data;

        // A build starts only with about one build's worth of credits: a
        // run is charged at most the remaining balance, so a near-empty
        // account would otherwise get a full build almost free.
        const balance = await getCreditBalance(userId);
        if (balance < MIN_GENERATION_BALANCE) {
          send({
            type: "error",
            code: "out_of_credits",
            message:
              balance <= 0
                ? T.credits.outGenerate
                : fmt(T.credits.belowGenerateMinimum, { min: MIN_GENERATION_BALANCE }),
          });
          finish();
          return;
        }

        if (await workspaceLimitReached(userId)) {
          send({
            type: "error",
            code: "workspace_limit",
            message: fmt(T.limits.workspaceCap, { max: MAX_WORKSPACES_PER_USER }),
          });
          finish();
          return;
        }

        // Failed builds are never charged, so they are bounded separately:
        // after a few in a day, new builds wait (see USAGE_LIMITS).
        if (await isUsageLimitReached(userId, "generate_failed")) {
          send({
            type: "error",
            code: "too_many_failures",
            message: T.limits.failedGenerations,
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

        // Reserve the build's credits before any model work, so parallel
        // builds cannot all start on the same balance. Settled to the real
        // cost once the work is done; given back when it is free (a failure).
        hold = await reserveCredits(userId, {
          estimate: MIN_GENERATION_BALANCE,
          min: MIN_GENERATION_BALANCE,
          reason: "generate",
        });
        if (!hold) {
          send({
            type: "error",
            code: "out_of_credits",
            message: fmt(T.credits.belowGenerateMinimum, { min: MIN_GENERATION_BALANCE }),
          });
          finish();
          return;
        }

        // Only now, past every gate, do any work on the request's text.
        const sourceText = normalizeSourceText(parsed.data.sourceText);
        const preferences = formatPreferences(answers);
        const model = modelForPlan(await getUserPlan());
        const clock = studentClock(
          resolveTimeZone([
            parsed.data.timeZone,
            timeZoneFromCookieHeader(request.headers.get("cookie")),
          ]),
        );
        started = true;

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

        // Progress follows what the model has actually written (databases,
        // rows, pages as they stream); the timer only fills the gaps.
        const live = createLiveProgress(plan, {
          generating: T.ai.generate.phase.generating,
          ...T.ai.generate.live,
        });
        ticker = setInterval(() => {
          if (!signal.aborted) live.tick().forEach(send);
        }, 700);

        const generated = await metered(() =>
          generateWorkspace(prompt, model, preferences, plan, locale, sourceText, {
            clock,
            signal,
            deadline: requestStartedAt + GENERATION_BUDGET_MS,
            onProgress: (event) => live.handle(event).forEach(send),
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
        // Charge only now that the student has a workspace: the real cost,
        // through the hold.
        const creditsCost = await settleCreditHold(hold, usageToCredits(usage)).catch((error) => {
          reportError(error, { source: "api", route: "/api/generate", method: "POST", userId });
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
          const charged = hold
            ? await settleCreditHold(hold, usageToCredits(usage), {
                reason: "generate_cancelled",
              }).catch(() => 0)
            : 0;
          // Tell the student what the stop cost, when they are still
          // listening (Cancel waits a moment for this before it disconnects).
          sendFinal({ type: "cancelled", credits: charged });
          finish();
          return;
        }
        reportError(error, { source: "api", route: "/api/generate", method: "POST", userId });
        // Nothing usable was delivered, so nothing is charged; the failure
        // counts against the small failed-generation quota instead.
        if (started) await recordUsageEvent(userId, "generate_failed");
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
        // Any outcome not settled above (a failure, an unexpected error) is
        // free: the held credits go back. A no-op after a settle.
        if (hold) await releaseCreditHold(hold).catch(() => false);
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
        count: (database("assignment") ?? findDeadlineDatabase(workspace))?.rows.length ?? 0,
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
      // No dates yet (the student gave none, and none are invented).
      return datedRows > 0 ? fmt(d.scheduled, { count: datedRows }) : d.scheduledNone;
    }
    case "readings":
      return fmt(d.readings, { count: database("reading")?.rows.length ?? 0 });
    case "habits":
      return fmt(d.habits, { count: database("habit")?.rows.length ?? 0 });
    case "grades": {
      // Grades are a calculator over the graded-work list (no grades table):
      // report how many graded items it reads.
      const block = workspace.pages.flatMap((page) => page.blocks).find((b) => b.type === "grades");
      const graded = block?.type === "grades" ? workspace.databases.find((db) => db.id === block.databaseId) : undefined;
      return fmt(d.grades, { count: graded?.rows.length ?? 0 });
    }
    case "notes":
      return d.notes;
    default:
      return d.generic;
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
