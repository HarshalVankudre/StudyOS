import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TaskCancelledError,
  abortActiveTask,
  isTaskCancelledError,
  registerActiveTask,
  throwIfTaskCancelled,
  watchDurableCancellation,
} from "./cancellation";

describe("task cancellation primitives", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("registers, aborts, and surfaces local cancellation", () => {
    const controller = new AbortController();
    const cleanup = registerActiveTask("task-1", controller);

    expect(abortActiveTask("task-1")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(TaskCancelledError);
    expect(isTaskCancelledError(controller.signal.reason, controller.signal)).toBe(true);
    expect(() => throwIfTaskCancelled(controller.signal)).toThrow(TaskCancelledError);

    cleanup();
  });

  it("keeps a newer controller registered when an old cleanup runs", () => {
    const oldController = new AbortController();
    const newController = new AbortController();
    const oldCleanup = registerActiveTask("task-2", oldController);
    const newCleanup = registerActiveTask("task-2", newController);

    oldCleanup();

    expect(abortActiveTask("task-2")).toBe(true);
    expect(oldController.signal.aborted).toBe(false);
    expect(newController.signal.aborted).toBe(true);

    newCleanup();
  });

  it("throws a task cancelled error when a signal was aborted for another reason", () => {
    const controller = new AbortController();
    controller.abort(new Error("network broke"));

    expect(() => throwIfTaskCancelled(controller.signal)).toThrow(TaskCancelledError);
    expect(isTaskCancelledError(new TaskCancelledError(), controller.signal)).toBe(true);
  });

  it("aborts a durable task once the poller reports cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const isCancelled = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const cleanup = watchDurableCancellation({ controller, isCancelled, intervalMs: 10 });

    await vi.advanceTimersByTimeAsync(30);

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(TaskCancelledError);
    expect(isCancelled).toHaveBeenCalled();

    cleanup();
  });

  it("ignores transient polling failures and keeps polling until cancellation is confirmed", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const isCancelled = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const cleanup = watchDurableCancellation({ controller, isCancelled, intervalMs: 10 });

    await vi.advanceTimersByTimeAsync(30);

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(TaskCancelledError);
    expect(isCancelled).toHaveBeenCalledTimes(3);

    cleanup();
  });

  it("does not abort if cleanup runs before an in-flight durable poll resolves true", async () => {
    const controller = new AbortController();
    const pending = deferred<boolean>();
    const isCancelled = vi.fn().mockReturnValueOnce(pending.promise);

    const cleanup = watchDurableCancellation({ controller, isCancelled, intervalMs: 10 });

    expect(isCancelled).toHaveBeenCalledTimes(1);
    cleanup();
    pending.resolve(true);

    await Promise.resolve();

    expect(controller.signal.aborted).toBe(false);
  });
});
