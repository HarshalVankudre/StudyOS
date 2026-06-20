# Agent Upgrade — Stage 1 (Real Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the StudyOS workspace agent's fixed two-call "plan→edit" form-filler with a real, bounded tool-using loop that inspects, acts, observes, repairs, and applies one atomic change — driven by tiered free/pro models, emitting evidence-based progress, and surviving a disconnect via durable per-task event persistence — all behind the `AUTHENTIC_AGENT` flag with the old agent as fallback.

**Architecture:** A new server-only orchestrator (`agent-loop.ts`) drives a JSON-action loop over the existing (today dormant) `toolRegistry`/`skillRegistry`. The model returns one JSON object per turn — either a tool call or a final answer — which we parse with the existing `extractJson` and dispatch through `toolRegistry.run()`; we deliberately keep OpenRouter's plain string-in/string-out shape (no native tool-calling) so GLM's unproven tool-call formatting can't break the loop, and add a bounded repair retry instead. The orchestrator owns an in-memory **candidate** `Workspace`; only `apply_ops` mutates it, and only the route applies the validated candidate atomically (reusing `applyAgentWorkspaceChange` + Undo). Progress is emitted from real loop events (the already-defined-but-unused `plan`/`area` stream variants plus tool `toProgress` discoveries) and persisted to the `AgentTask` row so a reconnect replays it.

**Tech Stack:** TypeScript, Next.js (modified — see Global Constraints), React 19, Zod, Prisma (PostgreSQL/Neon), OpenRouter (GLM 5.2 today), Vitest (jsdom), pnpm.

## Global Constraints

- **This is a modified Next.js** (`AGENTS.md`): before changing any route/stream shape, read `node_modules/next/dist/docs/`. Do not assume stock App Router behavior.
- **Migrate-before-push (critical):** the Cloud Run deploy pipeline runs **no** migrations, and local `.env` points at the **production** Neon DB. Apply schema changes with `pnpm prisma migrate deploy` **before** pushing to `main`. Keep migrations additive/backward-compatible so the running revision survives the deploy window.
- **First migrate needs a baseline reconcile** (DB was bootstrapped with `db push`, has no `_prisma_migrations` history): `pnpm prisma migrate resolve --applied 20260619000000_postgres_baseline` then `pnpm prisma migrate deploy`.
- **Tests:** Vitest has **no `globals`** — every test file must `import { describe, expect, it, vi } from "vitest"`. Config is `vitest.config.mts`. `server-only` is aliased to a stub. Server modules mock with `const mocks = vi.hoisted(() => ({...}))` + `vi.mock(...)`, importing the module-under-test **after** the `vi.mock` calls.
- **Commands:** test = `pnpm test` (`vitest run`); single file = `pnpm exec vitest run <path>`; lint = `pnpm lint`; typecheck = `pnpm exec tsc --noEmit` (no script); build = `pnpm build` (`prisma generate && next build --webpack`). There is **no** `pnpm typecheck`/`pnpm migrate` — call the Prisma CLI directly.
- **Prisma client output is custom:** `src/generated/prisma` (import from there, not `@prisma/client`). Two URLs: `DATABASE_URL` (pooled/runtime), `DATABASE_URL_UNPOOLED` (direct/migrations).
- **Any new `dict.*` key must be added to all 10 dictionaries** under `src/lib/i18n/dictionaries/` (`en, de, es, fr, it, ja, nl, pt, zh, ar`) or the typed dictionary breaks the build.
- **Security invariants (carry from the spec):** the model proposes, trusted code executes; tool inputs/outputs are Zod-validated at the registry boundary; raw model planner text and tool arguments are **never** rendered to the user (only sanitized `toProgress` titles + `affectedAreas` labels); the cancelled-task guard (`isTaskCancelled`) **must** run immediately before any apply; every task/workspace read stays owner-scoped.
- **Reuse, don't duplicate:** the op vocabulary (`agentOpsSchema`/`applyAgentOps` in `agent-ops.ts`), `AGENT_LIMITS`, `workspaceAreas`, `extractJson`/`WORKSPACE_SHAPE`, `chatCompletion`, the registries, and `AgentStreamEvent` already exist — import them.

---

## Scope of Stage 1

**In:** the loop engine; `apply_ops`/`find_entities`/`read_area`/`summarize_workspace` tools; `precise-edit`/`study-planner`/`quality-reviewer` skills; tiered budgets + `STUDYOS_PRO_MODEL` seam + temperature + bounded repair; real `plan`/`area`/evidence-`discovery` progress; durable event persistence + reconnect replay; route integration behind `AUTHENTIC_AGENT`.

**Deferred to later stages (note, don't build here):** token-by-token reply streaming (the loop streams real progress instead; reply still arrives in the `result` event); runtime-personalized suggestion chips; `read_web_source`/research + memory (Stage 2); flashcards/grades (Stage 3); integrations (Stage 4); declarative presentation tools; the paid OS sandbox.

**Background-execution decision (resolves spec §13 item 3):** Stage 1 runs the loop inside the streaming request and **persists every progress event + the final result to the `AgentTask` row**; reconnect replays them. This gives "survives a refresh / reconnect" with **no new paid infra**, riding Cloud Run's `--timeout=600` (well beyond the 180s Pro budget) and `--min-instances=1`. A detached worker that keeps computing after the *server request* is killed (only relevant on Vercel's short cap) is a later refinement, not Stage 1.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `src/lib/flags.ts` | Modify | Add `AUTHENTIC_AGENT` flag reader |
| `src/lib/ai/budgets.ts` | Create | `AgentBudget` per plan (wall time, model turns, tool calls, repairs) |
| `src/lib/ai/tools/workspace-tools.ts` | Create | Register `apply_ops`, `find_entities`, `read_area`, `summarize_workspace` |
| `src/lib/ai/skills/catalog.ts` | Create | Register `precise-edit`, `study-planner`, `quality-reviewer` skills |
| `src/lib/ai/openrouter.ts` | Modify | Add optional `temperature` to `chatCompletion` |
| `src/lib/ai/agent-loop.ts` | Create | The orchestrator: protocol schemas + `runAgentLoop()` |
| `src/lib/ai/progress.ts` | Modify | Reduce `plan`/`area` events into activity state |
| `prisma/schema.prisma` | Modify | `AgentTask.events String?` column |
| `src/lib/ai/tasks/store.ts` | Modify | `appendTaskEvent`, conditional `markTaskDone`, `getTask` returns events |
| `src/app/api/agent/route.ts` | Modify | Drive `runAgentLoop` behind the flag; persist events; keep old path as fallback |
| `src/app/api/agent/task/[id]/route.ts` | Modify | Reconnect GET returns `{ status, response, events }` |
| `src/components/workspace/AgentChat.tsx` | Modify | Handle `plan`/`area` events; replay persisted events on reconnect |
| `src/lib/i18n/dictionaries/*.ts` | Modify | New `agentChat` phase/label strings used by the loop |

---

## Task 1: `AUTHENTIC_AGENT` flag + agent budgets

**Files:**
- Modify: `src/lib/flags.ts`
- Create: `src/lib/ai/budgets.ts`
- Test: `src/lib/ai/budgets.test.ts`

**Interfaces:**
- Produces: `isAuthenticAgentEnabled(): boolean`; `interface AgentBudget { wallTimeMs: number; maxModelTurns: number; maxToolCalls: number; maxRepairs: number }`; `budgetForPlan(plan: Plan): AgentBudget`.

- [ ] **Step 1: Read the current flags file** to match its exact style.

Run: `pnpm exec cat src/lib/flags.ts` (or open it). Mirror how `AGENT_SANDBOX` is read (env → boolean).

- [ ] **Step 2: Write the failing budgets test**

```ts
// src/lib/ai/budgets.test.ts
import { describe, expect, it } from "vitest";
import { budgetForPlan } from "./budgets";

describe("agent budgets", () => {
  it("gives pro a larger envelope than free", () => {
    const free = budgetForPlan("free");
    const pro = budgetForPlan("pro");
    expect(free.maxModelTurns).toBe(8);
    expect(free.maxToolCalls).toBe(12);
    expect(free.wallTimeMs).toBe(90_000);
    expect(pro.maxModelTurns).toBe(14);
    expect(pro.maxToolCalls).toBe(24);
    expect(pro.wallTimeMs).toBe(180_000);
    expect(free.maxRepairs).toBe(2);
    expect(pro.maxRepairs).toBe(2);
  });
});
```

- [ ] **Step 3: Run it, expect failure** — `pnpm exec vitest run src/lib/ai/budgets.test.ts` → FAIL (`budgetForPlan` not found).

- [ ] **Step 4: Implement `budgets.ts`**

```ts
// src/lib/ai/budgets.ts
import type { Plan } from "./plans";

/** Server-owned, plan-aware limits for one agent turn's tool-loop. */
export interface AgentBudget {
  /** Hard wall-clock ceiling for the whole turn. */
  wallTimeMs: number;
  /** Max model calls (planner + each loop step). */
  maxModelTurns: number;
  /** Max successful + attempted tool dispatches. */
  maxToolCalls: number;
  /** Max times a failed validation/apply may be retried with a corrective message. */
  maxRepairs: number;
}

const BUDGETS: Record<Plan, AgentBudget> = {
  free: { wallTimeMs: 90_000, maxModelTurns: 8, maxToolCalls: 12, maxRepairs: 2 },
  pro: { wallTimeMs: 180_000, maxModelTurns: 14, maxToolCalls: 24, maxRepairs: 2 },
};

export function budgetForPlan(plan: Plan): AgentBudget {
  return BUDGETS[plan];
}
```

- [ ] **Step 5: Add the flag to `src/lib/flags.ts`** (match the existing `AGENT_SANDBOX` pattern):

```ts
/** Stage-1 tool-loop agent. Off = legacy two-call planner/editor. */
export function isAuthenticAgentEnabled(): boolean {
  return process.env.AUTHENTIC_AGENT === "1" || process.env.AUTHENTIC_AGENT === "true";
}
```

- [ ] **Step 6: Run tests** — `pnpm exec vitest run src/lib/ai/budgets.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/budgets.ts src/lib/ai/budgets.test.ts src/lib/flags.ts
git commit -m "feat(agent): add AUTHENTIC_AGENT flag and tiered agent budgets"
```

---

## Task 2: Workspace tools (`apply_ops`, `find_entities`, `read_area`, `summarize_workspace`)

**Files:**
- Create: `src/lib/ai/tools/workspace-tools.ts`
- Test: `src/lib/ai/tools/workspace-tools.test.ts`

**Interfaces:**
- Consumes: `ToolRegistry`, `toolRegistry`, `ToolContext` (`registry.ts`); `agentOpsSchema`, `applyAgentOps` (`agent-ops.ts`); `safeParseWorkspace` (`@/lib/workspace/schema`).
- Produces: `registerWorkspaceTools(registry?: ToolRegistry): void` (also self-invoked on import), registering four enabled `networkPermission: "none"` tools:
  - `apply_ops` — input `{ ops: agentOpsSchema }`, output `{ ok: boolean; opCount: number; error?: string }`. Dry-validates ops against the snapshot; the **orchestrator** folds the ops into the candidate on `ok`.
  - `find_entities` — input `{ query: string }`, output `{ matches: { id: string; type: "page"|"database"|"row"; label: string }[] }`.
  - `read_area` — input `{ id: string }`, output `{ kind: "page"|"database"|"none"; json: string }` (bounded slice, JSON string).
  - `summarize_workspace` — input `{}`, output `{ summary: string }` (compact counts + names).

- [ ] **Step 1: Write the failing test** (mirror `tools/registry.test.ts` style — direct import, no mocks; build a tiny workspace JSON for `ctx.workspaceJson`):

```ts
// src/lib/ai/tools/workspace-tools.test.ts
import { describe, expect, it } from "vitest";
import { createToolRegistry, type ToolContext } from "./registry";
import { registerWorkspaceTools } from "./workspace-tools";

const WS = JSON.stringify({
  id: "ws1", name: "My Studies",
  databases: [{ id: "db1", name: "Courses", properties: [], rows: [{ id: "r1", cells: {} }], views: [] }],
  pages: [{ id: "p1", title: "Home", blocks: [] }],
});
const ctx: ToolContext = { taskId: "t1", workspaceJson: WS };

function reg() {
  const r = createToolRegistry();
  registerWorkspaceTools(r);
  return r;
}

describe("workspace tools", () => {
  it("summarize_workspace returns counts", async () => {
    const out = (await reg().run("summarize_workspace", {}, ctx)) as { summary: string };
    expect(out.summary).toContain("1 database");
    expect(out.summary).toContain("1 page");
  });

  it("find_entities matches by label substring", async () => {
    const out = (await reg().run("find_entities", { query: "cours" }, ctx)) as {
      matches: { id: string }[];
    };
    expect(out.matches.some((m) => m.id === "db1")).toBe(true);
  });

  it("read_area returns the page json", async () => {
    const out = (await reg().run("read_area", { id: "p1" }, ctx)) as {
      kind: string; json: string;
    };
    expect(out.kind).toBe("page");
    expect(out.json).toContain("Home");
  });

  it("apply_ops validates a good op and rejects a bad one", async () => {
    const good = (await reg().run(
      "apply_ops",
      { ops: [{ op: "update_page", pageId: "p1", title: "Renamed" }] },
      ctx,
    )) as { ok: boolean; opCount: number };
    expect(good.ok).toBe(true);
    expect(good.opCount).toBe(1);

    const bad = (await reg().run(
      "apply_ops",
      { ops: [{ op: "update_page", pageId: "missing", title: "x" }] },
      ctx,
    )) as { ok: boolean; error?: string };
    expect(bad.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect failure** — `pnpm exec vitest run src/lib/ai/tools/workspace-tools.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `workspace-tools.ts`**

```ts
// src/lib/ai/tools/workspace-tools.ts
import "server-only";
import { z } from "zod";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { applyAgentOps, agentOpsSchema } from "@/lib/ai/agent-ops";
import { toolRegistry, type ToolRegistry } from "./registry";

function parseSnapshot(json?: string) {
  if (!json) throw new Error("no workspace snapshot");
  const parsed = safeParseWorkspace(JSON.parse(json));
  if (!parsed.success) throw new Error("invalid workspace snapshot");
  return parsed.data;
}

export function registerWorkspaceTools(registry: ToolRegistry = toolRegistry): void {
  registry.register({
    id: "summarize_workspace",
    description:
      "Return a compact, plain-language summary of the workspace: page and database counts and their names. Call this first to orient.",
    input: z.object({}),
    output: z.object({ summary: z.string() }),
    limits: { timeoutMs: 5_000 },
    networkPermission: "none",
    handler: (_input, ctx) => {
      const ws = parseSnapshot(ctx.workspaceJson);
      const dbNames = ws.databases.map((d) => d.name).join(", ") || "none";
      const pageNames = ws.pages.map((p) => p.title).join(", ") || "none";
      return {
        summary:
          `${ws.databases.length} database(s): ${dbNames}. ` +
          `${ws.pages.length} page(s): ${pageNames}.`,
      };
    },
    toProgress: (_input, output) => ({ title: "Reviewed the whole workspace", detail: output.summary }),
  });

  registry.register({
    id: "find_entities",
    description:
      "Search pages, databases, and rows by a case-insensitive substring of their visible label/title/name. Use to locate ids before editing.",
    input: z.object({ query: z.string().min(1).max(200) }),
    output: z.object({
      matches: z.array(
        z.object({
          id: z.string(),
          type: z.enum(["page", "database", "row"]),
          label: z.string(),
        }),
      ),
    }),
    limits: { timeoutMs: 5_000 },
    networkPermission: "none",
    handler: (input, ctx) => {
      const ws = parseSnapshot(ctx.workspaceJson);
      const q = input.query.toLowerCase();
      const matches: { id: string; type: "page" | "database" | "row"; label: string }[] = [];
      for (const p of ws.pages) {
        if (p.title.toLowerCase().includes(q)) matches.push({ id: p.id, type: "page", label: p.title });
      }
      for (const d of ws.databases) {
        if (d.name.toLowerCase().includes(q)) matches.push({ id: d.id, type: "database", label: d.name });
        for (const r of d.rows) {
          const text = JSON.stringify(r.cells).toLowerCase();
          if (text.includes(q)) matches.push({ id: r.id, type: "row", label: `${d.name} row` });
        }
      }
      return { matches: matches.slice(0, 50) };
    },
  });

  registry.register({
    id: "read_area",
    description:
      "Return the full JSON of one page or database by id, so you can see its exact current contents before changing it.",
    input: z.object({ id: z.string().min(1).max(100) }),
    output: z.object({ kind: z.enum(["page", "database", "none"]), json: z.string() }),
    limits: { timeoutMs: 5_000 },
    networkPermission: "none",
    handler: (input, ctx) => {
      const ws = parseSnapshot(ctx.workspaceJson);
      const page = ws.pages.find((p) => p.id === input.id);
      if (page) return { kind: "page" as const, json: JSON.stringify(page) };
      const db = ws.databases.find((d) => d.id === input.id);
      if (db) return { kind: "database" as const, json: JSON.stringify(db) };
      return { kind: "none" as const, json: "{}" };
    },
  });

  registry.register({
    id: "apply_ops",
    description:
      "Validate a list of patch operations against the current workspace. Returns ok:true if they yield a valid workspace (the change is then staged), or ok:false with an error so you can fix and retry. Emit the SMALLEST set of operations; never resend unchanged data.",
    input: z.object({ ops: agentOpsSchema }),
    output: z.object({ ok: z.boolean(), opCount: z.number().int(), error: z.string().optional() }),
    limits: { timeoutMs: 10_000 },
    networkPermission: "none",
    handler: (input, ctx) => {
      const ws = parseSnapshot(ctx.workspaceJson);
      try {
        const parsed = safeParseWorkspace(applyAgentOps(ws, input.ops));
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          return { ok: false, opCount: input.ops.length, error: issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "schema" };
        }
        return { ok: true, opCount: input.ops.length };
      } catch (error) {
        return { ok: false, opCount: input.ops.length, error: error instanceof Error ? error.message : "apply failed" };
      }
    },
    toProgress: (input, output) =>
      output.ok ? { title: `Staged ${output.opCount} change(s)` } : { title: "Reworking an invalid change" },
  });
}

registerWorkspaceTools();
```

- [ ] **Step 4: Run tests** → `pnpm exec vitest run src/lib/ai/tools/workspace-tools.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tools/workspace-tools.ts src/lib/ai/tools/workspace-tools.test.ts
git commit -m "feat(agent): add inspect/find/read/apply workspace tools"
```

---

## Task 3: Stage-1 skill catalog

**Files:**
- Create: `src/lib/ai/skills/catalog.ts`
- Test: `src/lib/ai/skills/catalog.test.ts`

**Interfaces:**
- Consumes: `skillRegistry`, `SkillRegistry`, `createSkillRegistry` (`skills/registry.ts`); the tools from Tasks 2 + builtin.
- Produces: `registerStage1Skills(registry?: SkillRegistry): void` (self-invoked on import) registering `precise-edit`, `study-planner`, `quality-reviewer`. **Import order matters:** this module must import `../tools/builtin` and `../tools/workspace-tools` first so the referenced tools exist (the registry containment check throws otherwise).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/skills/catalog.test.ts
import { describe, expect, it } from "vitest";
import { skillRegistry } from "./registry";
import "./catalog";

describe("stage 1 skills", () => {
  it("registers precise-edit, study-planner, quality-reviewer with valid tool sets", () => {
    for (const id of ["precise-edit", "study-planner", "quality-reviewer"]) {
      const skill = skillRegistry.get(id);
      expect(skill, id).toBeDefined();
      expect(skill!.toolIds.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it, expect failure** → FAIL (skills not registered).

- [ ] **Step 3: Implement `catalog.ts`** (registration throws at import if a toolId is missing/disabled — that is the safety check):

```ts
// src/lib/ai/skills/catalog.ts
import "../tools/builtin";          // inspect_workspace, validate_ops, controlled_fetch
import "../tools/workspace-tools";  // summarize_workspace, find_entities, read_area, apply_ops
import { skillRegistry, type SkillRegistry } from "./registry";

const INSPECT = ["summarize_workspace", "find_entities", "read_area", "inspect_workspace"];

export function registerStage1Skills(registry: SkillRegistry = skillRegistry): void {
  registry.register({
    id: "precise-edit",
    version: "1.0.0",
    instructions:
      "Make the smallest correct change. Locate the exact target with find_entities/read_area, then call apply_ops with the minimal operations. Never touch unrelated areas. Reuse existing ids exactly.",
    toolIds: [...INSPECT, "apply_ops"],
  });

  registry.register({
    id: "study-planner",
    version: "1.0.0",
    instructions:
      "Build or update study/revision/exam/assignment plans. Inspect existing courses, deadlines, and trackers first; coordinate changes across the relevant databases and pages; express each as a minimal apply_ops operation. Keep dates ISO and leave unknown facts as TBD.",
    toolIds: [...INSPECT, "apply_ops"],
  });

  registry.register({
    id: "quality-reviewer",
    version: "1.0.0",
    instructions:
      "Final review for any change. Re-inspect the staged result, confirm references resolve and nothing unrelated changed, and either confirm or request one more apply_ops fix. Mandatory before finishing a mutating turn.",
    toolIds: [...INSPECT, "apply_ops"],
  });
}

registerStage1Skills();
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/skills/catalog.ts src/lib/ai/skills/catalog.test.ts
git commit -m "feat(agent): register precise-edit, study-planner, quality-reviewer skills"
```

---

## Task 4: Add `temperature` to the model call

**Files:**
- Modify: `src/lib/ai/openrouter.ts`
- Test: `src/lib/ai/openrouter.test.ts` (create)

**Interfaces:**
- Produces: `chatCompletion(model, messages, maxTokens?, options?: { temperature?: number }): Promise<string>` — backward compatible (extra optional arg). When `options.temperature` is set, include it in the request body.

- [ ] **Step 1: Write the failing test** (mock `fetch`; assert the body carries `temperature` when passed):

```ts
// src/lib/ai/openrouter.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion } from "./openrouter";

function mockOk(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("chatCompletion", () => {
  it("includes temperature in the body when provided", async () => {
    const fetchMock = mockOk("hi");
    vi.stubGlobal("fetch", fetchMock);
    await chatCompletion("m", [{ role: "user", content: "x" }], 100, { temperature: 0.4 });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.4);
  });

  it("omits temperature when not provided", async () => {
    const fetchMock = mockOk("hi");
    vi.stubGlobal("fetch", fetchMock);
    await chatCompletion("m", [{ role: "user", content: "x" }], 100);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect("temperature" in body).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect failure** → `pnpm exec vitest run src/lib/ai/openrouter.test.ts` → FAIL (temperature not sent).

- [ ] **Step 3: Edit `chatCompletion`** — change the signature and body assembly:

```ts
export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  maxTokens = 7000,
  options?: { temperature?: number },
): Promise<string> {
  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages };
  if (typeof options?.temperature === "number") body.temperature = options.temperature;
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://studyos.app",
      "X-Title": "StudyOS",
    },
    body: JSON.stringify(body),
  });
  // ... rest of the function unchanged (res.ok check, recordUsage, finish_reason handling) ...
```

- [ ] **Step 4: Run tests** → `pnpm exec vitest run src/lib/ai/openrouter.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/openrouter.ts src/lib/ai/openrouter.test.ts
git commit -m "feat(agent): allow optional temperature on chatCompletion"
```

---

## Task 5: Agent protocol schemas + parser

**Files:**
- Create: `src/lib/ai/agent-protocol.ts`
- Test: `src/lib/ai/agent-protocol.test.ts`

**Interfaces:**
- Consumes: `extractJson` (`./generate`), `AgentChoice` (`./agent-shared`).
- Produces:
  - `agentPlanSchema` / `AgentPlanDecision` = `{ action: "reply"; reply } | { action: "clarify"; reply; choices } | { action: "execute"; skillId; summary; affectedAreaIds: string[] }`.
  - `agentStepSchema` / `AgentStep` = `{ action: "tool"; tool: string; input: unknown } | { action: "final"; reply: string }`.
  - `parseAgentPlan(raw: string): AgentPlanDecision` and `parseAgentStep(raw: string): AgentStep` — both `extractJson` then `safeParse`, throwing a descriptive error on failure (the orchestrator catches and triggers a repair).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/agent-protocol.test.ts
import { describe, expect, it } from "vitest";
import { parseAgentPlan, parseAgentStep } from "./agent-protocol";

describe("agent protocol", () => {
  it("parses an execute plan", () => {
    const p = parseAgentPlan('{"action":"execute","skillId":"precise-edit","summary":"Rename page","affectedAreaIds":["p1"]}');
    expect(p.action).toBe("execute");
  });
  it("parses a reply plan", () => {
    const p = parseAgentPlan('{"action":"reply","reply":"Hello"}');
    expect(p.action === "reply" && p.reply).toBe("Hello");
  });
  it("parses a tool step (fenced)", () => {
    const s = parseAgentStep('```json\n{"action":"tool","tool":"find_entities","input":{"query":"x"}}\n```');
    expect(s.action === "tool" && s.tool).toBe("find_entities");
  });
  it("parses a final step", () => {
    const s = parseAgentStep('{"action":"final","reply":"Done."}');
    expect(s.action).toBe("final");
  });
  it("throws on malformed json", () => {
    expect(() => parseAgentStep("not json")).toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect failure** → FAIL.

- [ ] **Step 3: Implement `agent-protocol.ts`**

```ts
// src/lib/ai/agent-protocol.ts
import { z } from "zod";
import { extractJson } from "./generate";
import type { AgentChoice } from "./agent-shared";

export const agentPlanSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), reply: z.string().min(1) }),
  z.object({
    action: z.literal("clarify"),
    reply: z.string().min(1),
    choices: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1).max(80), value: z.string().min(1).max(300) }))
      .min(2)
      .max(4),
  }),
  z.object({
    action: z.literal("execute"),
    skillId: z.string().min(1),
    summary: z.string().min(1).max(400),
    affectedAreaIds: z.array(z.string()).default([]),
  }),
]);

export type AgentPlanDecision =
  | { action: "reply"; reply: string }
  | { action: "clarify"; reply: string; choices: AgentChoice[] }
  | { action: "execute"; skillId: string; summary: string; affectedAreaIds: string[] };

export const agentStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tool"), tool: z.string().min(1), input: z.unknown() }),
  z.object({ action: z.literal("final"), reply: z.string().min(1) }),
]);

export type AgentStep =
  | { action: "tool"; tool: string; input: unknown }
  | { action: "final"; reply: string };

export function parseAgentPlan(raw: string): AgentPlanDecision {
  const parsed = agentPlanSchema.safeParse(extractJson(raw));
  if (!parsed.success) throw new Error(`invalid plan JSON: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  return parsed.data as AgentPlanDecision;
}

export function parseAgentStep(raw: string): AgentStep {
  const parsed = agentStepSchema.safeParse(extractJson(raw));
  if (!parsed.success) throw new Error(`invalid step JSON: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  return parsed.data as AgentStep;
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/agent-protocol.ts src/lib/ai/agent-protocol.test.ts
git commit -m "feat(agent): add JSON-action plan/step protocol parser"
```

---

## Task 6: The orchestrator loop (`runAgentLoop`)

**Files:**
- Create: `src/lib/ai/agent-loop.ts`
- Test: `src/lib/ai/agent-loop.test.ts`

**Interfaces:**
- Consumes: everything above + `chatCompletion` (`./openrouter`), `toolRegistry` (`./tools/registry`), `skillRegistry` + `./skills/catalog`, `workspaceAreas` (`./agent`), `applyAgentOps`, `agentOpsSchema` (`./agent-ops`), `safeParseWorkspace`, `AGENT_LIMITS`/`assertResultWithinLimits` (`./limits`), `AgentBudget` (`./budgets`), `AgentStreamEvent`/`AgentResponse`/`AgentArea`/`AgentMessage` (`./agent-shared`), `Workspace`, `Locale`.
- Produces:
```ts
export interface RunAgentLoopParams {
  workspace: Workspace;        // the base/candidate start
  history: AgentMessage[];
  message: string;
  model: string;
  budget: AgentBudget;
  locale: Locale;
  taskId: string;
  emit: (event: AgentStreamEvent) => void | Promise<void>;
  now?: () => number;          // injectable clock for tests (default Date.now)
}
export async function runAgentLoop(params: RunAgentLoopParams): Promise<AgentResponse>;
```
`AgentResponse` here is returned **without** `changeId`/applied workspace persistence — it carries `workspace` (the validated candidate) when `changed`. The route applies it.

- [ ] **Step 1: Write failing tests** — mock `chatCompletion` to script a plan then a tool call then a final; assert the candidate gets mutated and `changed` is true. (Mock at the module boundary.)

```ts
// src/lib/ai/agent-loop.test.ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("./openrouter", () => ({ chatCompletion: mocks.chat }));

import { runAgentLoop } from "./agent-loop";
import type { AgentStreamEvent } from "./agent-shared";

const WS = {
  id: "ws1", name: "S",
  databases: [],
  pages: [{ id: "p1", title: "Home", blocks: [] }],
} as never;

const budget = { wallTimeMs: 90_000, maxModelTurns: 8, maxToolCalls: 12, maxRepairs: 2 };

function run(scripts: string[]) {
  mocks.chat.mockReset();
  for (const s of scripts) mocks.chat.mockResolvedValueOnce(s);
  const events: AgentStreamEvent[] = [];
  return runAgentLoop({
    workspace: WS, history: [], message: "rename home to Dashboard",
    model: "m", budget, locale: "en", taskId: "t1",
    emit: (e) => { events.push(e); },
    now: () => 0,
  }).then((res) => ({ res, events }));
}

describe("runAgentLoop", () => {
  it("returns a plain reply without changing the workspace", async () => {
    const { res } = await run(['{"action":"reply","reply":"Hi there"}']);
    expect(res.changed).toBe(false);
    expect(res.reply).toBe("Hi there");
  });

  it("executes a skill, applies ops, and reports changed", async () => {
    const { res, events } = await run([
      '{"action":"execute","skillId":"precise-edit","summary":"Rename","affectedAreaIds":["p1"]}',
      '{"action":"tool","tool":"apply_ops","input":{"ops":[{"op":"update_page","pageId":"p1","title":"Dashboard"}]}}',
      '{"action":"final","reply":"Renamed the page."}',
    ]);
    expect(res.changed).toBe(true);
    expect(res.workspace?.pages[0].title).toBe("Dashboard");
    expect(events.some((e) => e.type === "plan")).toBe(true);
  });

  it("asks a clarifying question", async () => {
    const { res } = await run([
      '{"action":"clarify","reply":"Which page?","choices":[{"id":"a","label":"Home","value":"the home page"},{"id":"b","label":"Notes","value":"the notes page"}]}',
    ]);
    expect(res.choices?.length).toBe(2);
    expect(res.changed).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect failure** → FAIL (module missing).

- [ ] **Step 3: Implement `agent-loop.ts`**

```ts
// src/lib/ai/agent-loop.ts
import "server-only";
import { z } from "zod";
import type { Workspace } from "@/lib/workspace/types";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { chatCompletion } from "./openrouter";
import { extractJson, WORKSPACE_SHAPE, languageDirective } from "./generate";
import { applyAgentOps, agentOpsSchema, type AgentOp } from "./agent-ops";
import { assertResultWithinLimits } from "./limits";
import { toolRegistry } from "./tools/registry";
import { skillRegistry } from "./skills/registry";
import "./skills/catalog"; // ensure Stage-1 skills + their tools are registered
import { workspaceAreas } from "./agent";
import type { AgentBudget } from "./budgets";
import {
  parseAgentPlan,
  parseAgentStep,
  type AgentPlanDecision,
} from "./agent-protocol";
import type {
  AgentArea,
  AgentMessage,
  AgentResponse,
  AgentStreamEvent,
  ChatMessageRole,
} from "./agent-shared";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ChatMessage } from "./openrouter";

const MAX_HISTORY = 8;

export interface RunAgentLoopParams {
  workspace: Workspace;
  history: AgentMessage[];
  message: string;
  model: string;
  budget: AgentBudget;
  locale: Locale;
  taskId: string;
  emit: (event: AgentStreamEvent) => void | Promise<void>;
  now?: () => number;
}

/** Per-tool, plain-language hint about the input JSON, injected into the loop prompt. */
const TOOL_INPUT_HINTS: Record<string, string> = {
  summarize_workspace: "{}",
  find_entities: '{"query":"<substring>"}',
  read_area: '{"id":"<page or database id>"}',
  inspect_workspace: "{}",
  apply_ops:
    '{"ops":[ <minimal operations; same vocabulary as the editor> ]}  // e.g. {"op":"update_page","pageId":"<id>","title":"<new>"}',
};

export async function runAgentLoop(params: RunAgentLoopParams): Promise<AgentResponse> {
  const { workspace, history, message, model, budget, taskId } = params;
  const locale = params.locale ?? DEFAULT_LOCALE;
  const now = params.now ?? (() => Date.now());
  const emit = params.emit;
  const deadline = now() + budget.wallTimeMs;
  const areas = workspaceAreas(workspace);

  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

  let modelTurns = 0;
  const overBudget = () =>
    now() >= deadline || modelTurns >= budget.maxModelTurns;

  // ---- Plan ----------------------------------------------------------
  await emit({ type: "phase", phase: "planning", message: getDictionary(locale).agentChat.phase.planning, progress: 18 });
  modelTurns += 1;
  const planRaw = await chatCompletion(model, buildPlanMessages(workspace, history, message, areas, locale), 1400, { temperature: 0.2 });
  let plan: AgentPlanDecision;
  try {
    plan = parseAgentPlan(planRaw);
  } catch {
    // one bounded repair
    modelTurns += 1;
    const retry = await chatCompletion(model, buildPlanMessages(workspace, history, message, areas, locale, true), 1400, { temperature: 0 });
    plan = parseAgentPlan(retry);
  }

  if (plan.action === "reply") return { reply: plan.reply, changed: false };
  if (plan.action === "clarify") return { reply: plan.reply, changed: false, choices: plan.choices };

  // ---- Execute ----
  const skill = skillRegistry.get(plan.skillId) ?? skillRegistry.get("precise-edit");
  if (!skill) throw new Error("no skill available");
  const affectedAreas = resolveAreas(plan.affectedAreaIds, areas);
  await emit({ type: "plan", summary: skill ? "Coordinating your change" : "Working", areas: affectedAreas });
  for (const area of affectedAreas) await emit({ type: "area", areaId: area.id, status: "queued", progress: 35 });

  let candidate = workspace;
  let changed = false;
  let toolCalls = 0;
  let repairs = 0;
  const observations: ChatMessage[] = [];
  const allowedTools = skill.toolIds.filter((id) => toolRegistry.has(id));

  await emit({ type: "phase", phase: "updating", message: getDictionary(locale).agentChat.phase.updating, progress: 40 });

  let finalReply = getDictionary(locale).ai.agent.fallbackReply;
  while (!overBudget() && toolCalls < budget.maxToolCalls) {
    modelTurns += 1;
    const stepRaw = await chatCompletion(
      model,
      buildStepMessages(candidate, message, skill.instructions, allowedTools, observations, locale),
      4000,
      { temperature: 0.1 },
    );
    let step;
    try {
      step = parseAgentStep(stepRaw);
    } catch (error) {
      if (repairs >= budget.maxRepairs) break;
      repairs += 1;
      observations.push({ role: "user", content: `Your last message was not valid JSON (${error instanceof Error ? error.message : "parse error"}). Reply with exactly one JSON object: a tool call or {"action":"final","reply":"..."}.` });
      continue;
    }

    if (step.action === "final") {
      finalReply = step.reply;
      break;
    }

    // tool call
    toolCalls += 1;
    if (!allowedTools.includes(step.tool)) {
      observations.push({ role: "user", content: `Tool "${step.tool}" is not available for this task. Available: ${allowedTools.join(", ")}.` });
      continue;
    }
    const ctx = { taskId, workspaceJson: JSON.stringify(candidate) };
    const def = toolRegistry.get(step.tool);
    try {
      const output = await toolRegistry.run(step.tool, step.input, ctx);
      // The orchestrator owns the candidate: fold a successful apply_ops in.
      if (step.tool === "apply_ops" && (output as { ok?: boolean }).ok) {
        const ops = (step.input as { ops: AgentOp[] }).ops;
        candidate = applyAgentOps(candidate, ops);
        changed = true;
        for (const area of affectedAreas) await emit({ type: "area", areaId: area.id, status: "working", progress: 60 });
      } else if (step.tool === "apply_ops") {
        if (repairs >= budget.maxRepairs) break;
        repairs += 1;
      }
      if (def?.toProgress) {
        const progress = def.toProgress(step.input as never, output as never);
        await emit({ type: "discovery", discovery: { id: `tool-${toolCalls}`, title: progress.title, detail: progress.detail }, progress: 65 });
      }
      observations.push({ role: "assistant", content: JSON.stringify(step) });
      observations.push({ role: "user", content: `Observation from ${step.tool}: ${JSON.stringify(output).slice(0, 4000)}` });
    } catch (error) {
      observations.push({ role: "user", content: `Tool ${step.tool} failed: ${error instanceof Error ? error.message : "error"}. Choose another action.` });
    }
  }

  // ---- Validate the candidate before handing it to the route ----
  await emit({ type: "phase", phase: "validating", message: getDictionary(locale).agentChat.phase.validating, progress: 80 });
  for (const area of affectedAreas) await emit({ type: "area", areaId: area.id, status: "complete", progress: 88 });

  if (!changed) return { reply: finalReply, changed: false, affectedAreas };

  assertResultWithinLimits(JSON.stringify(candidate));
  const validated = safeParseWorkspace(candidate);
  if (!validated.success) {
    throw new Error(`Agent produced an invalid workspace: ${validated.error.issues[0]?.message ?? "schema"}`);
  }
  return { reply: finalReply, changed: true, workspace: validated.data, affectedAreas };
}

function resolveAreas(ids: string[], areas: AgentArea[]): AgentArea[] {
  const found = ids.map((id) => areas.find((a) => a.id === id)).filter((a): a is AgentArea => Boolean(a));
  return found.length ? found : areas.slice(0, 6);
}

function buildPlanMessages(ws: Workspace, history: AgentMessage[], message: string, areas: AgentArea[], locale: Locale, corrective = false): ChatMessage[] {
  const system = [
    "You are the planning layer of the StudyOS workspace agent. Decide what to do for the latest message.",
    "Return exactly one JSON object and nothing else, one of:",
    '{"action":"reply","reply":"<concise answer, no edit needed>"}',
    '{"action":"clarify","reply":"<one question>","choices":[{"id":"a","label":"<short>","value":"<full answer>"}]}  // 2-4 choices, only when materially ambiguous',
    '{"action":"execute","skillId":"<precise-edit|study-planner>","summary":"<one-sentence user-facing goal>","affectedAreaIds":["<existing id>"]}',
    "Pick study-planner for exam/assignment/revision/schedule work; otherwise precise-edit.",
    corrective ? "Your previous reply was not valid JSON. Return ONLY the JSON object." : "",
    "Valid workspace area ids:",
    JSON.stringify(areas),
    languageDirective(locale),
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: system },
    ...history.slice(-MAX_HISTORY).map((h): ChatMessage => ({ role: h.role, content: h.content })),
    { role: "user", content: `Workspace summary: ${areas.length} area(s).\nLatest user message: ${message}` },
  ];
}

function buildStepMessages(ws: Workspace, message: string, skillInstructions: string, allowedTools: string[], observations: ChatMessage[], locale: Locale): ChatMessage[] {
  const catalog = allowedTools.map((id) => `- ${id}: input ${TOOL_INPUT_HINTS[id] ?? "{}"}`).join("\n");
  const system = [
    "You are executing a StudyOS workspace change as a step-by-step tool loop.",
    "Skill guidance:", skillInstructions,
    "Return exactly one JSON object per turn, no prose:",
    '{"action":"tool","tool":"<id>","input":{...}}  OR  {"action":"final","reply":"<1-3 sentence summary of what you changed>"}',
    "Available tools:", catalog,
    "Rules: inspect before editing; stage changes only via apply_ops with the SMALLEST operations; reuse existing ids; cells are keyed by property id (select/status = option id, dates = ISO strings); after a successful apply_ops, verify then return final.",
    "Operation shapes for any full objects you include:", WORKSPACE_SHAPE,
    languageDirective(locale),
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `Workspace JSON:\n${JSON.stringify(ws)}\n\nUser request: ${message}` },
    ...observations.slice(-12),
  ];
}
```

> **Note on `ChatMessageRole`:** if `agent-shared.ts` does not already export it, drop the unused import — `ChatMessage` from `./openrouter` is the only message type needed. Remove the import line if `tsc` flags it.

- [ ] **Step 4: Run tests** → `pnpm exec vitest run src/lib/ai/agent-loop.test.ts` → PASS. If `getDictionary(locale).ai.agent.fallbackReply` is undefined in the test env, the reply assertions still pass for the scripted-final case; verify and, if needed, default `finalReply` to `"Done."`.

- [ ] **Step 5: Typecheck** → `pnpm exec tsc --noEmit` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/agent-loop.ts src/lib/ai/agent-loop.test.ts
git commit -m "feat(agent): add bounded JSON-action orchestrator loop"
```

---

## Task 7: Reduce `plan`/`area` events into progress state

**Files:**
- Modify: `src/lib/ai/progress.ts`
- Test: extend `src/lib/ai/progress.test.ts`

**Interfaces:**
- Modifies `AgentActivityState` to add `plan?: { summary: string; areas: AgentArea[] }` and `areas: { id: string; status: AgentAreaStatus; label: string }[]`.
- `reduceAgentActivity` gains `plan` and `area` branches (monotonic progress preserved); `createInitialAgentActivity` seeds `areas: []`.

- [ ] **Step 1: Write the failing test** (append to `progress.test.ts`):

```ts
it("records a plan and updates area status", () => {
  let s = createInitialAgentActivity("start");
  s = reduceAgentActivity(s, { type: "plan", summary: "Coordinating", areas: [{ id: "p1", type: "page", label: "Home" }] });
  expect(s.plan?.summary).toBe("Coordinating");
  expect(s.areas).toHaveLength(1);
  s = reduceAgentActivity(s, { type: "area", areaId: "p1", status: "working", progress: 60 });
  expect(s.areas.find((a) => a.id === "p1")?.status).toBe("working");
});
```

- [ ] **Step 2: Run it, expect failure** → FAIL.

- [ ] **Step 3: Edit `progress.ts`**

```ts
import type { AgentArea, AgentAreaStatus, AgentDiscovery, AgentPhase, AgentStreamEvent } from "./agent-shared";

export interface AgentActivityState {
  phase: AgentPhase;
  message: string;
  progress: number;
  discoveries: AgentDiscovery[];
  plan?: { summary: string; areas: AgentArea[] };
  areas: { id: string; status: AgentAreaStatus; label: string }[];
}

export function createInitialAgentActivity(message: string): AgentActivityState {
  return { phase: "inspecting", message, progress: 4, discoveries: [], areas: [] };
}
```

Add these branches inside `reduceAgentActivity` (before the final `return state`):

```ts
  if (event.type === "plan") {
    return {
      ...state,
      plan: { summary: event.summary, areas: event.areas },
      areas: event.areas.map((a) => ({ id: a.id, status: "queued", label: a.label })),
    };
  }

  if (event.type === "area") {
    return {
      ...state,
      progress: Math.min(PHASE_CEILINGS[state.phase], Math.max(state.progress, event.progress)),
      areas: state.areas.map((a) => (a.id === event.areaId ? { ...a, status: event.status } : a)),
    };
  }
```

- [ ] **Step 4: Run tests** → `pnpm exec vitest run src/lib/ai/progress.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/progress.ts src/lib/ai/progress.test.ts
git commit -m "feat(agent): reduce plan/area stream events into Living Story state"
```

---

## Task 8: Durable event persistence (Prisma + store)

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/ai/tasks/store.ts`
- Test: extend `src/lib/ai/tasks/store.test.ts`

**Interfaces:**
- Adds `events String?` to `AgentTask` (a JSON array of sanitized `AgentStreamEvent`, capped).
- Produces: `appendTaskEvent(id: string, event: AgentStreamEvent): Promise<void>` (owner-scoped; reads current `events`, appends, caps to last 200, writes back); `markTaskDone` becomes **conditional** (`where: { id, userId, status: "running" }`) so a cancelled task can't become done; `getTask` already returns the full row (now including `events`).

- [ ] **Step 1: Edit the Prisma model**

```prisma
model AgentTask {
  id          String   @id @default(cuid())
  userId      String
  workspaceId String
  baseVersion Int
  status      String   @default("running")
  result      String?
  error       String?
  events      String?
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId, workspaceId])
}
```

- [ ] **Step 2: Author the migration locally**

Run: `pnpm prisma migrate dev --name agent_task_events`
Expected: creates `prisma/migrations/<UTCstamp>_agent_task_events/migration.sql` adding the nullable `events` column, and regenerates the client. (Local `.env` points at prod Neon — this is the additive, backward-compatible change the constraints require; a nullable column is safe for the running revision.)

- [ ] **Step 3: Write the failing store test** (extend `store.test.ts` mocks with `update: vi.fn()` on `agentTask`):

```ts
it("markTaskDone only updates a still-running task", async () => {
  mocks.updateMany.mockResolvedValue({ count: 1 });
  await markTaskDone("task-1", "{}");
  expect(mocks.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: "task-1", userId: "user-1", status: "running" } }),
  );
});
```

(Import `markTaskDone` in the test's import list.)

- [ ] **Step 4: Run it, expect failure** → FAIL (current `markTaskDone` has no `status` guard).

- [ ] **Step 5: Edit `store.ts`** — make `markTaskDone` conditional and add `appendTaskEvent`:

```ts
import type { AgentStreamEvent } from "@/lib/ai/agent-shared";

export async function markTaskDone(id: string, result: string): Promise<void> {
  const userId = await requireUserId();
  await prisma.agentTask.updateMany({
    where: { id, userId, status: "running" },
    data: { status: "done", result },
  });
}

/** Append a sanitized progress event to the durable task (capped) for reconnect replay. */
export async function appendTaskEvent(id: string, event: AgentStreamEvent): Promise<void> {
  const userId = await requireUserId();
  const row = await prisma.agentTask.findFirst({ where: { id, userId }, select: { events: true } });
  if (!row) return;
  let events: AgentStreamEvent[] = [];
  if (row.events) {
    try { events = JSON.parse(row.events) as AgentStreamEvent[]; } catch { events = []; }
  }
  events.push(event);
  await prisma.agentTask.updateMany({
    where: { id, userId },
    data: { events: JSON.stringify(events.slice(-200)) },
  });
}
```

- [ ] **Step 6: Run tests** → `pnpm exec vitest run src/lib/ai/tasks/store.test.ts` → PASS.

- [ ] **Step 7: Apply the migration to Neon BEFORE committing code that depends on it** (constraints):

Run (first time only): `pnpm prisma migrate resolve --applied 20260619000000_postgres_baseline`
Then: `pnpm prisma migrate deploy`
Expected: "All migrations have been successfully applied." (the new `events` column now exists in prod).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/ai/tasks/store.ts src/lib/ai/tasks/store.test.ts
git commit -m "feat(agent): persist task progress events; guard markTaskDone against cancel"
```

---

## Task 9: Drive the loop from the route (behind the flag)

**Files:**
- Modify: `src/app/api/agent/route.ts`

**Interfaces:**
- Consumes: `isAuthenticAgentEnabled` (`@/lib/flags`), `runAgentLoop` (`@/lib/ai/agent-loop`), `budgetForPlan` (`@/lib/ai/budgets`), `getUserPlan` (`@/lib/billing`), `appendTaskEvent` (`@/lib/ai/tasks/store`).
- When the flag is **on**, the route builds an `emit` that both `send()`s and `appendTaskEvent()`s, runs `runAgentLoop`, then keeps the existing cancel-guard → `applyAgentWorkspaceChange` → charge → `markTaskDone` → `result` tail. When **off**, the existing `planAgentTurn`/`executeAgentEdit` path runs unchanged.

- [ ] **Step 1: Read the current route** end-to-end so the splice is surgical (`src/app/api/agent/route.ts`). The block to branch is from after `send({ type: "task", ... })` through the `applyAgentWorkspaceChange` apply.

- [ ] **Step 2: Add imports** at the top of the route:

```ts
import { isAuthenticAgentEnabled } from "@/lib/flags";
import { runAgentLoop } from "@/lib/ai/agent-loop";
import { budgetForPlan } from "@/lib/ai/budgets";
import { appendTaskEvent } from "@/lib/ai/tasks/store";
import { getUserPlan } from "@/lib/billing";
```

- [ ] **Step 3: Build the persisting emitter** right after `createTask`/`send({ type: "task" })`:

```ts
// Persist every emitted event so a reconnect can replay the Living Story.
const emit = async (event: AgentStreamEvent) => {
  send(event);
  await appendTaskEvent(task.id, event).catch(() => {});
};
```

- [ ] **Step 4: Branch on the flag.** Replace the hardcoded inspecting/planning/updating sequence + `planAgentTurn`/`executeAgentEdit` with:

```ts
let result: AgentResponse;

if (isAuthenticAgentEnabled()) {
  const plan = await getUserPlan();
  const loop = await withUsageMeter(() =>
    runAgentLoop({
      workspace, history, message, model,
      budget: budgetForPlan(plan), locale, taskId: task.id, emit,
    }),
  );
  result = loop.result;
  usage = addUsage(usage, loop.usage);

  if (!result.changed || !result.workspace) {
    await chargeCredits(userId, usageToCredits(usage), "agent");
    await markTaskDone(task.id, JSON.stringify(result));
    await emit({ type: "result", response: result });
    finish();
    return;
  }
} else {
  // ---- legacy path (unchanged): hardcoded phases + planAgentTurn/executeAgentEdit ----
  // ... keep the existing code exactly as-is ...
}
```

> Keep the **existing** validating/saving tail (the cancel guard + `applyAgentWorkspaceChange` + `chargeCredits` + `markTaskDone` + `result`) **shared** after the branch, so both paths apply identically. The loop already emitted `validating`; the shared tail emits `saving`.

- [ ] **Step 5: Ensure the cancel guard still runs** immediately before `applyAgentWorkspaceChange` (it does — do not remove it; `markTaskDone` is now conditional too as a second line of defense).

- [ ] **Step 6: Manual verification (flag off)** — confirm the legacy path is untouched:

Run: `AUTHENTIC_AGENT=0 pnpm dev`, open a workspace, ask the agent to make a small edit. Expect the old behavior exactly.

- [ ] **Step 7: Typecheck + lint** → `pnpm exec tsc --noEmit` and `pnpm lint` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/agent/route.ts
git commit -m "feat(agent): drive the tool-loop from /api/agent behind AUTHENTIC_AGENT"
```

---

## Task 10: Reconnect GET returns persisted events

**Files:**
- Modify: `src/app/api/agent/task/[id]/route.ts`

**Interfaces:**
- The GET now returns `{ status, response, events }` where `events` is the parsed `AgentStreamEvent[]` (or `[]`).

- [ ] **Step 1: Edit the GET** to parse and include `events`:

```ts
let events: unknown[] = [];
if (task.events) {
  try { events = JSON.parse(task.events) as unknown[]; } catch { events = []; }
}
return Response.json({ status: task.status, response, events });
```

- [ ] **Step 2: Manual check** — after a run, `GET /api/agent/task/<id>` returns an `events` array containing `plan`/`phase`/`discovery` objects.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/task/[id]/route.ts
git commit -m "feat(agent): return persisted progress events from reconnect endpoint"
```

---

## Task 11: Client — render `plan`/`area` events and replay on reconnect

**Files:**
- Modify: `src/components/workspace/AgentChat.tsx`
- Modify: `src/components/workspace/AgentProgressCard.tsx` (render area chips + plan summary)

**Interfaces:**
- Consumes the extended `AgentActivityState` (Task 7).
- In `AgentChat.send`, dispatch `plan` and `area` events into `reduceAgentActivity`; in `recoverTask`, when the GET returns `events`, fold them into activity before applying the result.

- [ ] **Step 1: Handle the new events in the NDJSON loop.** In the per-event dispatch, broaden the progress branch:

```ts
if (event.type === "task") {
  taskIdRef.current = event.taskId;
} else if (event.type === "phase" || event.type === "discovery" || event.type === "plan" || event.type === "area") {
  setActivity((current) => reduceAgentActivity(current, event));
} else if (event.type === "result") {
  receivedResult = true;
  setActivity((current) => reduceAgentActivity(current, event));
  applyResult(event.response);
} else if (event.type === "error") {
  throw new Error(event.message);
}
```

- [ ] **Step 2: Replay events on reconnect.** Update `recoverTask` to fold any returned `events` into activity, so a refreshed client rebuilds the Living Story:

```ts
const recoverTask = async (taskId: string): Promise<boolean> => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(`/api/agent/task/${taskId}`);
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (Array.isArray(body?.events) && body.events.length) {
        setActivity((current) =>
          (body.events as AgentStreamEvent[]).reduce((s, e) => reduceAgentActivity(s, e), current),
        );
      }
      if (body?.status === "done" && body.response) {
        applyResult(body.response as AgentResponse);
        return true;
      }
      if (body?.status && body.status !== "running") return false;
    } catch {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return false;
};
```

- [ ] **Step 3: Render the plan summary + area chips** in `AgentProgressCard` (above the discovery list), guarded so the legacy path (no plan/areas) looks unchanged:

```tsx
{activity.plan && (
  <p className="px-3 pt-2 text-xs font-medium text-ink">{activity.plan.summary}</p>
)}
{activity.areas.length > 0 && (
  <div className="flex flex-wrap gap-1.5 px-3 pt-1">
    {activity.areas.map((area) => (
      <span key={area.id} className="rounded-full bg-hover px-2 py-0.5 text-[10px] text-ink-soft">
        {dict.agentChat.areaStatus[area.status]} · {area.label}
      </span>
    ))}
  </div>
)}
```

(`dict.agentChat.areaStatus` already exists: `{ queued, working, complete }`.)

- [ ] **Step 4: Manual verification (flag on).** `AUTHENTIC_AGENT=1 pnpm dev`; ask "rename my Home page to Dashboard". Confirm: a plan summary appears, area chips move queued→working→complete, a real "Staged N change(s)" discovery shows, the edit applies, and Undo works. Refresh mid-run and confirm the Living Story rebuilds and the result still lands.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/AgentChat.tsx src/components/workspace/AgentProgressCard.tsx
git commit -m "feat(agent): render real plan/area progress and replay it on reconnect"
```

---

## Task 12: i18n — no new keys required (verify), add only if missing

**Files:**
- Possibly modify: `src/lib/i18n/dictionaries/{en,de,es,fr,it,ja,nl,pt,zh,ar}.ts`

The loop reuses existing keys: `agentChat.phase.*`, `agentChat.areaStatus.*`, `ai.agent.fallbackReply`. No new keys are needed for Stage 1.

- [ ] **Step 1: Grep to confirm** the keys the loop reads already exist in every dictionary:

Run: `pnpm exec grep -RL "areaStatus" src/lib/i18n/dictionaries` → expect **no files listed** (all have it). If any file is listed, add the `areaStatus: { queued, working, complete }` block (translated) to it, matching `en.ts`.

- [ ] **Step 2: If (and only if) Step 1 found gaps,** add the missing block to each listed dictionary and commit:

```bash
git add src/lib/i18n/dictionaries
git commit -m "i18n: backfill agentChat.areaStatus in all dictionaries"
```

Otherwise skip — no commit.

---

## Task 13: End-to-end verification, build, and deploy gate

**Files:** none (verification only).

- [ ] **Step 1: Full test suite** → `pnpm test` → all green.

- [ ] **Step 2: Typecheck** → `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 3: Lint** → `pnpm lint` → clean.

- [ ] **Step 4: Production build** (from a clean, non-`.worktrees` path per the worktree-build gotcha) → `pnpm build` → succeeds.

- [ ] **Step 5: Browser acceptance (flag on)** — verify each: precise edit applies + Undo; a study-plan request coordinates multi-area changes; a plain question returns a `reply` with no change; a clarifying question renders choices; Cancel mid-run prevents apply; close/reopen the chat mid-run recovers the Living Story and result; a concurrent manual edit triggers the `workspaceChanged` conflict message (no apply).

- [ ] **Step 6: Confirm migration is live on Neon** (Task 8 Step 7 already ran) → `pnpm prisma migrate status` shows no pending migrations.

- [ ] **Step 7: Roll out** — set `AUTHENTIC_AGENT=1` in the target environment's secrets only after internal verification; keep it `0`/unset elsewhere. The legacy path remains the fallback. **Push to `main` only after the migration is applied** (Cloud Run auto-deploys and runs no migrations).

---

## Self-Review notes (author)

- **Spec coverage:** real loop (T2,T3,T5,T6) · registries wired (T2,T3,T6) · tiered models+budgets+temperature+repair (T1,T4,T6) · evidence progress + real plan/area (T6,T7,T11) · background/durable + reconnect replay (T8,T10,T11) · route integration behind flag with old fallback (T9) · atomic apply + cancel guard + Undo reused (T9). Deferred items (token-streaming replies, personalized chips, research/memory, flashcards, grades, integrations, presentation, sandbox) are listed under **Scope** and belong to later stages.
- **Type consistency:** `runAgentLoop` returns `AgentResponse` (no `changeId`); the route adds `changeId` via `applyAgentWorkspaceChange`. `apply_ops` output `{ ok, opCount, error? }` is consumed by the orchestrator's `(output as { ok?: boolean }).ok` fold. `AgentActivityState.areas` shape `{ id, status, label }` is produced in T7 and consumed in T11.
- **No placeholders:** every code step shows real code; the one "keep existing code as-is" reference (T9 legacy branch) is deliberate — it preserves the untouched fallback path rather than restating it.
