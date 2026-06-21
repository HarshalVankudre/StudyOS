import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ToolDisabledError,
  ToolValidationError,
  UnknownToolError,
  createToolRegistry,
  type ToolDefinition,
} from "./registry";

const ctx = { taskId: "t1" };

function echoTool(over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "echo",
    description: "echo",
    input: z.object({ value: z.string() }),
    output: z.object({ value: z.string() }),
    limits: { timeoutMs: 1000 },
    networkPermission: "none",
    handler: (input) => input,
    ...over,
  };
}

describe("tool registry", () => {
  it("rejects a malformed tool definition", () => {
    const reg = createToolRegistry();
    expect(() =>
      reg.register({ ...echoTool(), input: {} as never }),
    ).toThrow();
    expect(() =>
      reg.register({ ...echoTool(), handler: undefined as never }),
    ).toThrow();
  });

  it("rejects running an unknown tool", async () => {
    const reg = createToolRegistry();
    await expect(reg.run("nope", {}, ctx)).rejects.toBeInstanceOf(UnknownToolError);
  });

  it("validates input and output on every call", async () => {
    const reg = createToolRegistry();
    reg.register(echoTool());
    await expect(reg.run("echo", { value: "hi" }, ctx)).resolves.toEqual({
      value: "hi",
    });
    // bad input
    await expect(reg.run("echo", { value: 1 }, ctx)).rejects.toBeInstanceOf(
      ToolValidationError,
    );
    // bad output (handler returns wrong shape)
    reg.register(echoTool({ handler: () => ({ value: 1 }) as never }));
    await expect(reg.run("echo", { value: "hi" }, ctx)).rejects.toBeInstanceOf(
      ToolValidationError,
    );
  });

  it("refuses to run a disabled (stub) tool", async () => {
    const reg = createToolRegistry();
    const handler = vi.fn();
    reg.register(echoTool({ enabled: false, handler }));
    await expect(reg.run("echo", { value: "hi" }, ctx)).rejects.toBeInstanceOf(
      ToolDisabledError,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes a task signal to the handler and rejects promptly on cancellation", async () => {
    const reg = createToolRegistry();
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    reg.register(
      echoTool({
        handler: async (_input, handlerCtx) => {
          receivedSignal = handlerCtx.signal;
          await new Promise(() => undefined);
          return { value: "never" };
        },
      }),
    );

    const pending = reg.run("echo", { value: "hi" }, {
      taskId: "t1",
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
    expect(receivedSignal?.aborted).toBe(true);
  });
});
