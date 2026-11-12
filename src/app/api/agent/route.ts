import { rejectCrossSite } from "@/lib/http/same-origin";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import type {
  AgentMessage,
  AgentResponse,
  AgentStreamEvent,
} from "@/lib/ai/agent-shared";
import { modelForPlan } from "@/lib/ai/plans";
import {
  addUsage,
  withUsageMeterSettled,
  type TokenUsage,
} from "@/lib/ai/usage-meter";
import { getUserPlan } from "@/lib/billing";
import {
  creditsToUsd,
  getCreditBalance,
  reserveCredits,
  usdToCredits,
  type CreditHold,
} from "@/lib/credits";
import { getLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { fmt } from "@/lib/i18n/interpolate";
import { plural } from "@/lib/i18n/plural";
import {
  WorkspaceVersionConflictError,
  applyAgentWorkspaceChange,
  getWorkspaceSnapshot,
} from "@/lib/workspace/version-service";
import {
  appendTaskEvent,
  claimTaskForFinalization,
  createTaskWithinLimit,
  isTaskCancelled,
  markTaskDone,
  markTaskError,
} from "@/lib/ai/tasks/store";
import {
  checkUsageLimit,
  MAX_CONCURRENT_AGENT_TASKS,
} from "@/lib/usage-limits";
import {
  TaskCancelledError,
  isTaskCancelledError,
  registerActiveTask,
  throwIfTaskCancelled,
  watchDurableCancellation,
} from "@/lib/ai/tasks/cancellation";
import { estimateAgentTurn, runAgentLoop } from "@/lib/ai/agent-loop";
import { budgetForPlan, TURN_CREDIT_CAP } from "@/lib/ai/budgets";
import {
  appendChatMessages,
  loadModelHistory,
  windowHistory,
  type NewChatMessage,
} from "@/lib/ai/agent-history";
import {
  releaseAgentHold,
  settleAgentTurn,
  type AgentTurnOutcome,
} from "@/lib/ai/agent-charging";
import { AgentResultTooLargeError } from "@/lib/ai/limits";
import {
  resolveTimeZone,
  studentClock,
  timeZoneFromCookieHeader,
  validTimeZone,
} from "@/lib/ai/student-clock";
import { reportError } from "@/lib/ops/report-error";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  workspaceId: z.string().min(1).max(100),
  /**
   * Older clients send the visible chat; the server now keeps the history
   * itself (AgentChatMessage) and only falls back to this when it can't read it.
   */
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
  /** What the chat shows for this message when it differs (a choice's label). */
  displayText: z.string().trim().min(1).max(2000).optional(),
  // The browser's IANA zone, so relative dates ("next Friday") resolve to the
  // student's local calendar. Optional: the cookie set by the generator and
  // the Daily Study Agent's saved zone are the fallbacks.
  timeZone: z.string().max(100).optional(),
  /**
   * The workspace version the client holds after its pending saves settled.
   * When the server has moved past it, the request is refused before any
   * model runs (the result could not be applied anyway).
   */
  baseVersion: z.number().int().min(0).optional(),
});

/**
 * The student's time zone: request body, then the generator's cookie, then
 * the zone the Daily Study Agent saved from their browser, then UTC.
 */
async function studentTimeZone(
  request: Request,
  userId: string,
  requested: string | undefined,
): Promise<string> {
  const direct =
    validTimeZone(requested) ?? timeZoneFromCookieHeader(request.headers.get("cookie"));
  if (direct) return direct;
  const saved = await prisma.dailyStudyAgentConfig
    .findUnique({ where: { userId }, select: { timeZone: true } })
    .catch(() => null);
  return resolveTimeZone([saved?.timeZone]);
}

const encoder = new TextEncoder();
const NO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0 };

function isTooLarge(error: unknown): boolean {
  return (
    error instanceof AgentResultTooLargeError ||
    (error instanceof Error && /too ?large/i.test(`${error.name} ${error.constructor?.name ?? ""}`))
  );
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
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
      // The task row claimed with a concurrency slot, before the turn starts.
      let claimedTaskId: string | null = null;
      // Cancellation plumbing, torn down in `finally` regardless of outcome.
      let stopWatching: () => void = () => {};
      let unregisterActiveTask: () => void = () => {};
      let taskSignal: AbortSignal | undefined;
      // Tokens this turn consumed, kept even when the work throws, so a
      // cancelled or failed turn is settled by the same policy.
      let usage: TokenUsage = NO_USAGE;
      let model = "";
      let settled = false;
      // The up-front estimate, reserved before any model work so parallel
      // requests cannot all run on the same credits. Settled to the real
      // cost, or released when the outcome is free (always, in `finally`).
      let hold: CreditHold | null = null;
      // Messages are stored only once a task started (a refusal stores nothing).
      let persistChat = false;
      const { workspaceId, message } = parsed.data;

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

      const refuse = (code: Extract<AgentStreamEvent, { type: "error" }>["code"], text: string) => {
        send({ type: "error", code, message: text });
        finish();
      };

      // Charge (or not) by outcome, exactly once per turn, never more than
      // the plan's per-message cap with the turn's sandbox runs included.
      let capCredits: number | undefined;
      const settle = async (outcome: AgentTurnOutcome): Promise<number> => {
        if (settled) return 0;
        settled = true;
        return settleAgentTurn({ userId, usage, model, outcome, hold, capCredits, taskId });
      };

      const remember = async (messages: NewChatMessage[]) => {
        if (!persistChat || messages.length === 0) return;
        await appendChatMessages(userId, workspaceId, messages).catch((error) =>
          reportError(error, { source: "api", route: "/api/agent", method: "POST", userId, workspaceId, taskId }),
        );
      };

      try {
        const snapshot = await getWorkspaceSnapshot(workspaceId);
        if (!snapshot) {
          refuse("failed", T.ai.agent.workspaceNotFound);
          return;
        }
        // baseVersion pins the workspace this task started from; the atomic apply
        // refuses to commit if a concurrent save advanced it in the meantime.
        const { workspace, version: baseVersion } = snapshot;

        // Stale base: the client's own saves moved the workspace on (or another
        // tab did). Refuse now, before any model runs, rather than after the
        // work is done and can't be applied.
        if (
          parsed.data.baseVersion !== undefined &&
          parsed.data.baseVersion !== baseVersion
        ) {
          refuse("stale_workspace", T.ai.agent.staleWorkspace);
          return;
        }

        // Burst-rate throttle + concurrent-work cap. Credits bound total
        // spend; these bound how fast it can be spent and how many model
        // loops one user can hold open at once. Both are atomic per user:
        // the task row that holds a concurrency slot is created in the same
        // locked step as the count, so parallel requests cannot all see room.
        if (!(await checkUsageLimit(userId, "agent")).allowed) {
          refuse("rate_limited", T.limits.rateLimited);
          return;
        }
        const task = await createTaskWithinLimit({ workspaceId, baseVersion }, MAX_CONCURRENT_AGENT_TASKS);
        if (!task) {
          refuse("rate_limited", T.limits.rateLimited);
          return;
        }
        // Ended in `finally` if the turn is refused before it starts.
        claimedTaskId = task.id;

        const plan = await getUserPlan();
        model = modelForPlan(plan);
        capCredits = TURN_CREDIT_CAP[plan];
        const clock = studentClock(
          await studentTimeZone(request, userId, parsed.data.timeZone),
        );

        // A bounded window of the stored conversation, so follow-ups resolve.
        // If the store can't be read, fall back to what the client sent.
        const history: AgentMessage[] = await loadModelHistory(userId, workspaceId).catch(() =>
          windowHistory(
            parsed.data.history.map((h, i) => ({
              id: String(i),
              role: h.role,
              content: h.content,
              modelContent: null,
              changeNote: null,
              changeId: null,
              meta: null,
              createdAt: new Date(0),
            })),
          ),
        );

        // ---- Up-front cost check -----------------------------------------
        // What the smallest real edit on this workspace would cost on this
        // model. A student who can't afford it is told the estimate and their
        // balance, and nothing runs.
        const balance = await getCreditBalance(userId);
        const estimate = estimateAgentTurn({ workspace, history, message, model, locale, clock });
        const estimateCredits = Math.max(1, usdToCredits(estimate.simpleTurnUsd));
        const tooExpensive = (available: number) =>
          refuse(
            "insufficient_credits",
            available <= 0
              ? T.credits.outAgent
              : fmt(T.credits.agentTooExpensive, { cost: plural(locale, T.counts.credits, estimateCredits), balance: available }),
          );
        if (balance < estimateCredits) {
          tooExpensive(balance);
          return;
        }
        // Reserve the turn's whole spend ceiling atomically: up to the
        // plan's per-message cap, at least the estimate. A parallel turn sees
        // the balance without it, so turns running at once can never spend
        // the same credits; the hold is settled down to the real cost.
        hold = await reserveCredits(userId, {
          estimate: TURN_CREDIT_CAP[plan],
          min: estimateCredits,
          reason: "agent",
        });
        if (!hold) {
          tooExpensive(await getCreditBalance(userId));
          return;
        }
        // Hard spend ceiling for this turn: exactly what was reserved. The
        // loop sizes every call to stay under it.
        const ceilingCredits = hold.amount;

        // Durable record (claimed above): survives a disconnect (reconnect by
        // id) and carries a cancel flag consulted before the workspace is changed.
        taskId = task.id;
        send({ type: "task", taskId: task.id });
        persistChat = true;
        await remember([
          {
            role: "user",
            content: parsed.data.displayText ?? message,
            modelContent: message,
          },
        ]);

        // Own this task's cancellation. The signal threads into every model,
        // tool, and controlled-fetch call. A Stop that reaches THIS instance
        // aborts the controller immediately via the registry; a Stop that lands
        // on another instance is caught by the bounded durable-status watcher,
        // which flips the same controller. Both are torn down in `finally`.
        const taskController = new AbortController();
        taskSignal = taskController.signal;
        unregisterActiveTask = registerActiveTask(task.id, taskController);
        stopWatching = watchDurableCancellation({
          controller: taskController,
          isCancelled: () => isTaskCancelled(task.id),
        });

        // The single atomic gate before any irreversible completion side effect
        // (charge, apply, mark done, emit result). It claims `running ->
        // finalizing`; if a cancel already won that race the claim fails and we
        // throw `TaskCancelledError`, which the catch treats as a clean stop.
        const claimFinalization = async () => {
          throwIfTaskCancelled(taskSignal);
          if (!(await claimTaskForFinalization(task.id))) {
            throw new TaskCancelledError();
          }
        };

        // Persist every emitted event so a reconnect can replay the Living Story.
        // `thinking` is the exception: it's high-frequency, live-only reasoning,
        // so it streams to the client but is never persisted.
        const emit = async (event: AgentStreamEvent) => {
          send(event);
          if (event.type === "thinking") return;
          await appendTaskEvent(task.id, event).catch(() => {});
        };

        // Settle this turn's credits and read the resulting balance, so the
        // client can show both the per-turn cost and a live balance.
        const chargeTurn = async (): Promise<{
          creditsCost: number;
          creditsBalance: number;
        }> => {
          const creditsCost = await settle("completed");
          return { creditsCost, creditsBalance: await getCreditBalance(userId) };
        };

        // Finish a turn: charge, record, store the reply, emit the result.
        const complete = async (response: AgentResponse) => {
          const { changeNote, ...forClient } = response;
          Object.assign(forClient, await chargeTurn());
          await markTaskDone(task.id, JSON.stringify(forClient));
          await remember([
            {
              role: "assistant",
              content: forClient.reply,
              changeNote,
              changeId: forClient.changeId,
              meta: {
                changed: forClient.changed || undefined,
                choices: forClient.choices,
                affectedAreas: forClient.affectedAreas,
                creditsCost: forClient.creditsCost,
                stopReason: forClient.stopReason,
              },
            },
          ]);
          await emit({ type: "result", response: forClient });
          finish();
        };

        // Run model work under a meter that keeps the usage even on throw.
        const metered = async <R,>(fn: () => Promise<R>): Promise<R> => {
          const run = await withUsageMeterSettled(fn);
          usage = addUsage(usage, run.usage);
          if (run.failed) throw run.error;
          return run.result as R;
        };

        const result: AgentResponse = await metered(() =>
          runAgentLoop({
            workspace,
            history,
            message,
            model,
            budget: { ...budgetForPlan(plan), maxCostUsd: creditsToUsd(ceilingCredits) },
            locale,
            taskId: task.id,
            ownerId: userId,
            signal: taskSignal,
            emit,
            startedAt: requestStartedAt,
            clock,
          }),
        );

        // reply / clarify / no-change: no workspace to apply — settle immediately.
        if (!result.changed || !result.workspace) {
          await claimFinalization();
          await complete(result);
          return;
        }

        // ---- Finishing (92–100%) -------------------------------------------
        await emit({
          type: "phase",
          phase: "saving",
          message: T.ai.agent.saving,
          progress: 92,
        });
        // Atomically claim finalization before applying: cancel and
        // finalization compete for the single `running` row, so a task that was
        // cancelled in time can never be applied or marked done.
        await claimFinalization();
        // `workspace` (what the agent started from) lets the apply land on a
        // newer version saved meanwhile (another tab, a phone) when nothing
        // overlaps; an overlap is refused with WorkspaceVersionConflictError.
        const applied = await applyAgentWorkspaceChange(
          workspaceId,
          baseVersion,
          result.workspace,
          workspace,
        );
        await complete({
          ...result,
          workspace: applied.workspace,
          changeId: applied.changeId,
        });
      } catch (error) {
        // User cancellation is a normal terminal path, not an error: it arrives
        // either as a TaskCancelledError thrown out of the engines/claim, or as
        // a durable `cancelled` status set by a cancel on another instance.
        // Nothing was applied; the tokens used before the stop are billed.
        const cancelled =
          isTaskCancelledError(error, taskSignal) ||
          (taskId ? await isTaskCancelled(taskId).catch(() => false) : false);
        if (cancelled) {
          await settle("cancelled").catch((e) =>
            reportError(e, { source: "api", route: "/api/agent", method: "POST", userId, workspaceId, taskId }),
          );
          await remember([{ role: "assistant", content: T.agentChat.taskStopped }]);
          finish();
          return;
        }

        // Edits saved during the task that overlap the agent's change are an
        // expected outcome (the strict merge refused), not a server error.
        const conflict = error instanceof WorkspaceVersionConflictError;
        if (!conflict) {
          reportError(error, {
            source: "api",
            route: "/api/agent",
            method: "POST",
            userId,
            workspaceId,
            taskId,
          });
        }
        if (taskId) await markTaskError(taskId, conflict ? "workspace_conflict" : "error").catch(() => {});
        // Every failure, including a result too large to save and a result
        // that overlaps edits saved during the task, is uncharged within the
        // daily free-failure allowance (see agent-charging) and charged for
        // what it consumed after that. A conflict is easy to cause on purpose
        // (edit the same page from another tab during every turn), so it
        // cannot be an unlimited source of free model work.
        const tooLarge = isTooLarge(error);
        const charged = await settle("failed").catch((e) => {
          reportError(e, { source: "api", route: "/api/agent", method: "POST", userId, workspaceId, taskId });
          return 0;
        });
        const text = conflict
          ? charged > 0
            ? fmt(T.ai.agent.workspaceChangedCharged, { credits: plural(locale, T.counts.credits, charged) })
            : T.ai.agent.workspaceChanged
          : tooLarge
            ? charged > 0
              ? fmt(T.ai.agent.resultTooLargeCharged, { credits: plural(locale, T.counts.credits, charged) })
              : T.ai.agent.resultTooLarge
            : T.ai.agent.error;
        await remember([{ role: "assistant", content: text }]);
        send({ type: "error", code: conflict ? "workspace_conflict" : "failed", message: text });
        finish();
      } finally {
        // A hold that was not settled (an early exit or an unexpected throw)
        // goes back in full; after a settle this is a no-op.
        if (hold && !settled) await releaseAgentHold(hold).catch(() => {});
        // A slot claimed by a turn that was refused before it started is
        // given back at once instead of counting until the task expires.
        if (claimedTaskId && !taskId) await markTaskError(claimedTaskId, "refused").catch(() => {});
        // Always release the cancellation plumbing so a finished task can't be
        // aborted later and the watcher's interval can't leak.
        stopWatching();
        unregisterActiveTask();
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
