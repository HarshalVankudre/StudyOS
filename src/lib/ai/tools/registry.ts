/**
 * Server-side tool registry.
 *
 * Every capability the agent can use is a registered tool with strict Zod
 * input/output, limits, and a network-permission flag. Inputs and outputs are
 * validated at the boundary on every call, unknown tools are rejected, and a
 * tool can be registered-but-disabled (a stub) until its execution backend
 * exists. This is the single place new capabilities are added — the chat
 * protocol does not change when a tool is added.
 */
import type { z } from "zod";

export type ToolNetworkPermission = "none" | "allowlisted";

export interface ToolContext {
  taskId: string;
  /** Sanitized, owner-scoped workspace snapshot (JSON) the task started from. */
  workspaceJson?: string;
  /**
   * Task cancellation signal. The registry combines it with the per-tool
   * timeout and passes the combined signal to the handler, so a cancelled task
   * (or a slow tool) is interrupted even if the handler ignores the signal.
   */
  signal?: AbortSignal;
  /** Owner (Clerk userId) of the task — assets produced by a tool are scoped to it. */
  ownerId?: string;
}

/** A sanitized, user-facing milestone derived from a completed tool call. */
export interface ToolProgress {
  title: string;
  detail?: string;
}

export interface ToolDefinition<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  id: string;
  /** Private description for the planner; never shown to the user. */
  description: string;
  input: I;
  output: O;
  limits: { timeoutMs: number };
  networkPermission: ToolNetworkPermission;
  /** Registered but inert until its backend exists (e.g. the OS sandbox). */
  enabled?: boolean;
  handler: (input: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>> | z.infer<O>;
  /** Map a completed call to a sanitized Living Story discovery. */
  toProgress?: (input: z.infer<I>, output: z.infer<O>) => ToolProgress;
}

export class UnknownToolError extends Error {}
export class ToolDisabledError extends Error {}
export class ToolValidationError extends Error {}
export class ToolTimeoutError extends Error {}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return typeof (value as { safeParse?: unknown })?.safeParse === "function";
}

export interface ToolRegistry {
  register<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
    def: ToolDefinition<I, O>,
  ): void;
  get(id: string): ToolDefinition | undefined;
  has(id: string): boolean;
  list(): string[];
  run(id: string, rawInput: unknown, ctx: ToolContext): Promise<unknown>;
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();

  return {
    // Generic so each call site type-checks its handler/toProgress against the
    // tool's own input/output schemas; stored erased to the default shape.
    register<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
      def: ToolDefinition<I, O>,
    ) {
      if (
        !def?.id ||
        typeof def.handler !== "function" ||
        !isZodSchema(def.input) ||
        !isZodSchema(def.output) ||
        !def.limits ||
        !def.networkPermission
      ) {
        throw new Error(`invalid tool definition: ${def?.id ?? "(no id)"}`);
      }
      tools.set(def.id, def as unknown as ToolDefinition);
    },
    get: (id) => tools.get(id),
    has: (id) => tools.has(id),
    list: () => [...tools.keys()],
    async run(id, rawInput, ctx) {
      const def = tools.get(id);
      if (!def) throw new UnknownToolError(`unknown tool "${id}"`);
      if (def.enabled === false) {
        throw new ToolDisabledError(`tool "${id}" is not available yet`);
      }
      const input = def.input.safeParse(rawInput);
      if (!input.success) {
        throw new ToolValidationError(`invalid input for "${id}"`);
      }

      // Enforce the tool's timeout AND task cancellation through one combined
      // signal. We race the handler against an abort promise so a handler that
      // ignores its signal still cannot keep this call (or the registry promise)
      // pending past the deadline or a user Stop. The original abort reason is
      // preserved so cancellation stays a cancellation — never a validation error.
      const timeout = new AbortController();
      const timer = setTimeout(
        () => timeout.abort(new ToolTimeoutError(`tool "${id}" timed out`)),
        def.limits.timeoutMs,
      );
      const signal = ctx.signal
        ? AbortSignal.any([ctx.signal, timeout.signal])
        : timeout.signal;
      let abortListener: (() => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () =>
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error(`tool "${id}" aborted`),
          );
        if (signal.aborted) abortListener();
        else signal.addEventListener("abort", abortListener, { once: true });
      });

      try {
        const result = await Promise.race([
          Promise.resolve(def.handler(input.data, { ...ctx, signal })),
          aborted,
        ]);
        const output = def.output.safeParse(result);
        if (!output.success) {
          throw new ToolValidationError(`invalid output from "${id}"`);
        }
        return output.data;
      } finally {
        clearTimeout(timer);
        if (abortListener) signal.removeEventListener("abort", abortListener);
      }
    },
  };
}

/** The application-wide registry; built-ins register into this on import. */
export const toolRegistry = createToolRegistry();
