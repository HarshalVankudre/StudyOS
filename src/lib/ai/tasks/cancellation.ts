/**
 * In-memory task cancellation helpers for agent jobs.
 *
 * These are server-only because they coordinate AbortControllers for durable
 * task execution and poll server-side cancellation state.
 */
import "server-only";

const activeTasks = new Map<string, AbortController>();

export class TaskCancelledError extends Error {
  constructor() {
    super("Agent task cancelled");
    this.name = "TaskCancelledError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function registerActiveTask(taskId: string, controller: AbortController): () => void {
  activeTasks.set(taskId, controller);

  return () => {
    if (activeTasks.get(taskId) === controller) {
      activeTasks.delete(taskId);
    }
  };
}

export function abortActiveTask(taskId: string): boolean {
  const controller = activeTasks.get(taskId);
  if (!controller) return false;

  controller.abort(new TaskCancelledError());
  return true;
}

export function throwIfTaskCancelled(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;

  if (signal.reason instanceof TaskCancelledError) {
    throw signal.reason;
  }

  throw new TaskCancelledError();
}

export function isTaskCancelledError(error: unknown, signal?: AbortSignal | null): boolean {
  return error instanceof TaskCancelledError || signal?.reason instanceof TaskCancelledError;
}

type WatchDurableCancellationInput = {
  controller: AbortController;
  isCancelled: () => boolean | Promise<boolean>;
  intervalMs?: number;
};

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}

export function watchDurableCancellation({
  controller,
  isCancelled,
  intervalMs = 500,
}: WatchDurableCancellationInput): () => void {
  let stopped = controller.signal.aborted;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };

  const check = async () => {
    if (stopped || inFlight || controller.signal.aborted) return;
    inFlight = true;

    try {
      if (stopped || controller.signal.aborted) return;

      const cancelled = await isCancelled();
      if (cancelled && !controller.signal.aborted) {
        controller.abort(new TaskCancelledError());
      }
    } catch {
      // Transient polling failures are ignored; the next interval will retry.
    } finally {
      inFlight = false;
      if (stopped || controller.signal.aborted) {
        stop();
      }
    }
  };

  if (!stopped) {
    controller.signal.addEventListener("abort", stop, { once: true });
    void check();

    timer = setInterval(() => {
      void check();
    }, intervalMs);
    unrefTimer(timer);
  }

  return () => {
    stop();
    controller.signal.removeEventListener("abort", stop);
  };
}
