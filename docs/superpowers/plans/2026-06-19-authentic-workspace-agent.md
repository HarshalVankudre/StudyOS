# Authentic Workspace Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot workspace editor with a durable, bounded,
tool-using agent that can inspect, research, design, validate, repair, apply,
reconnect, cancel, remember workspace preferences, and create declarative
layouts without executing untrusted code.

**Architecture:** A trusted server-side orchestrator owns a
plan/action/observation loop over a candidate workspace. Versioned skills may
select only registered tools; tools run with strict schemas, real deadlines,
cancellation signals, and sanitized observations. A final validation pipeline
must pass before the existing owner-scoped version service atomically applies
the candidate and returns Undo.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, TypeScript, Zod 4, Prisma 6
with PostgreSQL, Clerk, Vercel AI SDK/OpenRouter transport, Vitest, Testing
Library, Tailwind CSS 4.

---

## Delivery increments

The plan is executed in order. Every increment leaves the application runnable:

1. Reliability and durable task runtime.
2. Candidate workspace, semantic validation, and declarative presentation.
3. Tool/skill registry enforcement and workspace memory.
4. Persistent orchestration loop and live route integration.
5. Renderer, authentic progress UI, reconnect, research, and rollout.
6. Full security, migration, build, and browser acceptance.

## File map

### Runtime and task state

- Modify `prisma/schema.prisma` — task state, task events, and workspace memory.
- Create `prisma/migrations/<timestamp>_authentic_agent/migration.sql` —
  additive database changes.
- Modify `src/lib/ai/tasks/store.ts` — conditional transitions, leases, expiry,
  event persistence, and active-task lookup.
- Create `src/lib/ai/tasks/store.integration.test.ts` — state transition and
  owner-scope behavior.
- Create `src/lib/ai/tasks/limits.ts` — per-plan concurrency/rate policy.
- Create `src/lib/ai/tasks/limits.test.ts`.

### Workspace capabilities

- Modify `src/lib/workspace/types.ts` — themes, layouts, and safe components.
- Modify `src/lib/workspace/schema.ts` — strict runtime schemas.
- Create `src/lib/workspace/references.ts` — semantic reference validator.
- Create `src/lib/workspace/references.test.ts`.
- Create `src/lib/workspace/presentation.ts` — presentation defaults and
  diagnostics.
- Create `src/lib/workspace/presentation.test.ts`.
- Modify `src/components/workspace/PageView.tsx` — render legacy or declarative
  layouts.
- Create `src/components/workspace/WorkspaceLayout.tsx`.
- Create `src/components/workspace/SafeWorkspaceComponent.tsx`.

### Agent runtime

- Create `src/lib/ai/orchestrator/types.ts` — plans, actions, observations,
  budgets, public events, and results.
- Create `src/lib/ai/orchestrator/state.ts` — deterministic state machine.
- Create `src/lib/ai/orchestrator/state.test.ts`.
- Create `src/lib/ai/orchestrator/candidate.ts` — immutable base plus mutable
  validated candidate.
- Create `src/lib/ai/orchestrator/candidate.test.ts`.
- Create `src/lib/ai/orchestrator/planner.ts` — structured plan and next-action
  calls.
- Create `src/lib/ai/orchestrator/run.ts` — bounded loop.
- Create `src/lib/ai/orchestrator/run.test.ts`.
- Create `src/lib/ai/orchestrator/progress.ts` — private-to-public event
  translation and redaction.
- Create `src/lib/ai/orchestrator/progress.test.ts`.
- Modify `src/lib/ai/openrouter.ts` — `AbortSignal` support.
- Modify `src/lib/ai/tools/registry.ts` — signal, deadline, output caps, and
  progress mapping.
- Modify `src/lib/ai/tools/builtin.ts` — complete trusted tool catalog.
- Modify `src/lib/ai/skills/registry.ts` — skill metadata and complete initial
  skill catalog.
- Create `src/lib/ai/memory/schema.ts`.
- Create `src/lib/ai/memory/store.ts`.
- Create `src/lib/ai/memory/store.test.ts`.

### API and client

- Replace orchestration in `src/app/api/agent/route.ts`.
- Modify `src/app/api/agent/task/[id]/route.ts` — restore events and expiry.
- Modify `src/app/api/agent/task/[id]/cancel/route.ts` — idempotent cancellation.
- Create `src/app/api/agent/route.test.ts`.
- Modify `src/lib/ai/agent-shared.ts` — public task/event contracts.
- Modify `src/components/workspace/AgentChat.tsx` — persisted active task and
  reconnect.
- Modify `src/components/workspace/AgentProgressCard.tsx` — real action cards.
- Create `src/components/workspace/AgentChat.test.tsx`.
- Modify all locale dictionaries through the English dictionary contract.

### Reliability and release

- Modify `src/components/GenerationActivity.tsx`.
- Modify `src/components/ThemeToggle.tsx`.
- Create or extend focused component tests.
- Modify `next.config.ts` — narrowly trace Prisma runtime files.
- Modify `package.json` and `pnpm-lock.yaml` — patched PostCSS resolution.
- Modify `src/app/app/actions.ts` — remove the unsafe direct legacy AI write.
- Create `scripts/check-standalone-trace.mjs` — assert source/docs/tests are not
  packaged.
- Modify `vitest.config.mts` — native path resolution without the deprecated
  plugin.

---

### Task 1: Establish the isolated execution baseline

**Files:**
- Verify only.

- [ ] **Step 1: Create an isolated worktree from the specification commit**

Run:

```powershell
git check-ignore -q .worktrees
git worktree add ".worktrees/authentic-agent" -b "feat/authentic-agent"
```

Expected: worktree created from the current `feat/agent-sandbox-increment-b`
HEAD without copying unrelated uncommitted files.

- [ ] **Step 2: Install exact locked dependencies**

Run:

```powershell
pnpm install --frozen-lockfile
```

Expected: exit zero.

- [ ] **Step 3: Capture baseline verification**

Run:

```powershell
pnpm test
pnpm exec tsc --noEmit
pnpm run build
pnpm run lint
```

Expected: tests, type checking, and build pass; lint reproduces the known React
hook errors before Task 2.

---

### Task 2: Fix current React correctness and test configuration failures

**Files:**
- Modify: `src/components/GenerationActivity.tsx`
- Create: `src/components/GenerationActivity.test.tsx`
- Modify: `src/components/ThemeToggle.tsx`
- Create: `src/components/ThemeToggle.test.tsx`
- Modify: `src/app/generate/GeneratorClient.tsx`
- Modify: `vitest.config.mts`

- [ ] **Step 1: Write failing typewriter behavior tests**

Create tests that render a small harness around an exported `useTypewriter`
hook and assert:

```tsx
it("restarts from the first character when the text changes", () => {
  vi.useFakeTimers();
  const { rerender } = render(<TypewriterHarness text="Alpha" />);
  act(() => vi.advanceTimersByTime(84));
  expect(screen.getByTestId("value")).toHaveTextContent("Al");
  rerender(<TypewriterHarness text="Beta" />);
  expect(screen.getByTestId("value")).toHaveTextContent("");
  act(() => vi.advanceTimersByTime(42));
  expect(screen.getByTestId("value")).toHaveTextContent("B");
});
```

- [ ] **Step 2: Verify the test fails**

Run:

```powershell
pnpm test -- src/components/GenerationActivity.test.tsx
```

Expected: FAIL because the hook is not exported and render-time ref mutation
still exists.

- [ ] **Step 3: Implement a key-based typewriter state**

Replace the render-time ref mutation with state containing both source text and
count:

```ts
export function useTypewriter(text: string, speed = 42): string {
  const [state, setState] = useState({ text, count: 0 });
  const count = state.text === text ? state.count : 0;

  useEffect(() => {
    if (!text) return;
    const id = window.setInterval(() => {
      setState((current) => {
        const currentCount = current.text === text ? current.count : 0;
        if (currentCount >= text.length) {
          window.clearInterval(id);
          return { text, count: currentCount };
        }
        return { text, count: currentCount + 1 };
      });
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed]);

  return text.slice(0, count);
}
```

- [ ] **Step 4: Write and verify a failing theme hydration test**

Test that the button renders a stable placeholder before mount and the correct
icon after an external-store hydration signal:

```tsx
it("switches to the resolved theme without a mount effect state update", async () => {
  render(<ThemeToggle />);
  expect(screen.getByRole("button", { name: "Toggle theme" })).toBeEnabled();
  expect(await screen.findByText("☀")).toBeInTheDocument();
});
```

Run:

```powershell
pnpm test -- src/components/ThemeToggle.test.tsx
```

Expected: FAIL against the current mount-effect implementation.

- [ ] **Step 5: Implement hydration with `useSyncExternalStore`**

Use:

```ts
const mounted = useSyncExternalStore(
  () => () => {},
  () => true,
  () => false,
);
```

Keep the current `suppressHydrationWarning` output and remove the synchronous
effect update.

- [ ] **Step 6: Remove the unused GeneratorClient binding and deprecated Vite plugin**

Remove the unused `t` destructuring. Replace `vite-tsconfig-paths` with:

```ts
resolve: {
  tsconfigPaths: true,
  alias: {
    "server-only": fileURLToPath(
      new URL("./src/test/server-only-stub.ts", import.meta.url),
    ),
  },
},
```

- [ ] **Step 7: Verify and commit**

Run:

```powershell
pnpm test -- src/components/GenerationActivity.test.tsx src/components/ThemeToggle.test.tsx
pnpm run lint
```

Expected: focused tests pass and ESLint exits zero.

Commit:

```powershell
git add src/components/GenerationActivity.tsx src/components/GenerationActivity.test.tsx src/components/ThemeToggle.tsx src/components/ThemeToggle.test.tsx src/app/generate/GeneratorClient.tsx vitest.config.mts
git commit -m "fix: clear React lint failures"
```

---

### Task 3: Harden production tracing and dependency resolution

**Files:**
- Modify: `next.config.ts`
- Create: `scripts/check-standalone-trace.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add a failing standalone trace check**

Create:

```js
import { access, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".next/standalone");
const forbidden = [
  "docs",
  "infra",
  "AGENTS.md",
  "README.md",
  path.join("src", "lib", "ai", "limits.test.ts"),
];

await access(root);
const topLevel = await readdir(root);
for (const entry of forbidden) {
  try {
    await access(path.join(root, entry));
    throw new Error(`standalone trace contains forbidden path: ${entry}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

if (!topLevel.includes("server.js")) {
  throw new Error("standalone server.js is missing");
}
```

- [ ] **Step 2: Verify the current build fails the check**

Run:

```powershell
pnpm run build
node scripts/check-standalone-trace.mjs
```

Expected: FAIL because `docs`, `infra`, or tests are present.

- [ ] **Step 3: Narrow Prisma tracing**

Replace the global trace include with route-scoped engine and schema includes:

```ts
outputFileTracingIncludes: {
  "/*": [
    "./src/generated/prisma/schema.prisma",
    "./src/generated/prisma/libquery_engine-*",
    "./src/generated/prisma/query_engine-*",
  ],
},
```

Do not use `"/**"` as the trace key.

- [ ] **Step 4: Patch PostCSS through pnpm overrides**

Add:

```json
"pnpm": {
  "overrides": {
    "postcss": "8.5.10"
  }
}
```

Run:

```powershell
pnpm install
pnpm audit --prod --registry=https://registry.npmjs.org
```

Expected: no GHSA-qx2v-qp2m-jg93 finding.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm run build
node scripts/check-standalone-trace.mjs
```

Expected: build and trace check pass.

Commit:

```powershell
git add next.config.ts scripts/check-standalone-trace.mjs package.json pnpm-lock.yaml
git commit -m "fix: harden production bundle tracing"
```

---

### Task 4: Extend durable tasks with safe state transitions and events

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260619003000_authentic_agent_runtime/migration.sql`
- Modify: `src/lib/ai/tasks/store.ts`
- Modify: `src/lib/ai/tasks/store.test.ts`

- [ ] **Step 1: Write failing store tests**

Add tests proving:

```ts
it("does not mark a cancelled task done", async () => {
  prisma.agentTask.updateMany.mockResolvedValue({ count: 0 });
  await expect(markTaskDone("task-1", "{}")).resolves.toBe(false);
  expect(prisma.agentTask.updateMany).toHaveBeenCalledWith({
    where: { id: "task-1", userId: "user-1", status: "running" },
    data: expect.objectContaining({ status: "done" }),
  });
});

it("returns no expired task", async () => {
  prisma.agentTask.findFirst.mockResolvedValue(null);
  await getTask("task-1");
  expect(prisma.agentTask.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        expiresAt: { gt: expect.any(Date) },
      }),
    }),
  );
});
```

Also test ordered public event persistence and active task lookup by owner plus
workspace.

- [ ] **Step 2: Verify failure**

Run:

```powershell
pnpm test -- src/lib/ai/tasks/store.test.ts
```

Expected: FAIL because terminal updates are unconditional and events do not
exist.

- [ ] **Step 3: Add additive task fields and event model**

Add:

```prisma
model AgentTask {
  id               String   @id @default(cuid())
  userId           String
  workspaceId      String
  baseVersion      Int
  status           String   @default("running")
  publicPhase      String   @default("inspecting")
  selectedSkills   String   @default("[]")
  currentStep      Int      @default(0)
  observations     String   @default("[]")
  candidateOps     String   @default("[]")
  promptTokens     Int      @default(0)
  completionTokens Int      @default(0)
  toolCalls        Int      @default(0)
  modelTurns       Int      @default(0)
  researchFetches  Int      @default(0)
  cancelledAt      DateTime?
  heartbeatAt      DateTime @default(now())
  result           String?
  error            String?
  expiresAt        DateTime
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  events           AgentTaskEvent[]

  @@index([userId, workspaceId, status])
  @@index([expiresAt])
}

model AgentTaskEvent {
  id        String    @id @default(cuid())
  taskId    String
  sequence  Int
  type      String
  payload   String
  createdAt DateTime  @default(now())
  task      AgentTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@unique([taskId, sequence])
  @@index([taskId, createdAt])
}
```

The migration must alter the existing table additively and create
`AgentTaskEvent`.

- [ ] **Step 4: Implement conditional transitions**

Change terminal methods to return booleans:

```ts
export async function markTaskDone(id: string, result: string): Promise<boolean> {
  const userId = await requireUserId();
  const updated = await prisma.agentTask.updateMany({
    where: { id, userId, status: "running" },
    data: { status: "done", result, heartbeatAt: new Date() },
  });
  return updated.count === 1;
}
```

Use the same `status: "running"` guard for error. Cancellation sets
`cancelledAt`, and reads require `expiresAt > now`.

- [ ] **Step 5: Implement public event append and restore**

Add `appendTaskEvent`, `listTaskEvents`, `updateTaskCheckpoint`, and
`getActiveTaskForWorkspace`. Assign `sequence` inside a transaction by reading
the highest task sequence and inserting the next value.

- [ ] **Step 6: Verify migration and tests**

Run:

```powershell
pnpm prisma validate
pnpm prisma generate
pnpm test -- src/lib/ai/tasks/store.test.ts
pnpm exec tsc --noEmit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/20260619003000_authentic_agent_runtime/migration.sql src/lib/ai/tasks/store.ts src/lib/ai/tasks/store.test.ts
git commit -m "feat: persist authentic agent task state"
```

---

### Task 5: Enforce task concurrency and rolling rate limits

**Files:**
- Create: `src/lib/ai/tasks/limits.ts`
- Create: `src/lib/ai/tasks/limits.test.ts`
- Modify: `src/app/api/agent/route.ts`

- [ ] **Step 1: Write failing policy tests**

Test:

```ts
expect(taskPolicyForPlan("free")).toEqual(
  expect.objectContaining({
    maxConcurrent: 1,
    maxWallTimeMs: 90_000,
    maxModelTurns: 8,
    maxToolCalls: 12,
    maxResearchFetches: 3,
  }),
);

expect(taskPolicyForPlan("pro")).toEqual(
  expect.objectContaining({
    maxConcurrent: 2,
    maxWallTimeMs: 180_000,
    maxModelTurns: 14,
    maxToolCalls: 24,
    maxResearchFetches: 8,
  }),
);
```

Mock Prisma to verify `reserveTaskSlot` rejects when the active task count or
recent request count exceeds policy.

- [ ] **Step 2: Verify failure**

Run:

```powershell
pnpm test -- src/lib/ai/tasks/limits.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement policy and reservation**

Export:

```ts
export interface AgentTaskPolicy {
  maxConcurrent: number;
  maxRequestsPerMinute: number;
  maxWallTimeMs: number;
  maxModelTurns: number;
  maxToolCalls: number;
  maxResearchFetches: number;
  maxRepairAttempts: number;
}
```

Use active `AgentTask` rows and recent `createdAt` rows scoped by `userId`.
Expired running rows do not count.

- [ ] **Step 4: Integrate before task creation**

The route obtains the actual billing plan, calls `assertTaskCapacity`, and
returns localized `429` JSON before opening a stream when capacity is exceeded.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm test -- src/lib/ai/tasks/limits.test.ts
pnpm exec tsc --noEmit
```

Commit:

```powershell
git add src/lib/ai/tasks/limits.ts src/lib/ai/tasks/limits.test.ts src/app/api/agent/route.ts
git commit -m "feat: limit concurrent agent tasks"
```

---

### Task 6: Add declarative presentation types with backward compatibility

**Files:**
- Modify: `src/lib/workspace/types.ts`
- Modify: `src/lib/workspace/schema.ts`
- Create: `src/lib/workspace/presentation.test.ts`

- [ ] **Step 1: Write failing schema tests**

Test that a legacy `sampleWorkspace` still parses unchanged and a new workspace
accepts:

```ts
presentation: {
  theme: {
    accent: "lime",
    density: "comfortable",
    radius: "medium",
    shadow: "soft",
    contentWidth: "wide",
  },
  pageLayouts: {
    dashboard: {
      sections: [{
        id: "section-focus",
        width: "wide",
        columns: 3,
        collapse: "stack",
        gap: "medium",
        padding: "medium",
        children: [
          { kind: "block", blockId: "heading-1", span: 3 },
          {
            kind: "component",
            component: {
              id: "metric-1",
              type: "metric",
              props: { label: "Due this week", value: "4" },
            },
            span: 1,
          },
        ],
      }],
    },
  },
}
```

Also assert unknown component types, raw HTML props, spans above the column
count, and unknown theme tokens are rejected.

- [ ] **Step 2: Verify failure**

Run:

```powershell
pnpm test -- src/lib/workspace/presentation.test.ts
```

Expected: FAIL because presentation types are absent.

- [ ] **Step 3: Add presentation types**

Add discriminated safe component types for:

```ts
type SafeComponentType =
  | "card"
  | "metric"
  | "progress"
  | "timeline"
  | "upcoming_list"
  | "priority_list"
  | "course_summary"
  | "deadline_summary"
  | "study_streak"
  | "database_view_frame"
  | "callout_group"
  | "section_heading";
```

Add `WorkspacePresentation`, `WorkspaceTheme`, `PageLayout`,
`WorkspaceSection`, and `LayoutChild`. Make `presentation` optional on
`Workspace`.

- [ ] **Step 4: Add strict schemas and cross-field refinement**

Use `.strict()` on presentation and component objects. Refine each section so
every child span is between 1 and the section's columns. Refine component props
by component type rather than allowing arbitrary records.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm test -- src/lib/workspace/presentation.test.ts src/test/smoke.test.ts
pnpm exec tsc --noEmit
```

Commit:

```powershell
git add src/lib/workspace/types.ts src/lib/workspace/schema.ts src/lib/workspace/presentation.test.ts
git commit -m "feat: add declarative workspace presentation"
```

---

### Task 7: Implement complete semantic workspace validation

**Files:**
- Create: `src/lib/workspace/references.ts`
- Create: `src/lib/workspace/references.test.ts`
- Modify: `src/lib/workspace/schema.ts`

- [ ] **Step 1: Write failing reference tests**

Cover each invalid case:

```ts
it.each([
  "duplicate page id",
  "missing home page",
  "missing database view database",
  "missing database view id",
  "missing relation database",
  "missing related row",
  "missing select option",
  "missing board group property",
  "missing calendar date property",
  "missing visible property",
  "missing layout block",
  "duplicate component id",
])("reports %s", (scenario) => {
  const issues = validateWorkspaceReferences(workspaceForScenario(scenario));
  expect(issues).toContainEqual(
    expect.objectContaining({ code: expect.any(String), path: expect.any(Array) }),
  );
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
pnpm test -- src/lib/workspace/references.test.ts
```

Expected: FAIL because validator does not exist.

- [ ] **Step 3: Implement typed issues**

Export:

```ts
export interface WorkspaceReferenceIssue {
  code:
    | "duplicate_id"
    | "missing_reference"
    | "invalid_property_type"
    | "invalid_cell_value"
    | "invalid_layout_reference";
  path: (string | number)[];
  message: string;
  entityLabel?: string;
}
```

Build maps for all IDs and validate every reference and typed cell value.

- [ ] **Step 4: Add complete validation helper**

Export:

```ts
export function validateWorkspace(data: unknown):
  | { success: true; data: Workspace }
  | { success: false; schemaIssues: z.ZodIssue[]; referenceIssues: WorkspaceReferenceIssue[] }
```

Schema validation runs first; semantic validation runs only on parsed data.

- [ ] **Step 5: Use complete validation in version apply and generation**

Replace `safeParseWorkspace` at persistence boundaries where a whole workspace
is accepted. Keep the shape-only helper for local parsing when semantic
validation would be intentionally deferred during operation construction.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
pnpm test -- src/lib/workspace/references.test.ts src/lib/workspace/version-service.test.ts src/lib/workspace/version-schema.test.ts
```

Commit:

```powershell
git add src/lib/workspace/references.ts src/lib/workspace/references.test.ts src/lib/workspace/schema.ts src/lib/workspace/version-service.ts src/lib/ai/generate.ts
git commit -m "feat: validate workspace references"
```

---

### Task 8: Build deterministic presentation diagnostics

**Files:**
- Create: `src/lib/workspace/presentation.ts`
- Extend: `src/lib/workspace/presentation.test.ts`

- [ ] **Step 1: Write failing diagnostics tests**

Test issues for:

- More than four columns.
- A metric without label or value.
- A section with too many children for its density.
- A component referring to a missing database/view.
- A page layout that omits every legacy block.
- Heading hierarchy that skips levels.
- Long unbroken labels likely to overflow compact metrics.

Expected API:

```ts
const issues = reviewWorkspacePresentation(workspace, "dashboard");
expect(issues).toContainEqual(
  expect.objectContaining({
    severity: "error",
    code: "missing_layout_content",
  }),
);
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
pnpm test -- src/lib/workspace/presentation.test.ts
```

- [ ] **Step 3: Implement deterministic review**

Export `PresentationIssue` with `error` and `warning` severity. Errors prevent
apply; warnings become repair observations but may pass after the repair budget
is exhausted when accessibility and references remain valid.

- [ ] **Step 4: Verify and commit**

```powershell
pnpm test -- src/lib/workspace/presentation.test.ts
git add src/lib/workspace/presentation.ts src/lib/workspace/presentation.test.ts
git commit -m "feat: diagnose workspace presentation"
```

---

### Task 9: Add a candidate workspace boundary

**Files:**
- Create: `src/lib/ai/orchestrator/candidate.ts`
- Create: `src/lib/ai/orchestrator/candidate.test.ts`

- [ ] **Step 1: Write failing candidate tests**

Test:

```ts
const candidate = createCandidateWorkspace(sampleWorkspace, 4);
const result = candidate.apply([renamePageOp]);
expect(result.workspace.pages[0].title).toBe("Weekly Focus");
expect(candidate.baseWorkspace.pages[0].title).not.toBe("Weekly Focus");
expect(candidate.operations).toEqual([renamePageOp]);
```

Also assert invalid operations do not mutate candidate state and operations are
bounded by `agentOpsSchema`.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/lib/ai/orchestrator/candidate.test.ts
```

- [ ] **Step 3: Implement candidate API**

Expose:

```ts
export interface CandidateWorkspace {
  readonly baseWorkspace: Workspace;
  readonly baseVersion: number;
  readonly workspace: Workspace;
  readonly operations: AgentOp[];
  apply(ops: AgentOp[]): CandidateWorkspace;
}
```

Every `apply` clones through `applyAgentOps`, shape-validates the intermediate
workspace, and returns a new candidate instance.

- [ ] **Step 4: Verify and commit**

```powershell
pnpm test -- src/lib/ai/orchestrator/candidate.test.ts
git add src/lib/ai/orchestrator/candidate.ts src/lib/ai/orchestrator/candidate.test.ts
git commit -m "feat: add agent candidate workspace"
```

---

### Task 10: Enforce tool cancellation, deadlines, and output caps

**Files:**
- Modify: `src/lib/ai/tools/registry.ts`
- Modify: `src/lib/ai/tools/registry.test.ts`

- [ ] **Step 1: Add failing registry tests**

Test:

```ts
it("aborts a tool after its deadline", async () => {
  const registry = createToolRegistry();
  registry.register(slowTool({ timeoutMs: 10 }));
  await expect(
    registry.run("slow", {}, contextWithSignal()),
  ).rejects.toBeInstanceOf(ToolTimeoutError);
});

it("rejects output above maxOutputBytes", async () => {
  await expect(
    registry.run("large", {}, contextWithSignal()),
  ).rejects.toBeInstanceOf(ToolOutputTooLargeError);
});
```

Also verify parent abort propagation and sanitized `toProgress` output.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/lib/ai/tools/registry.test.ts
```

- [ ] **Step 3: Expand tool contracts**

Use:

```ts
limits: {
  timeoutMs: number;
  maxOutputBytes: number;
}
```

Add `signal: AbortSignal` and `candidate: CandidateWorkspace` to
`ToolContext`. Race handlers against an abortable deadline and validate
serialized output bytes before returning.

- [ ] **Step 4: Verify and commit**

```powershell
pnpm test -- src/lib/ai/tools/registry.test.ts
git add src/lib/ai/tools/registry.ts src/lib/ai/tools/registry.test.ts
git commit -m "feat: enforce agent tool limits"
```

---

### Task 11: Implement the trusted tool catalog

**Files:**
- Modify: `src/lib/ai/tools/builtin.ts`
- Create: `src/lib/ai/tools/builtin.test.ts`

- [ ] **Step 1: Write failing behavior tests**

Create real candidate workspaces and test:

- `inspect_workspace` returns capabilities and warnings.
- `find_entities` searches names, labels, and row text with a result cap.
- `read_area` rejects unknown IDs.
- `apply_ops` returns a new candidate plus validation summary.
- `create_layout` produces typed layout operations/data.
- `update_theme` accepts only approved tokens.
- `compose_component` rejects unknown component types or props.
- `validate_references`, `validate_layout`, `check_accessibility`,
  `review_presentation`, and `validate_candidate` return typed issues.
- `read_web_source` uses the controlled fetch dependency and consumes a
  research budget.
- `extract_research_notes` treats page text as data and returns bounded claims.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/lib/ai/tools/builtin.test.ts
```

- [ ] **Step 3: Implement inspection and query tools**

Register `inspect_workspace`, `find_entities`, `read_area`, and
`summarize_workspace`. Outputs must contain workspace labels and IDs needed by
the private planner but no owner or database record metadata.

- [ ] **Step 4: Implement candidate editing tools**

Register `apply_ops`, `create_layout`, `update_theme`, `compose_component`, and
`restructure_database`. Each mutation tool returns typed operations or a new
candidate; it never writes through Prisma.

- [ ] **Step 5: Implement validation tools**

Wrap the validators from Tasks 7 and 8. Add deterministic accessibility checks
for missing labels, empty headings, ambiguous link text, and token contrast
pairs.

- [ ] **Step 6: Implement bounded research tools**

Rename `controlled_fetch` to the user-purpose-oriented private tool
`read_web_source`. Pass task ID into audit records. Strip scripts, styles, and
excess whitespace before returning bounded text. `extract_research_notes`
returns:

```ts
{
  source: { url: string; title?: string; publishedAt?: string };
  claims: { text: string; evidence: string }[];
}
```

- [ ] **Step 7: Verify and commit**

```powershell
pnpm test -- src/lib/ai/tools/builtin.test.ts src/lib/net/controlled-fetch.test.ts
git add src/lib/ai/tools/builtin.ts src/lib/ai/tools/builtin.test.ts
git commit -m "feat: add trusted workspace agent tools"
```

---

### Task 12: Expand the versioned skill catalog

**Files:**
- Modify: `src/lib/ai/skills/registry.ts`
- Modify: `src/lib/ai/skills/registry.test.ts`

- [ ] **Step 1: Write failing skill tests**

Test selection metadata and capability restrictions:

```ts
const skill = skillRegistry.get("dashboard-designer");
expect(skill?.requiredValidationToolIds).toContain("review_presentation");
expect(skill?.toolIds).not.toContain("shell_exec");
expect(skill?.maxRepairAttempts).toBe(2);
```

Assert registration fails when a required validator is not also allowed.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/lib/ai/skills/registry.test.ts
```

- [ ] **Step 3: Expand the skill definition**

Add:

```ts
selectionHints: string[];
completionCriteria: string[];
requiredValidationToolIds: string[];
maxRepairAttempts: number;
```

- [ ] **Step 4: Register the initial catalog**

Register:

- `precise-edit`
- `workspace-architect`
- `dashboard-designer`
- `study-planner`
- `database-designer`
- `research-synthesizer`
- `visual-repair`
- `accessibility-reviewer`
- `quality-reviewer`

All mutation skills include `validate_candidate`; visual skills also require
layout, accessibility, and presentation review.

- [ ] **Step 5: Verify and commit**

```powershell
pnpm test -- src/lib/ai/skills/registry.test.ts
git add src/lib/ai/skills/registry.ts src/lib/ai/skills/registry.test.ts
git commit -m "feat: add workspace agent skills"
```

---

### Task 13: Add owner-scoped workspace memory

**Files:**
- Modify: `prisma/schema.prisma`
- Extend: `prisma/migrations/20260619003000_authentic_agent_runtime/migration.sql`
- Create: `src/lib/ai/memory/schema.ts`
- Create: `src/lib/ai/memory/store.ts`
- Create: `src/lib/ai/memory/store.test.ts`

- [ ] **Step 1: Write failing memory tests**

Test that:

- Loads require both owner and workspace IDs.
- Preferences are limited to approved keys and bounded strings.
- Raw fetched pages and secret-looking keys are rejected.
- Successful outcome commits increment revision.
- Failed tasks do not write memory.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/lib/ai/memory/store.test.ts
```

- [ ] **Step 3: Add the memory model**

```prisma
model WorkspaceAgentMemory {
  id             String   @id @default(cuid())
  ownerId        String
  workspaceId    String
  summary        String   @default("")
  preferences    String   @default("{}")
  recentOutcomes String   @default("[]")
  revision       Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([ownerId, workspaceId])
  @@index([ownerId, updatedAt])
}
```

- [ ] **Step 4: Implement memory schemas**

Preferences support:

```ts
{
  visualDensity?: "compact" | "comfortable" | "spacious";
  planningStyle?: "daily" | "weekly" | "milestone";
  preferredStatusLabels?: string[];
  preferredAccent?: WorkspaceTheme["accent"];
  notes?: string[];
}
```

Cap summary at 4,000 characters, notes at 20 entries/300 characters, and recent
outcomes at 10.

- [ ] **Step 5: Implement owner-scoped read and conditional commit**

Memory commit accepts a validated proposal only after the task is marked done.
Use an upsert with revision increment.

- [ ] **Step 6: Verify and commit**

```powershell
pnpm prisma validate
pnpm prisma generate
pnpm test -- src/lib/ai/memory/store.test.ts
git add prisma/schema.prisma prisma/migrations/20260619003000_authentic_agent_runtime/migration.sql src/lib/ai/memory/schema.ts src/lib/ai/memory/store.ts src/lib/ai/memory/store.test.ts
git commit -m "feat: remember workspace agent preferences"
```

---

### Task 14: Define orchestration types and state transitions

**Files:**
- Create: `src/lib/ai/orchestrator/types.ts`
- Create: `src/lib/ai/orchestrator/state.ts`
- Create: `src/lib/ai/orchestrator/state.test.ts`

- [ ] **Step 1: Write failing transition tests**

Test valid transitions and reject invalid ones:

```ts
expect(transition("planning", "running_tool")).toBe("running_tool");
expect(transition("running_tool", "observing")).toBe("observing");
expect(() => transition("completed", "running_tool")).toThrow();
expect(() => transition("cancelled", "applying")).toThrow();
```

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/lib/ai/orchestrator/state.test.ts
```

- [ ] **Step 3: Define strict planning and action schemas**

`AgentPlan` is a discriminated union for `answer`, `clarify`, and `execute`.
Execution plans contain skill IDs, goal, steps, completion criteria, research
requirement, and expected area IDs.

`AgentAction` is:

```ts
z.discriminatedUnion("type", [
  z.object({ type: z.literal("tool"), toolId: z.string(), input: z.unknown() }),
  z.object({ type: z.literal("finish"), reply: z.string(), memory: memoryProposalSchema.optional() }),
  z.object({ type: z.literal("clarify"), reply: z.string(), choices: agentChoicesSchema }),
]);
```

- [ ] **Step 4: Implement state transitions and budget counters**

Add deterministic helpers for model turns, tool calls, research calls, repair
attempts, wall-time deadline, and cancellation.

- [ ] **Step 5: Verify and commit**

```powershell
pnpm test -- src/lib/ai/orchestrator/state.test.ts
git add src/lib/ai/orchestrator/types.ts src/lib/ai/orchestrator/state.ts src/lib/ai/orchestrator/state.test.ts
git commit -m "feat: define agent orchestration state"
```

---

### Task 15: Add abortable structured planner and next-action model calls

**Files:**
- Modify: `src/lib/ai/openrouter.ts`
- Create: `src/lib/ai/orchestrator/planner.ts`
- Create: `src/lib/ai/orchestrator/planner.test.ts`

- [ ] **Step 1: Write failing abort and schema retry tests**

Test that `chatCompletion` forwards `AbortSignal`, and the planner performs one
corrective retry when the first response fails the schema. The second invalid
response fails with `AgentPlanningError`.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/lib/ai/orchestrator/planner.test.ts
```

- [ ] **Step 3: Add `signal` to OpenRouter transport**

Update:

```ts
export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  signal?: AbortSignal,
)
```

Pass `signal` to `fetch`.

- [ ] **Step 4: Implement structured planning**

The system prompt includes registered skill metadata, workspace summary,
memory, limits, and explicit prompt-injection boundaries. It never includes
disabled tool definitions.

- [ ] **Step 5: Implement structured next-action selection**

The action prompt receives the private plan, bounded observations, candidate
summary, remaining budgets, and validation issues. It chooses exactly one tool,
finish, or clarification action.

- [ ] **Step 6: Verify and commit**

```powershell
pnpm test -- src/lib/ai/orchestrator/planner.test.ts
git add src/lib/ai/openrouter.ts src/lib/ai/orchestrator/planner.ts src/lib/ai/orchestrator/planner.test.ts
git commit -m "feat: add structured agent planning"
```

---

### Task 16: Implement progress translation and redaction

**Files:**
- Create: `src/lib/ai/orchestrator/progress.ts`
- Create: `src/lib/ai/orchestrator/progress.test.ts`
- Modify: `src/lib/ai/agent-shared.ts`

- [ ] **Step 1: Write failing redaction tests**

Feed events containing tool IDs, file paths, UUIDs, JSON, and URLs with query
parameters. Assert public events expose localized titles and safe details only.
Assert progress never decreases.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/lib/ai/orchestrator/progress.test.ts
```

- [ ] **Step 3: Define public events**

Use:

```ts
type AgentPublicEvent =
  | { type: "task"; taskId: string }
  | { type: "phase"; phase: AgentPhase; message: string; progress: number }
  | { type: "discovery"; discovery: AgentDiscovery; progress: number }
  | { type: "action_completed"; action: { id: string; title: string; detail?: string }; progress: number }
  | { type: "result"; response: AgentResponse }
  | { type: "error"; message: string };
```

- [ ] **Step 4: Implement translator**

Progress bands remain 0–15, 15–35, 35–75, 75–92, and 92–100. Internal events
advance within a band based on completed plan steps and validations.

- [ ] **Step 5: Verify and commit**

```powershell
pnpm test -- src/lib/ai/orchestrator/progress.test.ts src/lib/ai/progress.test.ts
git add src/lib/ai/orchestrator/progress.ts src/lib/ai/orchestrator/progress.test.ts src/lib/ai/agent-shared.ts
git commit -m "feat: translate authentic agent progress"
```

---

### Task 17: Implement the bounded plan/action/observation loop

**Files:**
- Create: `src/lib/ai/orchestrator/run.ts`
- Create: `src/lib/ai/orchestrator/run.test.ts`

- [ ] **Step 1: Write a failing multi-tool success test**

Inject fake planner and registry dependencies:

```ts
const result = await runAgentTask({
  planner: scriptedPlanner([
    tool("inspect_workspace", {}),
    tool("find_entities", { query: "dashboard" }),
    tool("apply_ops", { ops: [renamePageOp] }),
    tool("validate_candidate", {}),
    finish("Renamed the dashboard."),
  ]),
  ...
});

expect(result.candidate.workspace.pages[0].title).toBe("Weekly Focus");
expect(result.observations).toHaveLength(4);
```

- [ ] **Step 2: Write failing repair, cancel, and budget tests**

Cover:

- Invalid candidate validation leads to a repair action and second validation.
- Cancellation before apply returns `cancelled`.
- Tool timeout becomes an observation and allows replanning.
- Exceeding model/tool/research/time budget fails safely.
- Finish before required validators is rejected.
- Research action is rejected when the skill lacks the tool.

- [ ] **Step 3: Verify failure**

```powershell
pnpm test -- src/lib/ai/orchestrator/run.test.ts
```

- [ ] **Step 4: Implement dependency-injected orchestration**

`runAgentTask` receives planner, registry, skills, task store, memory, clock,
abort signal, candidate, and event sink. It:

1. Plans.
2. Persists selected skills and checkpoint.
3. Repeatedly asks for one action.
4. Checks cancellation and budgets.
5. Runs allowed tools.
6. Stores bounded observations and public events.
7. Requires skill validators before finish.
8. Runs repairs within budget.
9. Returns a final candidate, response, sources, and memory proposal.

- [ ] **Step 5: Verify and commit**

```powershell
pnpm test -- src/lib/ai/orchestrator/run.test.ts
git add src/lib/ai/orchestrator/run.ts src/lib/ai/orchestrator/run.test.ts
git commit -m "feat: run a tool-using workspace agent"
```

---

### Task 18: Replace the live API route with the authentic orchestrator

**Files:**
- Modify: `src/app/api/agent/route.ts`
- Create: `src/app/api/agent/route.test.ts`
- Modify: `src/lib/flags.ts`
- Modify: `src/app/app/actions.ts`

- [ ] **Step 1: Write failing route tests**

Mock route dependencies and assert:

- Creates a durable task and emits its ID.
- Calls `runAgentTask`, not `executeAgentEdit`.
- Applies only the final candidate.
- Rechecks cancellation immediately before apply.
- Marks done only when conditional transition succeeds.
- Commits memory only after successful apply.
- Returns clarification without applying.
- Returns `409`-equivalent stream error on version conflict.
- Enforces `AUTHENTIC_AGENT`.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/app/api/agent/route.test.ts
```

- [ ] **Step 3: Add the rollout flag**

Add:

```ts
export function authenticAgentEnabled(): boolean {
  return envFlag("AUTHENTIC_AGENT");
}
```

The old agent remains an explicit fallback only when the flag is off before
task creation. Never switch after authentic execution begins.

- [ ] **Step 4: Replace route internals**

The route:

1. Authenticates and validates.
2. Loads plan, task policy, owned snapshot, and memory in parallel.
3. Reserves capacity and creates task.
4. Streams and persists public events.
5. Runs the orchestrator with a task abort signal.
6. Performs final cancellation and base-version checks.
7. Applies through `applyAgentWorkspaceChange`.
8. Charges measured usage.
9. Conditionally marks done.
10. Commits memory.

- [ ] **Step 5: Remove the direct legacy server action**

Delete `editWorkspaceAction` or make it call the same route-independent
orchestrator service. It must not call `editWorkspace` plus
`store.updateWorkspace`.

- [ ] **Step 6: Verify and commit**

```powershell
pnpm test -- src/app/api/agent/route.test.ts src/lib/ai/orchestrator/run.test.ts
pnpm exec tsc --noEmit
git add src/app/api/agent/route.ts src/app/api/agent/route.test.ts src/lib/flags.ts src/app/app/actions.ts
git commit -m "feat: route workspace edits through the authentic agent"
```

---

### Task 19: Restore durable task state and cancellation through APIs

**Files:**
- Modify: `src/app/api/agent/task/[id]/route.ts`
- Modify: `src/app/api/agent/task/[id]/cancel/route.ts`
- Create: `src/app/api/agent/task/task-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Assert GET returns:

```json
{
  "status": "running",
  "phase": "updating",
  "events": [],
  "response": null,
  "expiresAt": "..."
}
```

Assert expired or foreign tasks return 404. Cancel is idempotent and reports
the resulting terminal status.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/app/api/agent/task/task-routes.test.ts
```

- [ ] **Step 3: Implement restore and cancel**

Return ordered persisted public events. Never return private observations,
candidate operations, selected tool arguments, or raw errors.

- [ ] **Step 4: Verify and commit**

```powershell
pnpm test -- src/app/api/agent/task/task-routes.test.ts
git add src/app/api/agent/task/[id]/route.ts src/app/api/agent/task/[id]/cancel/route.ts src/app/api/agent/task/task-routes.test.ts
git commit -m "feat: restore durable agent tasks"
```

---

### Task 20: Render declarative workspace layouts safely

**Files:**
- Create: `src/components/workspace/WorkspaceLayout.tsx`
- Create: `src/components/workspace/SafeWorkspaceComponent.tsx`
- Create: `src/components/workspace/WorkspaceLayout.test.tsx`
- Modify: `src/components/workspace/PageView.tsx`

- [ ] **Step 1: Write failing renderer tests**

Test:

- Legacy page renders through the existing block sequence.
- A three-column layout renders and applies responsive grid classes.
- Every approved component renders expected labels.
- Missing referenced data renders a safe empty state.
- Unknown components are impossible through types and rejected at runtime.
- Database view frames reuse `DatabaseView`.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/components/workspace/WorkspaceLayout.test.tsx
```

- [ ] **Step 3: Implement theme and section layout**

Map token values to static class dictionaries. Never construct arbitrary
Tailwind classes from persisted values. Use CSS grid with explicit supported
column maps and `grid-cols-1` mobile fallback.

- [ ] **Step 4: Implement the safe component switch**

Use an exhaustive TypeScript switch. Components read referenced workspace data
through props and cannot mutate or fetch.

- [ ] **Step 5: Integrate with PageView**

If `workspace.presentation?.pageLayouts[page.id]` exists, render
`WorkspaceLayout`; otherwise preserve the current renderer exactly.

- [ ] **Step 6: Verify and commit**

```powershell
pnpm test -- src/components/workspace/WorkspaceLayout.test.tsx
pnpm exec tsc --noEmit
git add src/components/workspace/WorkspaceLayout.tsx src/components/workspace/SafeWorkspaceComponent.tsx src/components/workspace/WorkspaceLayout.test.tsx src/components/workspace/PageView.tsx
git commit -m "feat: render agent-designed workspace layouts"
```

---

### Task 21: Persist active tasks and reconnect the chat

**Files:**
- Modify: `src/components/workspace/AgentChat.tsx`
- Create: `src/components/workspace/AgentChat.test.tsx`

- [ ] **Step 1: Write failing reconnect tests**

Test:

- Task ID is stored under `studyos:agent-task:<workspaceId>`.
- Mount restores a running task and replays events.
- Completed restore applies and renders exactly once.
- Expired/cancelled/failed restore clears storage.
- Closing the panel does not cancel.
- Explicit Cancel waits for the server response and then clears state.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/components/workspace/AgentChat.test.tsx
```

- [ ] **Step 3: Implement local active-task persistence**

Use a small helper:

```ts
const taskStorageKey = (workspaceId: string) =>
  `studyos:agent-task:${workspaceId}`;
```

Store only task ID, never workspace content or private observations.

- [ ] **Step 4: Replace four-attempt recovery**

On mount and stream failure, GET the task. While running, poll with bounded
backoff until completion, cancellation, expiry, panel unmount, or a new task.
Replay event IDs only once.

- [ ] **Step 5: Make cancellation authoritative**

Await the cancel route, abort the local stream, preserve the cancelled final
state, and clear storage only after the server confirms.

- [ ] **Step 6: Verify and commit**

```powershell
pnpm test -- src/components/workspace/AgentChat.test.tsx
git add src/components/workspace/AgentChat.tsx src/components/workspace/AgentChat.test.tsx
git commit -m "feat: reconnect to authentic agent tasks"
```

---

### Task 22: Show authentic action progress and research sources

**Files:**
- Modify: `src/components/workspace/AgentProgressCard.tsx`
- Modify: `src/components/workspace/AgentProgressCard.test.tsx`
- Modify: `src/components/workspace/AgentChat.tsx`
- Modify: `src/lib/ai/agent-shared.ts`
- Modify: `src/lib/i18n/dictionaries/en.ts`
- Modify: all other locale dictionaries

- [ ] **Step 1: Write failing UI tests**

Test:

- Completed action cards display safe translated action titles.
- Repeated event IDs do not duplicate.
- Source links render only from final response sources.
- Internal tool IDs, raw URLs with query parameters, JSON, and file paths never
  render.
- Progress stays monotonic after reconnect.

- [ ] **Step 2: Verify failure**

```powershell
pnpm test -- src/components/workspace/AgentProgressCard.test.tsx src/components/workspace/AgentChat.test.tsx
```

- [ ] **Step 3: Extend activity state**

Add bounded `actions` and `sources` to shared public types and the progress
reducer. Keep at most eight visible action cards.

- [ ] **Step 4: Render authentic progress**

Replace generic rotating discoveries with completed orchestration actions while
retaining the five-phase milestone list.

- [ ] **Step 5: Add localized copy**

Add rate-limit, reconnect, cancellation, research, validation, repair, layout,
memory, and partial-completion strings to English, then satisfy the dictionary
contract in all nine translations.

- [ ] **Step 6: Verify and commit**

```powershell
pnpm test -- src/components/workspace/AgentProgressCard.test.tsx src/components/workspace/AgentChat.test.tsx
pnpm exec tsc --noEmit
git add src/components/workspace/AgentProgressCard.tsx src/components/workspace/AgentProgressCard.test.tsx src/components/workspace/AgentChat.tsx src/lib/ai/agent-shared.ts src/lib/i18n/dictionaries
git commit -m "feat: show authentic agent activity"
```

---

### Task 23: Add end-to-end integration coverage

**Files:**
- Create: `src/lib/ai/orchestrator/authentic-agent.integration.test.ts`
- Extend route and version service tests as needed.

- [ ] **Step 1: Write integration scenarios**

Use a real registry and candidate with fake model transport. Cover:

1. Precise title edit.
2. Multi-area revision planner.
3. Dashboard theme, layout, and components.
4. Research notes with citations.
5. Invalid first candidate repaired before apply.
6. Cancellation during tool execution.
7. Cancellation immediately before apply.
8. Stale workspace conflict.
9. Cross-owner task and memory denial.
10. Failed validation leaves memory and persisted workspace unchanged.

- [ ] **Step 2: Verify tests fail before missing integration fixes**

```powershell
pnpm test -- src/lib/ai/orchestrator/authentic-agent.integration.test.ts
```

- [ ] **Step 3: Apply only minimal integration fixes**

Fix discovered contract mismatches in the owning modules. Every fix receives a
focused regression assertion in this test or the owning unit suite.

- [ ] **Step 4: Verify and commit**

```powershell
pnpm test -- src/lib/ai/orchestrator/authentic-agent.integration.test.ts
git add src/lib/ai/orchestrator/authentic-agent.integration.test.ts src/lib/ai src/lib/workspace src/app/api/agent
git commit -m "test: cover authentic agent workflows"
```

---

### Task 24: Full verification and browser acceptance

**Files:**
- Verify only unless a failing test requires a focused regression fix.

- [ ] **Step 1: Apply migrations to the configured database**

Run:

```powershell
pnpm prisma migrate deploy
pnpm prisma migrate status
```

Expected: all migrations applied and database up to date.

- [ ] **Step 2: Run all automated checks**

Run:

```powershell
pnpm test
pnpm run lint
pnpm exec tsc --noEmit
pnpm run build
node scripts/check-standalone-trace.mjs
pnpm audit --prod --registry=https://registry.npmjs.org
```

Expected: zero test failures, lint errors, type errors, build failures,
forbidden trace paths, or known production dependency vulnerabilities.

- [ ] **Step 3: Start the app**

Run:

```powershell
pnpm dev
```

Expected: Next.js starts with no Prisma or route errors.

- [ ] **Step 4: Verify public and auth boundaries**

Check landing, pricing, sign-in, protected redirects, unauthenticated API
rejection, and absence of framework overlays.

- [ ] **Step 5: Verify authenticated precise edit**

Ask: “Rename the dashboard heading to Weekly Focus.”

Expected: real inspection/action/validation progress, minimal change, automatic
apply, and Undo.

- [ ] **Step 6: Verify broad dashboard design**

Ask: “Redesign this dashboard so I can scan priorities, deadlines, and course
progress quickly on desktop and mobile.”

Expected: declarative theme/layout/components, coordinated references,
responsive rendering, validation actions, and no raw code.

- [ ] **Step 7: Verify study planner**

Ask for a revision plan spanning existing exams and assignments.

Expected: coordinated page/database/view changes and no invented confirmed
facts.

- [ ] **Step 8: Verify research**

Ask for allowlisted source-backed research.

Expected: bounded source links in the final result, no prompt-injection behavior,
and no external writes.

- [ ] **Step 9: Verify cancellation, reconnect, conflict, and Undo**

Run each acceptance case from the design:

- Cancel during work: no apply.
- Close/reopen: task restores.
- Manual concurrent save: agent reports conflict.
- Undo: exact prior version returns.

- [ ] **Step 10: Verify responsive and localized presentation**

Check desktop, tablet, mobile, light/dark, English, German, and Arabic. Verify
RTL layout and no text overflow.

- [ ] **Step 11: Record final evidence**

Update the implementation plan checkboxes and add a short verification note
containing command outputs, browser scenarios, known limitations, and the fact
that Cloud Run shell/package execution remains disabled for milestone two.

## Completion gate

Milestone one is complete only when:

- The live authenticated route uses the registered tools and skills.
- At least one integration test proves observation-driven repair.
- Tool timeouts and parent cancellation are enforced.
- Cancelled tasks cannot transition to done or apply.
- Active tasks reconnect after chat close or page navigation.
- Semantic references and declarative components cannot persist invalid state.
- Broad visual requests can create safe responsive layouts.
- Research remains allowlisted, read-only, bounded, and source-linked.
- Existing workspaces remain compatible.
- Legacy direct AI overwrite is removed.
- Tests, lint, type checking, migration status, build, trace check, dependency
  audit, and browser acceptance all pass.
