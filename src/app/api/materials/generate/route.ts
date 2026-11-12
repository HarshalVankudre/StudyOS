import { rejectCrossSite } from "@/lib/http/same-origin";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { modelForPlan } from "@/lib/ai/plans";
import { isAiConfigured } from "@/lib/ai/provider";
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
import {
  chargeForCompleted,
  chargeForPartial,
  studyKitPartQuote,
  studyKitQuote,
  type PriceQuote,
} from "@/lib/price-list";
import { isBillingConfigured } from "@/lib/stripe";
import { englishName } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import { getLocale } from "@/lib/i18n/server";
import { KIT_AMOUNTS, planRun } from "@/lib/materials/limits";
import { mockComplete, modelComplete } from "@/lib/materials/model";
import { KitCancelledError, KitFailedError, runStudyKit } from "@/lib/materials/pipeline";
import { acquireHeavySlot, readJsonBody } from "@/lib/materials/guard";
import { getMaterial } from "@/lib/materials/store";
import { studyKitTaskKey } from "@/lib/materials/task-key";
import type { KitEvent } from "@/lib/materials/types";
import { reportError } from "@/lib/ops/report-error";
import {
  checkUsageLimit,
  claimOutcomeSlot,
  recordFunnelEvent,
  releaseOutcomeSlot,
} from "@/lib/usage-limits";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Model work must finish by this long after the request started, leaving the
 * rest of maxDuration for verification and charging.
 */
const GENERATION_BUDGET_MS = 270_000;

const requestSchema = z.object({
  workspaceId: z.string().min(1).max(100),
  materialId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  outputs: z
    .object({ notes: z.boolean(), flashcards: z.boolean(), quiz: z.boolean() })
    .refine((o) => o.notes || o.flashcards || o.quiz),
  amount: z.enum(KIT_AMOUNTS as [string, ...string[]]),
  range: z
    .object({ from: z.number().int().positive(), to: z.number().int().positive() })
    .optional(),
  language: z.enum(["material", "interface"]).default("material"),
  generationId: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,64}$/)
    .optional(),
});

const encoder = new TextEncoder();
const NO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0 };

/**
 * Make a study kit (summary notes, flashcards, a practice quiz) from one of
 * the workspace's materials, streamed as NDJSON KitEvents. The result is
 * returned to the editor, which adds it as a page through its normal
 * (undoable, autosaved) edit path.
 *
 * Billing follows the price list (lib/price-list.ts): a kit costs a fixed
 * price per part (section) of the material it processes, the total shown in
 * the dialog before the student starts. A run starts only when the balance
 * covers that total, and reserves the most it can cost (a credit hold)
 * before any model call, so parallel runs cannot all start on the same
 * credits. A successful run is charged the price of the parts that delivered
 * something (parts that failed are free); a cancelled run the price of the
 * parts it had finished; on a model whose real cost exceeds the price, the
 * real cost, never more than the most shown up front. A run that delivers
 * nothing is free, and such failures are bounded by a small daily quota
 * (study_kit_failed) instead.
 */
export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const requestStartedAt = Date.now();
  const locale = await getLocale();
  const T = getDictionary(locale).materials;

  const { userId } = await auth();
  if (!userId) return Response.json({ code: "not_authenticated" }, { status: 401 });

  const read = await readJsonBody(request, 4096);
  if (!read.ok) return Response.json({ code: "invalid" }, { status: read.status });
  const parsed = requestSchema.safeParse(read.value);
  if (!parsed.success) return Response.json({ code: "invalid" }, { status: 400 });
  const body = parsed.data;

  // At most two runs at once per student (each holds a material in memory
  // and keeps several model calls in flight).
  const release = acquireHeavySlot("kit", userId);
  if (!release) return Response.json({ code: "rate_limited" }, { status: 429 });

  const generation = new AbortController();
  const signal = generation.signal;
  const cancel = () => {
    if (!signal.aborted) generation.abort(new KitCancelledError());
  };
  const unregister = body.generationId
    ? registerActiveTask(studyKitTaskKey(userId, body.generationId), generation)
    : () => {};
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let usage: TokenUsage = NO_USAGE;
      let model: string | undefined;
      // One part's price on the run's model, and the whole run's quote.
      let partQuote: PriceQuote | null = null;
      let runQuote: PriceQuote | null = null;
      // Parts the run reads, and those the pipeline finished (a cancelled
      // run pays for these).
      let partsPlanned = 0;
      let partsDone = 0;
      // The run's credits, reserved before any model work.
      let hold: CreditHold | null = null;
      // Set once every gate passed and model work began: only such a run
      // counts against the failed-run quota.
      let started = false;
      // The failed-run event claimed before the run; kept only if it fails.
      let failureSlot: string | null = null;
      let failed = false;

      const send = (event: KitEvent) => {
        if (closed || signal.aborted) return;
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
          // The browser may already have gone.
        }
      };
      const fail = (code: Extract<KitEvent, { type: "error" }>["code"], message: string) => {
        send({ type: "error", code, message });
        finish();
      };

      try {
        const material = await getMaterial(userId, body.materialId, body.workspaceId);
        if (!material) return fail("not_found", T.errors.notFound);
        const plan = planRun(
          material.pages.map((p) => p.length),
          body.range,
        );
        if (plan.sections.length === 0) return fail("invalid", T.errors.nothingToRead);

        const planModel = modelForPlan(await getUserPlan());
        model = planModel;
        const configured = isAiConfigured(planModel);
        if (!configured && process.env.NODE_ENV === "production") {
          return fail("not_configured", T.errors.failedNoCharge);
        }

        // A run is charged at most the balance, so require its whole price up
        // front (otherwise a nearly empty account would get a kit for a few
        // credits). Priced for the model this run uses, as the dialog
        // showed it.
        partQuote = studyKitPartQuote(planModel);
        const cost = studyKitQuote(plan.sections.length, partQuote);
        runQuote = cost;
        partsPlanned = plan.sections.length;
        const minBalance = Math.max(1, cost.price);
        const outOfCredits = () =>
          fail(
            "out_of_credits",
            fmt(isBillingConfigured() ? T.errors.outOfCredits : T.errors.outOfCreditsNoBilling, {
              estimate: minBalance,
            }),
          );
        if ((await getCreditBalance(userId)) < minBalance) return outOfCredits();
        // Failed runs are never charged, so they are bounded separately.
        // Claimed up front and atomically (a run in flight counts as a
        // possible failure), so parallel runs cannot all start past the
        // quota; withdrawn in `finally` unless the run fails.
        const claim = await claimOutcomeSlot(userId, "study_kit_failed");
        failureSlot = claim.slot;
        if (!claim.allowed) {
          return fail("too_many_failures", T.errors.tooManyFailures);
        }
        if (!(await checkUsageLimit(userId, "study_kit")).allowed) {
          return fail("rate_limited", T.errors.rateLimited);
        }
        // Reserve the most the run can cost (exactly its price on a model
        // whose real cost stays within it) atomically: a parallel run sees
        // the balance without it. Settled to the charge, given back in full
        // when the run is free.
        hold = await reserveCredits(userId, {
          estimate: cost.max,
          min: minBalance,
          reason: "study_kit",
        });
        if (!hold) return outOfCredits();
        started = true;

        send({
          type: "start",
          sections: plan.sections.map((s) => ({ from: s.from, to: s.to })),
          from: plan.from,
          to: plan.to,
          estimate: cost.price,
          maxCredits: cost.max,
        });
        const onEvent = (event: KitEvent) => {
          if (event.type === "section" && event.status === "done") partsDone += 1;
          send(event);
        };

        const metered = await withUsageMeter(async () => {
          try {
            const result = await runStudyKit({
              material,
              plan,
              outputs: body.outputs,
              amount: body.amount as (typeof KIT_AMOUNTS)[number],
              language: body.language === "interface" ? englishName(locale) : null,
              complete: configured ? modelComplete(planModel) : mockComplete,
              signal,
              deadline: requestStartedAt + GENERATION_BUDGET_MS,
              onEvent,
            });
            return { ok: true as const, result };
          } catch (error) {
            return { ok: false as const, error };
          }
        });
        usage = addUsage(usage, metered.usage);
        if (!metered.result.ok) throw metered.result.error;
        if (signal.aborted) throw new KitCancelledError();

        // Charge only now that the student has something: the price of the
        // parts that delivered (failed parts are free), its real cost when
        // higher, never more than the most shown before the run.
        const { stats } = metered.result.result;
        const delivered = Math.min(plan.sections.length, Math.max(0, stats.sections - stats.failedSections));
        const deliveredQuote = studyKitQuote(delivered, partQuote);
        const credits = await settleCreditHold(
          hold,
          Math.min(cost.max, chargeForCompleted(deliveredQuote, usageToCredits(usage, model))),
        ).catch((error) => {
          reportError(error, { route: "/api/materials/generate", userId });
          return 0;
        });
        recordFunnelEvent(userId, "study_kit_complete");
        send({
          type: "complete",
          result: metered.result.result,
          credits,
          balance: await getCreditBalance(userId).catch(() => 0),
        });
        finish();
      } catch (error) {
        if (error instanceof KitCancelledError || signal.aborted) {
          // Stopped by the student: only the parts finished before the stop
          // are billed, at their price (the real cost when that is already
          // higher), never more than the most shown up front.
          if (hold && runQuote) {
            const real = usageToCredits(usage, model);
            const fraction = partsPlanned > 0 ? partsDone / partsPlanned : 0;
            const charge = real > 0 ? chargeForPartial(runQuote, real, fraction) : 0;
            await settleCreditHold(hold, charge, { reason: "study_kit_cancelled" }).catch(() => 0);
          }
          finish();
          return;
        }
        if (!(error instanceof KitFailedError)) {
          reportError(error, { route: "/api/materials/generate", userId });
        }
        // Nothing usable was delivered, so nothing is charged (the hold goes
        // back below); the failure counts against the small daily quota.
        if (started) failed = true;
        fail("generation_failed", T.errors.failedNoCharge);
      } finally {
        // Any outcome not settled above is free: the held credits go back.
        // A no-op after a settle.
        if (hold) await releaseCreditHold(hold).catch(() => false);
        if (!failed) await releaseOutcomeSlot(failureSlot);
        release();
        unregister();
        request.signal.removeEventListener("abort", cancel);
      }
    },
    cancel() {
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
