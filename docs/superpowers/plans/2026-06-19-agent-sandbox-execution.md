# Agent Sandbox Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the workspace agent use a real, extensible tool/skill system — including isolated shell, package, and web capabilities — while keeping all execution away from StudyOS secrets, the production database, and other users' data. The sandbox result is always untrusted and re-enters the workspace only through the existing owner-scoped, version-checked apply path.

**Architecture:** Two independently shippable increments.
- **Increment A (in-process, ships first):** a server-side **tool + skill registry**, an SSRF-hardened **controlled-fetch** layer, **durable background tasks** (reconnect + cancel), and a **hardened untrusted-changeset boundary** (size/op-count caps) — all reusing today's `applyAgentWorkspaceChange` write path. No untrusted code executes: the planner selects from trusted, Zod-bounded tools (this generalizes the current agent and adds web research + long/cancelable tasks).
- **Increment B (behind a feature flag):** an **isolated OS sandbox** for tools that need a real shell, package install, or native build/lint — run as one ephemeral **Cloud Run Job execution per task** under a zero-permission service account, network-jailed through a VPC egress proxy, handing back only an untrusted `AgentOp[]` changeset.

**Tech Stack:** Next.js 16.2 App Router route handlers, React 19, TypeScript, Prisma 6/Neon PostgreSQL, Clerk ownership checks, Zod, Vitest, GCP Cloud Run + Cloud Run Jobs, Direct VPC egress + a forward proxy, GCS signed URLs, Cloud Tasks (queue), Cloud Logging.

---

## Scope and relationship to prior increments

This is **follow-on subsystem #3** from `docs/superpowers/specs/2026-06-19-workspace-agent-tools-design.md` ("Isolated sandbox execution, controlled web access, and durable background tasks"). It builds directly on the shipped foundation in `2026-06-19-agent-versioning-living-story.md`:

- `applyAgentWorkspaceChange` (owner-scoped, optimistic-version-checked, transactional, immutable `WorkspaceChange`, one-click Undo) is **reused verbatim** as the only path that writes a workspace. The sandbox is demoted to a *producer of untrusted `AgentOp[]`*.
- The Living Story progress model and `AgentStreamEvent` contract are extended, not replaced.

The other two follow-ons (declarative themes/components; the full skill catalog UI) remain separate plans. This plan delivers the **execution + tooling + safety** substrate they will register against.

## Threat model and non-goals

The agent acts on **attacker-influenceable input**: model output, and (with controlled fetch) third-party web content carrying prompt injection. Treat every tool input/output and every changeset as hostile.

**Must hold (security gate):**
1. No path from sandboxed execution to `DATABASE_URL`/`DATABASE_URL_UNPOOLED`, `CLERK_SECRET_KEY`, `OPENROUTER_API_KEY`, `STRIPE_*`, or the GCP metadata server's SA token.
2. No production DB connection, repo mount, or deploy credentials inside the sandbox.
3. No cross-tenant read or write: a sandbox is seeded only with the caller's own sanitized workspace; apply is re-scoped by `ownerId` server-side.
4. The untrusted result cannot DoS or compromise the trusted, secret-holding main service.
5. Network egress from the sandbox is default-deny, allowlisted, response-read-only, and logged.

**Non-goals (this plan):** kernel-level custom isolation beyond what GCP gen2 (Sandbox2/seccomp) provides; running untrusted code in the main app process; user-visible tool logs/console; multi-user workspace roles; semantic safety of valid-but-misleading content (Undo is the backstop).

## Architecture decision

A design panel proposed four architectures, each adversarially stress-tested. Summary of the evidence that drove the decision:

| Architecture | Complexity | Marginal cost | Cold start | Residual risk | Decision |
|---|---|---|---|---|---|
| In-process constrained runtime (isolated-vm) | 3 | ~$0 (warm instance) | near-zero | medium | **Partial** — use the *trusted-registry* form; do **not** run untrusted JS in-process |
| Cloud Run Jobs per task | 4 | negligible compute + standing proxy/NAT | 2–8s | medium | **Chosen** for OS-level tools (Increment B) |
| Dedicated sandbox microservice | 4 | ~$60–130/mo idle | ~1–3s | medium | Rejected — standing idle cost without ephemerality benefits of Jobs |
| Managed microVM (E2B/Modal/Fly) | 3 | new off-GCP cash spend | 150ms–2s | **high** | Rejected — workspace data leaves GCP, vendor trust boundary, spend not on GCP credits |

**Why Cloud Run Jobs for OS execution:** secrets are *physically absent* from the box (a dedicated `studyos-sandbox-runner` SA with zero Secret Manager/Neon/deploy roles; no `--set-secrets`). A sandbox escape lands in a box with no secrets and no DB. It draws on the existing GCP credits and keeps data on-GCP. Per-task compute is a fraction of a cent; the only standing cost is the egress proxy/NAT (watch this, not Job seconds).

**Why isolated-vm is *not* used to run untrusted code:** isolated-vm shares the main process's address space, so a V8/native-addon escape lands directly in the secret-holding host — the single largest residual risk for a feature running attacker-influenced code. Increment A therefore runs **no untrusted code**: the planner selects from a registry of trusted, Zod-bounded tools executed by the host (generalizing today's planner→editor→ops flow), plus a controlled-fetch tool. Real shell/package/native-build tools are registered as flag-gated stubs until Increment B moves them into the Job.

**Red-team gates carried into the tasks below (do not skip):**
- **The metadata-server block (169.254.169.254 / `metadata.google.internal`) is the keystone control and is UNVERIFIED on Cloud Run Jobs with Direct VPC egress.** Link-local traffic is frequently not routed off-host, so a VPC firewall may never see it. Empirically prove from inside a deployed Job that the metadata endpoint is unreachable **before any rollout**.
- **Cap the untrusted result before it touches the trusted server.** Today `agentOpSchema` uses unbounded `z.string()` and unbounded arrays, and `applyAgentOps`/`applyAgentWorkspaceChange` run on the secret-holding service. A malicious result can exhaust it. Add hard caps on serialized bytes, op count, per-string length, and array lengths (Increment A, used by both paths).
- **Egress allowlisting is SNI/host-only** and cannot stop exfiltration inside an allowed TLS session. Make controlled fetch **response-read-only** (no request bodies), constrain redirects and DNS, and denylist on the **resolved/connected IP** (defeat DNS rebinding, IPv4-mapped/decimal/octal encodings, and `metadata.google.internal` by name).
- **Rate-limit per user and queue tasks** (Cloud Tasks) — credits cover LLM tokens, not Job minutes or RunJob quota.
- **npm installs run arbitrary postinstall code** — commit to `--ignore-scripts` or prebaked deps.

## Operational constraints (StudyOS-specific)

- **The deploy pipeline runs NO DB migration** (`cloudbuild.yaml` only builds + `gcloud run deploy`). Every schema change must be applied to Neon **before** pushing to `main`, and must be additive/backward-compatible so the running revision keeps working. The Neon DB has no prior Prisma history (`db push` origin): the first real migration already ran `migrate resolve --applied <baseline>` then `migrate deploy`; subsequent migrations are plain `migrate deploy`. Local `.env`/`.env.local` IS production. (See the `gcp-cloud-run-deployment` and `worktree-build-gotcha` notes.)
- **`next build` must be run from a non-`.worktrees` path** (Turbopack rejects the gitignored path). Run unit tests/tsc from the worktree; verify production builds from a clean checkout.
- The Cloud Run **600s request timeout** forces durable tasks (Increment A) to support poll/reconnect rather than one held-open NDJSON connection; Increment B depends on this.

## File map

**Increment A**
- `prisma/schema.prisma`, `prisma/migrations/**` — `AgentTask` model + additive migration.
- `src/lib/ai/agent-ops.ts` — bounded schemas (string/array/op-count caps) + a `MAX_RESULT_BYTES` guard.
- `src/lib/ai/limits.ts` (+ `.test.ts`) — central caps used by every boundary.
- `src/lib/ai/tools/registry.ts` (+ `.test.ts`) — tool registry: id, private description, Zod in/out, limits, `networkPermission`, event mapper.
- `src/lib/ai/tools/builtin/*.ts` — workspace inspect/edit, schema/reference validation, structured artifact gen, in-memory temp-fs; flag-gated stubs for shell/install/native-build.
- `src/lib/ai/skills/registry.ts` (+ `.test.ts`) — versioned skill bundles selecting allowed tool ids.
- `src/lib/net/controlled-fetch.ts` (+ `.test.ts`) — SSRF-hardened fetch (allowlist, resolved-IP denylist, redirect re-validation, size/time caps, audit).
- `src/lib/ai/tasks/store.ts` (+ `.test.ts`) — durable `AgentTask` create/get/cancel/expire, owner-scoped.
- `src/app/api/agent/route.ts`, `src/app/api/agent/task/[id]/route.ts`, `src/app/api/agent/task/[id]/cancel/route.ts` — create/stream/reconnect/cancel.
- `src/lib/ai/agent-shared.ts` — `taskId` on the stream contract; reconnect event types.
- `src/components/workspace/AgentChat.tsx` — reconnect-by-taskId + cancel wiring.
- `src/lib/i18n/dictionaries/{en,es,de,fr,it,pt,nl,zh,ja,ar}.ts` — task/cancel/fetch copy.

**Increment B**
- `infra/sandbox/Dockerfile.runner`, `infra/sandbox/cloudbuild.runner.yaml` — minimal runner image (tools only; no app code, no Prisma URL).
- `infra/sandbox/proxy/**` — forward proxy (allowlist, RFC1918 + metadata deny, response-read-only, logging).
- `infra/sandbox/README.md` — SA/IAM, VPC, Job, proxy, and the deploy-time egress assertion.
- `src/lib/ai/sandbox/runner-client.ts` (+ `.test.ts`) — mint TASK_ID + signed GCS read/write URLs, RunJob with per-task overrides, poll `executions.get`, cancel.
- `src/lib/ai/sandbox/result.ts` (+ `.test.ts`) — download + cap + `agentOpSchema` validate the untrusted result.
- `src/lib/ai/tools/builtin/*.ts` — promote shell/install/native-build/fetch tools to run in the Job.
- `src/lib/flags.ts` — `AGENT_SANDBOX` flag + per-plan task limits.

---

# Increment A — Tooling, controlled fetch, durable tasks, hardened boundary

### Task A1: Centralize and enforce result limits

**Files:** Create `src/lib/ai/limits.ts`, `src/lib/ai/limits.test.ts`; Modify `src/lib/ai/agent-ops.ts`.

- [ ] **Step 1: Failing tests** — assert `agentOpSchema` rejects an op array longer than `MAX_OPS`, a string field longer than `MAX_OP_STRING`, and arrays (rows/blocks) longer than `MAX_ARRAY`; assert `assertResultWithinLimits(json)` throws on a serialized payload over `MAX_RESULT_BYTES`.
- [ ] **Step 2: Implement** — `limits.ts` exports the caps (`MAX_OPS=200`, `MAX_OP_STRING=20_000`, `MAX_ARRAY=2_000`, `MAX_RESULT_BYTES=2_000_000` — tune later) and `assertResultWithinLimits`. Apply `.max(...)` to the `z.string()`/`z.array()` members in `agent-ops.ts` and wrap the op array in `.max(MAX_OPS)`.
- [ ] **Step 3:** Call `assertResultWithinLimits` in the apply path **before** `JSON.parse`/`applyAgentOps` (protects the current in-process agent too).
- [ ] **Step 4:** `pnpm test -- src/lib/ai/limits.test.ts`; `git commit -m "feat: cap agent op/result size to protect the trusted apply path"`.

### Task A2: Durable AgentTask records

**Files:** Modify `prisma/schema.prisma`; Create migration; Create `src/lib/ai/tasks/store.ts` (+ test).

- [ ] **Step 1:** Add model `AgentTask { id, userId, workspaceId, baseVersion Int, status (running|done|cancelled|error), result String?, error String?, expiresAt DateTime, createdAt, updatedAt @@index([userId, workspaceId]) }`.
- [ ] **Step 2:** Create an **additive** migration; `prisma validate` + `generate`. Apply to Neon **before** any deploy: `pnpm prisma migrate deploy` (history now exists from the prior increment).
- [ ] **Step 3:** Failing tests for `store.ts` (mock prisma + Clerk): `createTask` writes owner-scoped row + `expiresAt ≈ now+10m`; `getTask`/`cancelTask` are owner-scoped (reject another user's id); `markDone`/`markError` persist result/error.
- [ ] **Step 4:** Implement `store.ts` (mirror `version-service.ts` ownership pattern). Tests pass; commit.

### Task A3: Tool + skill registry

**Files:** Create `src/lib/ai/tools/registry.ts` (+ test), `src/lib/ai/tools/builtin/*`, `src/lib/ai/skills/registry.ts` (+ test).

- [ ] **Step 1:** Failing tests — registering a tool with a malformed schema throws; an unknown tool id is rejected; a skill may only reference enabled tool ids; tool input/output are validated and a violation throws.
- [ ] **Step 2:** Implement the `ToolDefinition` contract (id, private description, `input`/`output` Zod, `limits`, `networkPermission`, `toProgressEvent`) and `runTool(id, input, ctx)` that validates in→handler→out and maps to a Living Story `discovery`/`phase` event (no raw args/paths).
- [ ] **Step 3:** Implement built-in tools as **trusted host code**: `inspect_workspace`, `apply_ops` (wraps `applyAgentOps` dry-run + `safeParseWorkspace`), `validate_references`, `generate_artifact`, in-memory `temp_fs`. Register `shell_exec`, `install_package`, `native_build` as **flag-gated stubs that throw** "not available yet".
- [ ] **Step 4:** Implement the skill registry (versioned bundles → allowed tool ids; cannot self-grant). Tests pass; commit.

### Task A4: SSRF-hardened controlled fetch

**Files:** Create `src/lib/net/controlled-fetch.ts` (+ test).

- [ ] **Step 1: Failing abuse tests** — deny non-HTTPS; deny non-allowlisted host; deny when the **resolved IP** is RFC1918/link-local/`169.254.169.254` (DNS-rebinding case: allowlisted hostname resolving to a private IP); deny `metadata.google.internal` by name; deny IPv4-mapped/decimal/octal metadata encodings; re-validate every redirect hop; reject request bodies; enforce response size + time caps; write an audit record (taskId, host, status, bytes — never the body).
- [ ] **Step 2:** Implement using a custom `lookup`/agent that denylists the **connected** IP (not a pre-resolve string check), GET/HEAD only, manual redirect following with per-hop re-validation, `AbortController` timeout, and a streamed size cap.
- [ ] **Step 3:** Tests pass; commit. (This is the network boundary for Increment A and the app-layer second line for Increment B.)

### Task A5: Durable, cancelable task route + reconnect

**Files:** Modify `src/app/api/agent/route.ts`, `src/lib/ai/agent-shared.ts`; Create `src/app/api/agent/task/[id]/route.ts`, `.../cancel/route.ts`.

- [ ] **Step 1:** Refactor `POST /api/agent`: create an `AgentTask`, load the owner-scoped snapshot, drive the planner over the **tool registry** (selecting a skill), stream Living Story events, and on success run the result through `assertResultWithinLimits` → `agentOpSchema` → `applyAgentOps` → `safeParseWorkspace` → `applyAgentWorkspaceChange`. **Refuse to apply if the task is cancelled.**
- [ ] **Step 2:** Add `taskId` to the result event; add `GET /api/agent/task/[id]` (owner-scoped status/result for reconnect) and `POST /api/agent/task/[id]/cancel`.
- [ ] **Step 3:** Type-check (`pnpm exec tsc --noEmit`); commit.

### Task A6: Chat reconnect + cancel + i18n

**Files:** Modify `src/components/workspace/AgentChat.tsx`, all 10 dictionaries.

- [ ] **Step 1:** On mount with an in-flight `taskId`, reconnect via `GET /api/agent/task/[id]`; wire Cancel to the cancel route (the existing Living Story Cancel button now stops the durable task).
- [ ] **Step 2:** Add task/cancel/fetch-research copy to `en.ts`, then all 9 locales (fan out); `tsc` confirms the `Dictionary` contract. Commit.

### Increment A completion gate
- Every agent edit still flows only through `applyAgentWorkspaceChange`; the result is size/op-count capped before parsing.
- A task survives disconnect (reconnect by `taskId`, ~10-min retention) and Cancel prevents apply.
- The planner selects from the registry; controlled fetch enables web research with SSRF defenses and per-fetch audit; **no untrusted code runs in-process**.
- shell/install/native-build are present but flag-gated stubs.
- All unit tests, `tsc`, and a clean-path production build pass; the `AgentTask` migration is applied to Neon before any push.

---

# Increment B — Isolated OS sandbox (Cloud Run Jobs), behind a flag

> Ship only after Increment A. Gate every step on the red-team findings; **verify the metadata block first**.

### Task B1: Runner image and tool handlers

**Files:** Create `infra/sandbox/Dockerfile.runner`, `infra/sandbox/cloudbuild.runner.yaml`; Modify `src/lib/ai/tools/builtin/*`.

- [ ] **Step 1:** Minimal Node image containing only the tool implementations (fs/shell/`install_package`/native-build/validators/artifact-gen) and a runner entrypoint. **No app code, no Prisma client with a real URL.** Commit to `npm install --ignore-scripts` (or prebaked deps).
- [ ] **Step 2:** Runner: read sanitized snapshot from a signed GCS **read** URL → run requested tools against the local container FS/tmpfs only → write `{ ops, evidence }` to a signed GCS **write** URL → exit. Emit progress to a side channel (POST to an authenticated main-service endpoint, or GCS) — never to user-visible logs verbatim.

### Task B2: Identity, IAM, and the network jail (the keystone)

**Files:** `infra/sandbox/README.md`, `infra/sandbox/proxy/**`.

- [ ] **Step 1:** Create SA `studyos-sandbox-runner` with **zero** Secret Manager/Neon/deploy roles. Deploy the `studyos-agent-sandbox` Cloud Run **Job** under it with CPU/mem caps + `--task-timeout`. Grant the main SA: RunJob, mint signed URLs, read executions.
- [ ] **Step 2:** Network jail — dedicated VPC subnet with **no internet route**; Job uses Direct VPC egress with `--vpc-egress=all-traffic`; a forward proxy holds the domain allowlist, is **response-read-only** (blocks request bodies), denies RFC1918 + `169.254.169.254` + `metadata.google.internal`, caps response size/time, and logs every request. VPC firewall egress allows only the proxy. Add a **deploy-time assertion** that egress is `all-traffic` (a flip to private-ranges silently reopens the internet).
- [ ] **Step 3 — BLOCKING VERIFICATION:** From inside a deployed Job, attempt to reach `http://169.254.169.254/...` and `metadata.google.internal` and confirm **failure**; attempt arbitrary egress and a non-allowlisted host and confirm **failure**; confirm an allowlisted host succeeds GET-only. Record the evidence in `infra/sandbox/README.md`. **Do not proceed to rollout until this passes.**

### Task B3: Orchestration, snapshot sanitizer, and result intake

**Files:** Create `src/lib/ai/sandbox/runner-client.ts` (+ test), `src/lib/ai/sandbox/result.ts` (+ test); Modify the snapshot/sanitizer used in Task A5.

- [ ] **Step 1: Failing tests** — the sanitizer strips `ownerId`, foreign workspace ids, and any cross-tenant relation ids (seed only the caller's own workspace); `result.ts` rejects an oversized blob and any op failing `agentOpSchema` **before** `applyAgentOps`.
- [ ] **Step 2:** Implement `runner-client.ts`: mint `TASK_ID` + short-TTL signed GCS read/write URLs (the runner SA itself has no broad storage role), `RunJob` with per-task env + resource overrides, poll `executions.get`, expose Cancel via `executions.cancel` (+ the cancelled-task apply refusal from A5).
- [ ] **Step 3:** Implement `result.ts`: download → `assertResultWithinLimits` → `agentOpSchema` → hand to the **same** A5 apply path (replay against the freshly reloaded owned workspace → `safeParseWorkspace` → `applyAgentWorkspaceChange`). Tests pass; commit.

### Task B4: Queue, rate limits, flag, and rollout

**Files:** Create `src/lib/flags.ts`; Modify the task route.

- [ ] **Step 1:** Per-user task concurrency + rate limits; enqueue RunJob via **Cloud Tasks** to absorb bursts and respect RunJob quota.
- [ ] **Step 2:** `AGENT_SANDBOX` flag (off by default) routing only heavy/tool-using/web-reading tasks to the Job; keep trivial edits on the in-process path (avoids the 2–8s cold start and proxy cost when unneeded). Per-plan task limits.
- [ ] **Step 3: Security tests** (integration): metadata-block, RFC1918-block, non-allowlisted-host-block, DOR on another user's workspace, forged/oversized result rejected, stale `baseVersion` rejected, cancelled-task apply refused.
- [ ] **Step 4:** Internal dogfood → monitor proxy/fetch/cost/quota → gradual enable per the spec's rollout. Commit.

### Increment B completion gate
- The metadata-server block and egress denials are **empirically proven** from inside a deployed Job (evidence recorded).
- Sandboxed tools run under a zero-role SA with no secrets/DB/repo/deploy access; result is capped and re-validated; apply remains owner- and version-scoped with Undo.
- Per-user limits + Cloud Tasks queue are in place; rollout is flag-gated and reversible.
- No raw command, package, code, filename, log line, model name, or database id is ever shown to the user.

---

## Open questions to resolve during implementation
- Verify `isolated-vm` is **not** required anywhere in Increment A (the trusted-registry design avoids it); if a future tool needs user-authored JS, run it in the Job, not in-process.
- Confirm Cloud Run Jobs honor per-execution env **and** resource overrides via `RunJob`, or pre-define sized Jobs.
- Measure runner cold start in us-east4; decide Startup CPU Boost / prebaked deps.
- Decide controlled-fetch allowlist contents and whether egress is disabled entirely for edit-only tasks (proxy becomes a per-feature cost).
- Define credit/task accounting across multi-tool tasks and per-plan task limits.
