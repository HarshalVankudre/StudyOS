# Agent Thinking and Immediate Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live model reasoning in both agent engines and make Stop task interrupt active model/tool work while ensuring a cancelled task can never apply workspace changes.

**Architecture:** Both legacy and authentic agents use the existing streaming OpenRouter boundary and emit `thinking` events. A task-scoped `AbortController`, same-instance controller registry, and durable-status watcher propagate cancellation into model calls, tools, and controlled fetches. A conditional `running -> finalizing` transition arbitrates the final apply against cancellation so only one can win.

**Tech Stack:** Next.js 16.2 Route Handlers, React 19, TypeScript, Prisma/PostgreSQL, Vitest, Testing Library, OpenRouter SSE.

---

## File structure

- Create `src/lib/ai/tasks/cancellation.ts` — task cancellation error, local controller registry, durable cancellation watcher.
- Create `src/lib/ai/tasks/cancellation.test.ts` — cancellation primitive tests.
- Create `src/lib/ai/agent.test.ts` — legacy streaming/reasoning/abort tests.
- Create `src/components/workspace/AgentChat.test.tsx` — Stop task client-flow tests.
- Modify `src/lib/ai/tasks/store.ts` and `.test.ts` — terminal-state arbitration and conditional transitions.
- Modify `src/app/api/agent/task/[id]/cancel/route.ts` — durable cancel plus same-instance abort.
- Modify `src/lib/ai/agent.ts` — legacy calls use streamed reasoning and external signals.
- Modify `src/lib/ai/agent-loop.ts` and `.test.ts` — authentic loop observes task cancellation.
- Modify `src/lib/ai/tools/registry.ts` and `.test.ts` — task signal and enforced tool deadlines.
- Modify `src/lib/net/controlled-fetch.ts` and `.test.ts` — caller abort signal propagation.
- Modify `src/lib/ai/tools/builtin.ts` — pass the task signal into controlled fetch.
- Modify `src/app/api/agent/route.ts` — own task controller, watcher, reasoning emission, finalization claim, cancellation-safe exit.
- Modify `src/components/workspace/AgentProgressCard.tsx` and `.test.tsx` — prominent Stop task button and stopping state.
- Modify `src/components/workspace/AgentChat.tsx` — acknowledged stop flow and stopped result.
- Modify all files in `src/lib/i18n/dictionaries/` — localized Stop task strings.

### Task 1: Install dependencies and read the repository’s bundled Next.js guidance

**Files:** No source changes.

- [ ] **Step 1: Restore the exact dependency graph**

Run:

```powershell
pnpm install --frozen-lockfile
```

Expected: `node_modules/next/dist/docs/` exists and Prisma client generation succeeds.

- [ ] **Step 2: Locate the bundled Route Handler and Client Component guides**

Run:

```powershell
rg --files node_modules/next/dist/docs | rg "route|client-component|server-component|stream"
```

Expected: at least one App Router Route Handler guide and one Client Component guide are listed.

- [ ] **Step 3: Read the relevant guides before editing**

Run:

```powershell
$routeGuide = rg --files node_modules/next/dist/docs | rg "route-handlers|route\\.mdx" | Select-Object -First 1
$clientGuide = rg --files node_modules/next/dist/docs | rg "client-components|server-and-client" | Select-Object -First 1
Get-Content -Raw $routeGuide
Get-Content -Raw $clientGuide
```

Expected: confirm Route Handler streaming/cancellation behavior and that interactive Stop state remains inside a `"use client"` component.

### Task 2: Add task cancellation primitives

**Files:**
- Create: `src/lib/ai/tasks/cancellation.ts`
- Create: `src/lib/ai/tasks/cancellation.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  TaskCancelledError,
  abortActiveTask,
  isTaskCancelledError,
  registerActiveTask,
  throwIfTaskCancelled,
  watchDurableCancellation,
} from "./cancellation";

describe("task cancellation", () => {
  it("aborts a locally registered task", () => {
    const controller = new AbortController();
    const unregister = registerActiveTask("task-1", controller);

    expect(abortActiveTask("task-1")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(TaskCancelledError);
    expect(() => throwIfTaskCancelled(controller.signal)).toThrow(
      TaskCancelledError,
    );

    unregister();
    expect(abortActiveTask("task-1")).toBe(false);
  });

  it("does not unregister a newer controller for the same task", () => {
    const first = new AbortController();
    const second = new AbortController();
    const unregisterFirst = registerActiveTask("task-1", first);
    registerActiveTask("task-1", second);

    unregisterFirst();
    expect(abortActiveTask("task-1")).toBe(true);
    expect(second.signal.aborted).toBe(true);
  });

  it("aborts when the durable task becomes cancelled", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const isCancelled = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const stop = watchDurableCancellation({
      controller,
      isCancelled,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(200);

    expect(controller.signal.aborted).toBe(true);
    expect(isTaskCancelledError(controller.signal.reason)).toBe(true);
    stop();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run src/lib/ai/tasks/cancellation.test.ts
```

Expected: FAIL because `./cancellation` does not exist.

- [ ] **Step 3: Implement the cancellation module**

```ts
import "server-only";

export class TaskCancelledError extends Error {
  constructor() {
    super("Agent task cancelled");
    this.name = "TaskCancelledError";
  }
}

const activeTasks = new Map<string, AbortController>();

export function registerActiveTask(
  taskId: string,
  controller: AbortController,
): () => void {
  activeTasks.set(taskId, controller);
  return () => {
    if (activeTasks.get(taskId) === controller) activeTasks.delete(taskId);
  };
}

export function abortActiveTask(taskId: string): boolean {
  const controller = activeTasks.get(taskId);
  if (!controller) return false;
  controller.abort(new TaskCancelledError());
  return true;
}

export function throwIfTaskCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof TaskCancelledError) throw signal.reason;
  throw new TaskCancelledError();
}

export function isTaskCancelledError(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  return (
    error instanceof TaskCancelledError ||
    signal?.reason instanceof TaskCancelledError
  );
}

export function watchDurableCancellation(input: {
  controller: AbortController;
  isCancelled: () => Promise<boolean>;
  intervalMs?: number;
}): () => void {
  const { controller, isCancelled, intervalMs = 500 } = input;
  let checking = false;
  const timer = setInterval(async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try {
      if (await isCancelled()) {
        controller.abort(new TaskCancelledError());
      }
    } catch {
      // A transient polling failure must not terminate the task.
    } finally {
      checking = false;
    }
  }, intervalMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
pnpm exec vitest run src/lib/ai/tasks/cancellation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/ai/tasks/cancellation.ts src/lib/ai/tasks/cancellation.test.ts
git commit -m "feat(agent): add task cancellation primitives"
```

### Task 3: Make durable task state arbitrate cancellation against finalization

**Files:**
- Modify: `src/lib/ai/tasks/store.ts`
- Modify: `src/lib/ai/tasks/store.test.ts`

- [ ] **Step 1: Add failing tests for the finalization claim and terminal guards**

```ts
import {
  claimTaskForFinalization,
  markTaskDone,
  markTaskError,
} from "./store";

it("claims only a running task for finalization", async () => {
  mocks.updateMany.mockResolvedValueOnce({ count: 1 });
  await expect(claimTaskForFinalization("task-1")).resolves.toBe(true);
  expect(mocks.updateMany).toHaveBeenCalledWith({
    where: { id: "task-1", userId: "user-1", status: "running" },
    data: { status: "finalizing" },
  });
});

it("marks done only after finalization was claimed", async () => {
  mocks.updateMany.mockResolvedValue({ count: 1 });
  await expect(markTaskDone("task-1", "{}")).resolves.toBe(true);
  expect(mocks.updateMany).toHaveBeenCalledWith({
    where: { id: "task-1", userId: "user-1", status: "finalizing" },
    data: { status: "done", result: "{}" },
  });
});

it("never overwrites cancelled with error", async () => {
  mocks.updateMany.mockResolvedValue({ count: 0 });
  await markTaskError("task-1", "error");
  expect(mocks.updateMany).toHaveBeenCalledWith({
    where: {
      id: "task-1",
      userId: "user-1",
      status: { in: ["running", "finalizing"] },
    },
    data: { status: "error", error: "error" },
  });
});
```

- [ ] **Step 2: Run the store tests and verify RED**

Run:

```powershell
pnpm exec vitest run src/lib/ai/tasks/store.test.ts
```

Expected: FAIL because `claimTaskForFinalization` is missing and current done/error transitions do not match.

- [ ] **Step 3: Implement conditional state transitions**

```ts
export type AgentTaskStatus =
  | "running"
  | "finalizing"
  | "done"
  | "cancelled"
  | "error";

export async function claimTaskForFinalization(
  id: string,
): Promise<boolean> {
  const userId = await requireUserId();
  const result = await prisma.agentTask.updateMany({
    where: { id, userId, status: "running" },
    data: { status: "finalizing" },
  });
  return result.count === 1;
}

export async function markTaskDone(
  id: string,
  result: string,
): Promise<boolean> {
  const userId = await requireUserId();
  const update = await prisma.agentTask.updateMany({
    where: { id, userId, status: "finalizing" },
    data: { status: "done", result },
  });
  return update.count === 1;
}

export async function markTaskError(
  id: string,
  error: string,
): Promise<void> {
  const userId = await requireUserId();
  await prisma.agentTask.updateMany({
    where: {
      id,
      userId,
      status: { in: ["running", "finalizing"] },
    },
    data: { status: "error", error },
  });
}
```

Keep `cancelTask` restricted to `status: "running"`. This is the atomic race:
cancel wins by changing `running -> cancelled`, or finalization wins by changing
`running -> finalizing`; both cannot succeed.

- [ ] **Step 4: Run the store tests and verify GREEN**

Run:

```powershell
pnpm exec vitest run src/lib/ai/tasks/store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/ai/tasks/store.ts src/lib/ai/tasks/store.test.ts
git commit -m "feat(agent): arbitrate cancellation before finalization"
```

### Task 4: Make the cancel endpoint interrupt same-instance work

**Files:**
- Modify: `src/app/api/agent/task/[id]/cancel/route.ts`

- [ ] **Step 1: Replace the endpoint body with explicit outcomes**

```ts
import { auth } from "@clerk/nextjs/server";
import {
  cancelTask,
  getTask,
} from "@/lib/ai/tasks/store";
import { abortActiveTask } from "@/lib/ai/tasks/cancellation";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/server";

export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Props) {
  const T = getDictionary(await getLocale());
  const { userId } = await auth();
  if (!userId) {
    return Response.json(
      { error: T.ai.errors.notAuthenticated },
      { status: 401 },
    );
  }

  const { id } = await params;
  if (await cancelTask(id)) {
    return Response.json({
      status: "cancelled",
      interrupted: abortActiveTask(id),
    });
  }

  const task = await getTask(id);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.status === "cancelled") {
    return Response.json({ status: "cancelled", interrupted: false });
  }
  return Response.json({ status: "already_finished", interrupted: false });
}
```

- [ ] **Step 2: Typecheck the route**

Run:

```powershell
pnpm exec tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```powershell
git add src/app/api/agent/task/[id]/cancel/route.ts
git commit -m "feat(agent): interrupt local work from cancel endpoint"
```

### Task 5: Stream reasoning and cancellation through the legacy agent

**Files:**
- Create: `src/lib/ai/agent.test.ts`
- Modify: `src/lib/ai/agent.ts`

- [ ] **Step 1: Write failing tests for planner and editor options**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleWorkspace } from "@/lib/workspace/sample";

const mocks = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("./openrouter", () => ({
  streamChatCompletion: mocks.stream,
}));

import { executeAgentEdit, planAgentTurn, workspaceAreas } from "./agent";

describe("legacy agent streaming", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test";
    mocks.stream.mockReset();
  });

  it("streams planner reasoning and forwards the task signal", async () => {
    const controller = new AbortController();
    const reasoning: string[] = [];
    mocks.stream.mockImplementationOnce(
      async (
        _model: string,
        _messages: unknown,
        _maxTokens: number,
        options: {
          signal?: AbortSignal;
          onReasoning?: (text: string) => void;
        },
      ) => {
        expect(options.signal).toBe(controller.signal);
        options.onReasoning?.("Checking the workspace.");
        return '{"action":"reply","reply":"Done"}';
      },
    );

    await planAgentTurn(sampleWorkspace, [], "help", "model", "en", {
      signal: controller.signal,
      onReasoning: (text) => reasoning.push(text),
    });

    expect(reasoning).toEqual(["Checking the workspace."]);
  });

  it("streams editor reasoning and applies the returned operations", async () => {
    const reasoning: string[] = [];
    mocks.stream.mockImplementationOnce(
      async (
        _model: string,
        _messages: unknown,
        _maxTokens: number,
        options: { onReasoning?: (text: string) => void },
      ) => {
        options.onReasoning?.("Preparing the smallest change.");
        return JSON.stringify({
          reply: "Renamed it.",
          ops: [{ op: "update_workspace", name: "Renamed workspace" }],
        });
      },
    );

    const result = await executeAgentEdit(
      sampleWorkspace,
      [],
      "rename it",
      {
        action: "edit",
        plan: "Rename the workspace",
        affectedAreaIds: [workspaceAreas(sampleWorkspace)[0].id],
        affectedAreas: [workspaceAreas(sampleWorkspace)[0]],
      },
      "model",
      "en",
      { onReasoning: (text) => reasoning.push(text) },
    );

    expect(result.workspace?.name).toBe("Renamed workspace");
    expect(reasoning).toEqual(["Preparing the smallest change."]);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run src/lib/ai/agent.test.ts
```

Expected: FAIL because the legacy functions do not accept streaming options and still call `chatCompletion`.

- [ ] **Step 3: Add a shared legacy model-call option and use streaming**

```ts
import { streamChatCompletion, type ChatMessage } from "./openrouter";

export interface AgentModelCallOptions {
  signal?: AbortSignal;
  onReasoning?: (text: string) => void;
}
```

Change both function signatures to accept a final optional argument:

```ts
export async function planAgentTurn(
  current: Workspace,
  history: AgentMessage[],
  message: string,
  model: string,
  locale: Locale = DEFAULT_LOCALE,
  options: AgentModelCallOptions = {},
): Promise<AgentDecision>
```

```ts
export async function executeAgentEdit(
  current: Workspace,
  history: AgentMessage[],
  message: string,
  decision: Extract<AgentDecision, { action: "edit" }>,
  model: string,
  locale: Locale = DEFAULT_LOCALE,
  options: AgentModelCallOptions = {},
): Promise<AgentResponse>
```

Replace each low-level call with:

```ts
const raw = await streamChatCompletion(model, messages, 1400, {
  signal: options.signal,
  onReasoning: options.onReasoning,
});
```

and:

```ts
const raw = await streamChatCompletion(model, messages, 8000, {
  signal: options.signal,
  onReasoning: options.onReasoning,
});
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
pnpm exec vitest run src/lib/ai/agent.test.ts src/lib/ai/openrouter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/ai/agent.ts src/lib/ai/agent.test.ts
git commit -m "feat(agent): stream thinking from legacy model calls"
```

### Task 6: Propagate cancellation through tools and controlled fetch

**Files:**
- Modify: `src/lib/ai/tools/registry.ts`
- Modify: `src/lib/ai/tools/registry.test.ts`
- Modify: `src/lib/net/controlled-fetch.ts`
- Modify: `src/lib/net/controlled-fetch.test.ts`
- Modify: `src/lib/ai/tools/builtin.ts`

- [ ] **Step 1: Add failing tool-registry cancellation tests**

```ts
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
```

- [ ] **Step 2: Run the tool test and verify RED**

Run:

```powershell
pnpm exec vitest run src/lib/ai/tools/registry.test.ts
```

Expected: FAIL because `ToolContext` has no signal and `run` does not enforce aborts.

- [ ] **Step 3: Add signal and timeout enforcement to the registry**

```ts
export interface ToolContext {
  taskId: string;
  workspaceJson?: string;
  signal?: AbortSignal;
}

export class ToolTimeoutError extends Error {}
```

Inside `run`, after input validation:

```ts
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
```

- [ ] **Step 4: Add caller-signal support to controlled fetch**

Extend `ControlledFetchOptions`:

```ts
signal?: AbortSignal;
```

Replace the local controller setup with:

```ts
const timeout = new AbortController();
const timer = setTimeout(
  () => timeout.abort(new Error("controlled fetch timed out")),
  timeoutMs,
);
const signal = options.signal
  ? AbortSignal.any([options.signal, timeout.signal])
  : timeout.signal;
```

Pass `signal` to `fetch`, and keep `clearTimeout(timer)` in `finally`.

- [ ] **Step 5: Add a controlled-fetch cancellation test**

```ts
it("forwards caller cancellation to fetch", async () => {
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  const controller = new AbortController();
  const fetchMock = vi.fn(
    async (_url: URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const pending = controlledFetch("https://example.com", {
    allowlist: ["example.com"],
    signal: controller.signal,
  });
  controller.abort(new Error("cancelled"));

  await expect(pending).rejects.toThrow("cancelled");
});
```

- [ ] **Step 6: Pass the tool signal from the built-in fetch handler**

```ts
handler: async (input, ctx) => {
  const result = await controlledFetch(input.url, {
    allowlist: fetchAllowlist(),
    signal: ctx.signal,
    audit: (record) =>
      console.log("[StudyOS] controlled_fetch", record),
  });
  return {
    status: result.status,
    contentType: result.contentType,
    text: result.text,
  };
},
```

- [ ] **Step 7: Run focused tests**

Run:

```powershell
pnpm exec vitest run src/lib/ai/tools/registry.test.ts src/lib/net/controlled-fetch.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/ai/tools/registry.ts src/lib/ai/tools/registry.test.ts src/lib/net/controlled-fetch.ts src/lib/net/controlled-fetch.test.ts src/lib/ai/tools/builtin.ts
git commit -m "feat(agent): propagate cancellation through tools"
```

### Task 7: Make the authentic loop observe the task signal

**Files:**
- Modify: `src/lib/ai/agent-loop.ts`
- Modify: `src/lib/ai/agent-loop.test.ts`

- [ ] **Step 1: Add a failing cancellation test**

```ts
it("stops the active model turn when the task signal aborts", async () => {
  mocks.chat.mockReset();
  const controller = new AbortController();
  mocks.chat.mockImplementationOnce(
    async (
      _model: string,
      _messages: unknown,
      _maxTokens: number,
      options?: { signal?: AbortSignal },
    ) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
          { once: true },
        );
      }),
  );

  const pending = runAgentLoop({
    workspace: WS,
    history: [],
    message: "rename",
    model: "m",
    budget,
    locale: "en",
    taskId: "t1",
    signal: controller.signal,
    emit: vi.fn(),
    now: () => 0,
  });
  controller.abort(new TaskCancelledError());

  await expect(pending).rejects.toBeInstanceOf(TaskCancelledError);
});
```

Import `TaskCancelledError` from `./tasks/cancellation`.

- [ ] **Step 2: Run the loop test and verify RED**

Run:

```powershell
pnpm exec vitest run src/lib/ai/agent-loop.test.ts
```

Expected: FAIL because `RunAgentLoopParams` does not accept `signal`.

- [ ] **Step 3: Add signal support and cancellation checks**

Add:

```ts
import {
  TaskCancelledError,
  throwIfTaskCancelled,
} from "./tasks/cancellation";
```

Extend the params:

```ts
signal?: AbortSignal;
```

At loop entry and before/after every model/tool/validation boundary call:

```ts
throwIfTaskCancelled(params.signal);
```

Inside `callModel`, link the task signal to the existing deadline controller:

```ts
const abortFromTask = () =>
  controller.abort(params.signal?.reason ?? new TaskCancelledError());
params.signal?.addEventListener("abort", abortFromTask, { once: true });
```

In its catch block, check task cancellation first:

```ts
if (params.signal?.aborted) throw new TaskCancelledError();
if (controller.signal.aborted) throw new ModelDeadlineError();
throw error;
```

In its `finally`:

```ts
params.signal?.removeEventListener("abort", abortFromTask);
```

Pass the signal into tools:

```ts
const ctx = {
  taskId,
  workspaceJson: JSON.stringify(candidate),
  signal: params.signal,
};
```

Do not convert `TaskCancelledError` into a fallback reply.

- [ ] **Step 4: Run loop and registry tests**

Run:

```powershell
pnpm exec vitest run src/lib/ai/agent-loop.test.ts src/lib/ai/tools/registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/ai/agent-loop.ts src/lib/ai/agent-loop.test.ts
git commit -m "feat(agent): stop authentic loop on task cancellation"
```

### Task 8: Own cancellation and finalization in the agent route

**Files:**
- Modify: `src/app/api/agent/route.ts`
- Modify: `src/components/workspace/AgentChat.tsx` for reconnect recognition of `finalizing`

- [ ] **Step 1: Add route imports**

```ts
import {
  TaskCancelledError,
  isTaskCancelledError,
  registerActiveTask,
  throwIfTaskCancelled,
  watchDurableCancellation,
} from "@/lib/ai/tasks/cancellation";
import {
  appendTaskEvent,
  claimTaskForFinalization,
  createTask,
  isTaskCancelled,
  markTaskDone,
  markTaskError,
} from "@/lib/ai/tasks/store";
```

- [ ] **Step 2: Register the task controller and durable watcher**

Declare before the route `try`:

```ts
let stopWatching = () => undefined;
let unregisterActiveTask = () => undefined;
let taskSignal: AbortSignal | undefined;
```

Immediately after task creation:

```ts
const taskController = new AbortController();
taskSignal = taskController.signal;
unregisterActiveTask = registerActiveTask(task.id, taskController);
stopWatching = watchDurableCancellation({
  controller: taskController,
  isCancelled: () => isTaskCancelled(task.id),
});
```

- [ ] **Step 3: Pass reasoning and cancellation to both engines**

Authentic loop:

```ts
signal: taskSignal,
```

Legacy planner:

```ts
planAgentTurn(workspace, history, message, model, locale, {
  signal: taskSignal,
  onReasoning: (delta) => {
    void emit({ type: "thinking", phase: "planning", delta });
  },
}),
```

Legacy editor:

```ts
executeAgentEdit(
  workspace,
  history,
  message,
  decision,
  model,
  locale,
  {
    signal: taskSignal,
    onReasoning: (delta) => {
      void emit({ type: "thinking", phase: "updating", delta });
    },
  },
),
```

- [ ] **Step 4: Claim finalization before charge, apply, result persistence, or result emission**

Create a local helper after task creation:

```ts
const claimFinalization = async () => {
  throwIfTaskCancelled(taskSignal);
  if (!(await claimTaskForFinalization(task.id))) {
    throw new TaskCancelledError();
  }
};
```

For reply/clarify/no-change results, call:

```ts
await claimFinalization();
await chargeCredits(userId, usageToCredits(usage), "agent");
await markTaskDone(task.id, JSON.stringify(result));
await emit({ type: "result", response: result });
finish();
return;
```

For changed results, call `await claimFinalization()` immediately before
`applyAgentWorkspaceChange`. Remove the earlier standalone
`isTaskCancelled(task.id)` pre-apply check because the conditional claim is the
stronger atomic arbitration; retain `throwIfTaskCancelled(taskSignal)` before
the claim.

- [ ] **Step 5: Treat cancellation as a normal terminal path and always clean up**

Use:

```ts
} catch (error) {
  const cancelled =
    isTaskCancelledError(error, taskSignal) ||
    (taskId ? await isTaskCancelled(taskId).catch(() => false) : false);
  if (cancelled) {
    finish();
    return;
  }

  console.error("[StudyOS] streamed agent failed:", error);
  if (taskId) await markTaskError(taskId, "error").catch(() => {});
  send({
    type: "error",
    message:
      error instanceof WorkspaceVersionConflictError
        ? T.ai.agent.workspaceChanged
        : T.ai.agent.error,
  });
  finish();
} finally {
  stopWatching();
  unregisterActiveTask();
}
```

- [ ] **Step 6: Treat `finalizing` as an active reconnect state**

In `AgentChat.recoverTask`, replace the running-status condition with:

```ts
if (
  body?.status &&
  body.status !== "running" &&
  body.status !== "finalizing"
) {
  return false;
}
```

- [ ] **Step 7: Run typecheck and focused server tests**

Run:

```powershell
pnpm exec tsc --noEmit
pnpm exec vitest run src/lib/ai/agent.test.ts src/lib/ai/agent-loop.test.ts src/lib/ai/tasks/store.test.ts src/lib/ai/tasks/cancellation.test.ts
```

Expected: all commands pass.

- [ ] **Step 8: Commit**

```powershell
git add src/app/api/agent/route.ts src/components/workspace/AgentChat.tsx
git commit -m "feat(agent): wire thinking and immediate stop into route"
```

### Task 9: Add the acknowledged Stop task UI

**Files:**
- Create: `src/components/workspace/AgentChat.test.tsx`
- Modify: `src/components/workspace/AgentChat.tsx`
- Modify: `src/components/workspace/AgentProgressCard.tsx`
- Modify: `src/components/workspace/AgentProgressCard.test.tsx`

- [ ] **Step 1: Add failing progress-card tests**

Extend the i18n mock:

```ts
stopTask: "Stop task",
stopping: "Stopping…",
thinking: "Thinking…",
areaStatus: { queued: "Queued", working: "Updating", complete: "Ready" },
```

Add:

```ts
it("shows thinking and a prominent Stop task control", () => {
  const onStop = vi.fn();
  render(
    <AgentProgressCard
      activity={{
        ...createInitialAgentActivity("Working"),
        thinking: "Reviewing the course plan",
      }}
      onStop={onStop}
      stopping={false}
      canStop
    />,
  );

  expect(screen.getByText("Reviewing the course plan")).toBeInTheDocument();
  screen.getByRole("button", { name: "Stop task" }).click();
  expect(onStop).toHaveBeenCalledOnce();
});

it("disables the control and shows Stopping while cancellation is pending", () => {
  render(
    <AgentProgressCard
      activity={createInitialAgentActivity("Working")}
      onStop={vi.fn()}
      stopping
      canStop
    />,
  );
  expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
});
```

- [ ] **Step 2: Run the progress-card test and verify RED**

Run:

```powershell
pnpm exec vitest run src/components/workspace/AgentProgressCard.test.tsx
```

Expected: FAIL because the component still accepts `onCancel` only.

- [ ] **Step 3: Change the progress-card API and button**

Use:

```ts
export function AgentProgressCard({
  activity,
  onStop,
  stopping,
  canStop,
}: {
  activity: AgentActivityState;
  onStop: () => void;
  stopping: boolean;
  canStop: boolean;
})
```

Replace the current header action with:

```tsx
<button
  type="button"
  onClick={onStop}
  disabled={!canStop || stopping}
  className="rounded-md border border-paper/25 bg-paper/10 px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-paper transition hover:border-rose-300/70 hover:bg-rose-400/15 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-45"
>
  {stopping ? dict.agentChat.stopping : dict.agentChat.stopTask}
</button>
```

- [ ] **Step 4: Add the AgentChat cancellation test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentChat } from "./AgentChat";

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("./AgentUndoButton", () => ({
  AgentUndoButton: () => null,
}));
vi.mock("./AgentProgressCard", () => ({
  AgentProgressCard: ({
    onStop,
    stopping,
    canStop,
  }: {
    onStop: () => void;
    stopping: boolean;
    canStop: boolean;
  }) => (
    <button onClick={onStop} disabled={!canStop || stopping}>
      {stopping ? "Stopping…" : "Stop task"}
    </button>
  ),
}));
vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({
    dict: {
      agentChat: {
        initialMessage: "Opening",
        title: "AI agent",
        phase: {
          inspecting: "Reviewing",
          planning: "Planning",
          updating: "Updating",
          validating: "Checking",
          saving: "Saving",
        },
        subtitleIdle: "Idle",
        closeChat: "Close chat",
        intro: "Ask me",
        suggestions: [],
        errorRequestFailed: "Request failed",
        errorEndedUnexpectedly: "Ended unexpectedly",
        errorSnag: "Error",
        errorCouldntComplete: "Could not complete",
        workspaceUpdated: "Workspace updated",
        undone: "Undone",
        send: "Send",
        placeholderBusy: "Working…",
        placeholderIdle: "Ask the agent…",
        inputHint: "Hint",
        stopFailed: "Could not stop",
        taskStopped: "Task stopped.",
      },
    },
  }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("AgentChat stop task", () => {
it("waits for durable cancellation, aborts the stream, and shows Task stopped", async () => {
  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      controller.enqueue(
        encoder.encode('{"type":"task","taskId":"task-1"}\n'),
      );
    },
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(stream))
    .mockResolvedValueOnce(
      Response.json({ status: "cancelled", interrupted: true }),
    );
  vi.stubGlobal("fetch", fetchMock);

  render(
    <AgentChat
      workspaceId="ws-1"
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await userEvent.type(
    screen.getByPlaceholderText("Ask the agent…"),
    "rename home",
  );
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await userEvent.click(await screen.findByRole("button", { name: "Stop task" }));

  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/agent/task/task-1/cancel",
    { method: "POST" },
  );
  expect(await screen.findByText("Task stopped.")).toBeInTheDocument();
  streamController.close();
});
});
```

- [ ] **Step 5: Run the chat test and verify RED**

Run:

```powershell
pnpm exec vitest run src/components/workspace/AgentChat.test.tsx
```

Expected: FAIL because acknowledged stopping state is not implemented.

- [ ] **Step 6: Implement the acknowledged stop flow**

Add state and refs:

```ts
const [stopping, setStopping] = useState(false);
const [taskId, setTaskId] = useState<string | null>(null);
const stoppingRef = useRef(false);
```

When a task event arrives:

```ts
taskIdRef.current = event.taskId;
setTaskId(event.taskId);
```

Reset them at the start of `send`:

```ts
taskIdRef.current = null;
setTaskId(null);
stoppingRef.current = false;
setStopping(false);
```

Replace `cancel` with:

```ts
const stopTask = async () => {
  const id = taskIdRef.current;
  if (!id || stoppingRef.current) return;
  stoppingRef.current = true;
  setStopping(true);
  setError(null);

  try {
    const response = await fetch(`/api/agent/task/${id}/cancel`, {
      method: "POST",
    });
    const body = response.ok ? await response.json().catch(() => null) : null;
    if (!response.ok) throw new Error(dict.agentChat.stopFailed);
    if (body?.status === "already_finished") {
      stoppingRef.current = false;
      setStopping(false);
      if (!controllerRef.current) {
        const recovered = await recoverTask(id);
        setBusy(false);
        if (!recovered) setError(dict.agentChat.stopFailed);
      }
      return;
    }
    if (body?.status !== "cancelled") {
      throw new Error(dict.agentChat.stopFailed);
    }

    controllerRef.current?.abort();
    controllerRef.current = null;
    taskIdRef.current = null;
    setTaskId(null);
    setItems((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: dict.agentChat.taskStopped,
      },
    ]);
    setBusy(false);
  } catch (cause) {
    stoppingRef.current = false;
    setStopping(false);
    setError(
      cause instanceof Error ? cause.message : dict.agentChat.stopFailed,
    );
    if (!controllerRef.current) {
      await recoverTask(id);
      setBusy(false);
    }
  }
};
```

In the stream catch, skip recovery/error rendering while an acknowledged stop
is pending:

```ts
if (stoppingRef.current) return;
```

In `finally`, do not clear busy while Stop owns the terminal transition:

```ts
if (!stoppingRef.current) setBusy(false);
```

After successful Stop, finish with:

```ts
stoppingRef.current = false;
setStopping(false);
```

Render:

```tsx
{busy && (
  <AgentProgressCard
    activity={activity}
    onStop={stopTask}
    stopping={stopping}
    canStop={Boolean(taskId)}
  />
)}
```

- [ ] **Step 7: Run UI tests**

Run:

```powershell
pnpm exec vitest run src/components/workspace/AgentProgressCard.test.tsx src/components/workspace/AgentChat.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/components/workspace/AgentChat.tsx src/components/workspace/AgentChat.test.tsx src/components/workspace/AgentProgressCard.tsx src/components/workspace/AgentProgressCard.test.tsx
git commit -m "feat(agent): add acknowledged Stop task control"
```

### Task 10: Add localized Stop task copy

**Files:**
- Modify: `src/lib/i18n/dictionaries/en.ts`
- Modify: `src/lib/i18n/dictionaries/es.ts`
- Modify: `src/lib/i18n/dictionaries/de.ts`
- Modify: `src/lib/i18n/dictionaries/fr.ts`
- Modify: `src/lib/i18n/dictionaries/it.ts`
- Modify: `src/lib/i18n/dictionaries/pt.ts`
- Modify: `src/lib/i18n/dictionaries/nl.ts`
- Modify: `src/lib/i18n/dictionaries/zh.ts`
- Modify: `src/lib/i18n/dictionaries/ja.ts`
- Modify: `src/lib/i18n/dictionaries/ar.ts`

- [ ] **Step 1: Add the English contract**

Inside `agentChat`:

```ts
stopTask: "Stop task",
stopping: "Stopping…",
taskStopped: "Task stopped.",
stopFailed: "Could not stop the task. It may still be running.",
```

- [ ] **Step 2: Add equivalent keys to every locale**

Use:

```ts
// es
stopTask: "Detener tarea",
stopping: "Deteniendo…",
taskStopped: "Tarea detenida.",
stopFailed: "No se pudo detener la tarea. Es posible que siga ejecutándose.",

// de
stopTask: "Aufgabe stoppen",
stopping: "Wird gestoppt…",
taskStopped: "Aufgabe gestoppt.",
stopFailed: "Die Aufgabe konnte nicht gestoppt werden. Sie läuft möglicherweise weiter.",

// fr
stopTask: "Arrêter la tâche",
stopping: "Arrêt…",
taskStopped: "Tâche arrêtée.",
stopFailed: "Impossible d’arrêter la tâche. Elle est peut-être toujours en cours.",

// it
stopTask: "Interrompi attività",
stopping: "Interruzione…",
taskStopped: "Attività interrotta.",
stopFailed: "Impossibile interrompere l’attività. Potrebbe essere ancora in esecuzione.",

// pt
stopTask: "Parar tarefa",
stopping: "Parando…",
taskStopped: "Tarefa interrompida.",
stopFailed: "Não foi possível parar a tarefa. Ela ainda pode estar em execução.",

// nl
stopTask: "Taak stoppen",
stopping: "Stoppen…",
taskStopped: "Taak gestopt.",
stopFailed: "De taak kon niet worden gestopt. Mogelijk wordt deze nog uitgevoerd.",

// zh
stopTask: "停止任务",
stopping: "正在停止…",
taskStopped: "任务已停止。",
stopFailed: "无法停止任务。任务可能仍在运行。",

// ja
stopTask: "タスクを停止",
stopping: "停止中…",
taskStopped: "タスクを停止しました。",
stopFailed: "タスクを停止できませんでした。まだ実行中の可能性があります。",

// ar
stopTask: "إيقاف المهمة",
stopping: "جارٍ الإيقاف…",
taskStopped: "تم إيقاف المهمة.",
stopFailed: "تعذر إيقاف المهمة. قد تكون لا تزال قيد التشغيل.",
```

- [ ] **Step 3: Typecheck the dictionary contract**

Run:

```powershell
pnpm exec tsc --noEmit
```

Expected: all locale dictionaries satisfy the English `Dictionary` type.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/i18n/dictionaries
git commit -m "i18n: add agent stop task messages"
```

### Task 11: Full verification and browser acceptance

**Files:** No additional source changes unless verification exposes a defect.

- [ ] **Step 1: Run all tests**

```powershell
pnpm test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run TypeScript and lint**

```powershell
pnpm exec tsc --noEmit
pnpm lint
```

Expected: no errors.

- [ ] **Step 3: Run the production build**

```powershell
pnpm build
```

Expected: Prisma generation and `next build --webpack` complete successfully.

- [ ] **Step 4: Start the app with the legacy engine and verify in a browser**

```powershell
$env:AUTHENTIC_AGENT="0"
pnpm dev
```

Verify:

1. Send an agent request and confirm the Thinking region receives live text.
2. Stop during planning and confirm `Task stopped.` appears.
3. Reload the workspace and confirm its version/content did not change.

- [ ] **Step 5: Start the app with the authentic engine and verify in a browser**

```powershell
$env:AUTHENTIC_AGENT="1"
pnpm dev
```

Verify:

1. Thinking streams during planning and updating.
2. Stop during an active model turn ends the visible task promptly.
3. Stop during a tool-backed action prevents finalization.
4. A normal completed edit still applies and Undo still restores it.
5. Closing and reopening the chat still recovers `running`, `finalizing`, and `done` tasks.

- [ ] **Step 6: Inspect task state after cancellation**

Use the reconnect endpoint for the cancelled task and confirm:

```json
{ "status": "cancelled" }
```

Confirm there is no `done` result and no new `WorkspaceChange` for that task’s request.

- [ ] **Step 7: Commit any verification-only correction, then confirm a clean tree**

```powershell
git status --short
```

Expected: no uncommitted changes.

## Self-review

- Spec coverage: shared thinking is Tasks 5 and 8; local and cross-instance cancellation are Tasks 2, 4, and 8; model/tool/fetch abort propagation is Tasks 5–8; cancellation/apply arbitration is Task 3 and Task 8; acknowledged Stop UI is Task 9; localization is Task 10; both flag states and no-apply behavior are Task 11.
- Type consistency: `AgentTaskStatus` adds `finalizing`; `claimTaskForFinalization` returns `boolean`; `markTaskDone` accepts only `finalizing`; `ToolContext.signal`, `RunAgentLoopParams.signal`, and `AgentModelCallOptions.signal` all use `AbortSignal`.
- Safety: cancellation and finalization compete through one conditional database update. A task that is durably `cancelled` cannot later be claimed, marked done/error, charged, or applied.
