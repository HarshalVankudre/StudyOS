# StudyOS Workspace Agent Upgrade — Scope, Staging & Phase-2 Extensions

> Status: approved design (2026-06-20). This document records the scoping
> decisions for upgrading the workspace agent and fully specifies the net-new
> Phase-2 capabilities. It **builds on** and does not duplicate the existing
> engine design in
> [`2026-06-19-authentic-workspace-agent-design.md`](./2026-06-19-authentic-workspace-agent-design.md)
> ("Milestone One") and
> [`2026-06-19-workspace-agent-tools-design.md`](./2026-06-19-workspace-agent-tools-design.md).
> Where this document is silent on engine internals (loop states, validation
> pipeline, candidate workspace, persistence contracts), Milestone One governs.

## 1. Summary

The workspace agent will move from a fixed two-call JSON form-filler to a real
tool-using loop that inspects, acts, observes, repairs, validates, and applies
one atomic change with Undo. The loop is driven by tiered free/pro models, shows
progress derived from real work, and can run in the background for tasks that
exceed the request ceiling. It ships in four safe stages behind the existing
`AUTHENTIC_AGENT` flag, with the current agent retained as an emergency fallback.

This is **Phase 1** = execute Milestone One (the engine already specified and
half-built), and **Phase 2** = stack study-specific superpowers on top:
knowledge & research, active recall, planning & tracking, and outside
integrations.

The declarative visual/dashboard-builder and the paid OS-sandbox are explicitly
deferred.

## 2. Problem: the agent is structurally scripted

Verified against the live code, the current agent feels scripted because it is:

- **No loop.** Every turn is exactly two single-shot OpenRouter calls in a fixed
  order — `planAgentTurn` then, only for edits, `executeAgentEdit`
  (`src/lib/ai/agent.ts:92,151`). The planner's reply is locked to a 3-way Zod
  `discriminatedUnion` of `reply | clarify | edit` (`agent.ts:27-51`); the model
  cannot iterate, observe a result, chain actions, or do anything else.
- **Theatrical progress.** Percentages and "inspecting…" pings are hand-authored
  constants (`src/app/api/agent/route.ts:128-295`); the client fakes smooth
  motion with a 450ms timer. The model's real plan is generated and then
  discarded (`route.ts:178-181`) in favour of templated strings.
- **Dormant engine.** A complete, unit-tested tool registry, skill registry, and
  SSRF-hardened controlled-fetch already exist (`src/lib/ai/tools/registry.ts`,
  `src/lib/ai/skills/registry.ts`, `src/lib/net/controlled-fetch.ts`) but are
  **never imported by the live path**.
- **Undifferentiated.** Free and pro share one model (`z-ai/glm-5.2`,
  `src/lib/ai/plans.ts:13-14`) with no temperature, reasoning effort, or
  streaming (`src/lib/ai/openrouter.ts:29`); four static suggestion chips for
  every student (`AgentChat.tsx:280`).

The capability ceiling today is "edit one workspace's JSON via ~20 closed ops"
(`src/lib/ai/agent-ops.ts`).

## 3. Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Direction | Full rebuild — Phase 1 engine **and** Phase 2 superpowers |
| 2 | Superpowers | All four: knowledge & research, active recall, planning & tracking, outside integrations |
| 3 | Run weight | "Thorough worker" — quick tasks in seconds; big tasks may run 1–2 min, resumable, with real progress (background execution) |
| 4 | Model | Tiered: free on a fast/cheap tool-calling model, pro on a stronger proven tool-caller |
| 5 | Rollout | Staged, no paid sandbox; behind `AUTHENTIC_AGENT`; old agent as fallback |
| 6 | Visual building | Deferred — content & data first; declarative presentation system is a later stage |

## 4. Scope

### Included

- The Milestone One orchestration loop, tool/skill registries wired into the
  live path, candidate-workspace pattern, validation pipeline (minus
  presentation-specific checks while visual building is deferred), atomic apply +
  Undo, workspace-scoped memory, and durable/cancelable tasks.
- **Tiered model strategy** with tool-calling, streaming, temperature, reasoning
  effort, and bounded schema-repair retries.
- **Background execution** so a run can outlive the 120s request ceiling and be
  reconnected/replayed.
- **Evidence-based progress** + personalized suggestions.
- **Phase-2 capability tools and skills:** research, active recall, grade
  projection, and outside integrations (see §7–§8).

### Deferred (out of scope for this effort)

- Declarative presentation system: workspace themes, responsive layouts/sections,
  and the safe component catalog (Card/Metric/Timeline/etc.). The agent will not
  generate visual dashboards in this effort.
- Paid OS-sandbox (`shell_exec`, `install_package`, `native_build`): these remain
  registered-but-disabled stubs. Milestone Two, unchanged.
- Multi-user workspace roles; cross-workspace actions.

None of the four chosen superpowers require the paid sandbox — all run as trusted
server-side tools.

## 5. Relationship to Milestone One

Milestone One already specifies the engine this effort needs. This document
**reuses** all of it and records three deltas plus the Phase-2 catalog:

- **Delta A — Tiered models** (§6). M1 is model-agnostic; we make the
  free/pro split real and add streaming/temperature/reasoning/repair.
- **Delta B — Background execution** (§6). M1 designs durable tasks and
  reconnect; we make execution actually outlive the request and honor expiry.
- **Delta C — Scope narrowing.** Presentation primitives (M1 §"Declarative
  Workspace Presentation") and their skills (`dashboard-designer`,
  `visual-repair`, `accessibility-reviewer`) are deferred; their validation
  stages are skipped until that stage lands. Other Milestone One skills not
  listed in §11 (e.g. `workspace-architect`, `database-designer`) land with
  their relevant later stage.
- **Catalog extension** (§7–§8): study superpowers M1 did not include
  (active recall, grade projection) and outside integrations.

## 6. Architecture deltas

### 6.1 Model strategy (Delta A)

- `modelForPlan`/plan config (`src/lib/ai/plans.ts`): `free` → a fast, cheap,
  **tool-calling-capable** model; `pro` → a stronger proven tool-caller via the
  existing `STUDYOS_PRO_MODEL` seam. Exact IDs are a config knob chosen after
  empirically validating tool-call reliability (GLM tool-calling is unproven in
  this codebase).
- `chatCompletion` (`src/lib/ai/openrouter.ts:29`) gains: `tools`,
  `tool_choice`, `stream`, `temperature`, and reasoning effort.
- **Bounded repair:** one retry with a corrective schema message on a malformed
  tool call or plan, per M1 error handling. The existing GLM truncation handling
  (`openrouter.ts:46-58`) is preserved.
- Replies stream token-by-token to the chat (today they appear all at once,
  `AgentChat.tsx:67-81`).

### 6.2 Background execution (Delta B)

- Execution moves to a background worker keyed by `AgentTask.id`, so the pro
  budget (180s) can exceed the route's 120s ceiling (`route.ts:33`).
- The durable `AgentTask` model, reconnect `GET`, `cancelTask`, and client
  `recoverTask` polling already exist; this delta makes the run continue after
  the request returns, replays sanitized progress on reconnect, and finally
  enforces `AgentTask.expiresAt` cleanup (written but never acted on today).
- Budgets stay server-owned and tiered (M1): free 90s/8 turns/12 tools/3 fetches;
  pro 180s/14/24/8; max repair attempts 2; one active task per free user, two per
  pro user; short rolling rate limit. Cancellation is checked before/after every
  model call, tool call, validation pass, repair, and apply.

### 6.3 Evidence-based progress

- Remove hardcoded percentages and the fake `streamInspection`
  (`route.ts:128-295`). Emit the already-defined-but-unused `plan` and `area`
  stream events (`src/lib/ai/agent-shared.ts`) and derive Living Story updates
  from real orchestration events via the progress translator.
- Keep the five public phases (Understanding/Shaping/Improving/Checking/
  Finishing) and monotonic weighting from M1. Surface the model's real plan.
- **Personalized suggestion chips** generated from the student's actual
  courses/deadlines/trackers (via `workspaceAreas()`), replacing the four static
  strings (`AgentChat.tsx:280`, `en.ts:415-420`).

## 7. Capability catalog (staged)

### Stage 1–2 tools (mostly exist in Milestone One)

| Tool | Purpose | Source |
|------|---------|--------|
| `inspect_workspace` | Workspace map, counts, capabilities, warnings | M1 / built |
| `find_entities` | Search pages, databases, properties, rows, views, blocks | M1 |
| `read_area` | Bounded relevant slice by IDs | M1 |
| `summarize_workspace` | Compact planning representation | M1 |
| `apply_ops` | Validate + apply typed ops (existing `agent-ops.ts` vocabulary) | M1 / built |
| `read_web_source` | SSRF-hardened, allowlisted HTTPS read | M1 / `controlled-fetch.ts` |
| `extract_research_notes` | Bounded source text → claims/notes/citations | M1 |
| `validate_references`, `validate_candidate` | Structural + semantic validation | M1 |
| `read_workspace_memory`, `propose_workspace_memory` | Workspace-scoped memory | M1 |

**Stage 1–2 skills:** `precise-edit`, `study-planner`, `research-synthesizer`,
and a mandatory `quality-reviewer` final pass (M1).

Presentation tools (`create_layout`, `update_theme`, `compose_component`) and
presentation skills are **deferred**.

### Phase-2 net-new (Stages 3–4) — see §8.

## 8. Phase-2 capability specifications

### 8.1 Active recall (Stage 3)

Tools (each a `ToolDefinition` registered once the loop exists):

- `generate_flashcards({ sourceAreaIds, count, style }) → FlashcardSet` — model
  drafts cards from a bounded workspace slice; output validated against a
  flashcard schema; written as **workspace-native data** (see §9) via candidate
  ops, never a side table.
- `generate_quiz({ sourceAreaIds, count, types }) → Quiz` — MCQ / short-answer
  questions with answer keys.
- `grade_answers({ quizId, answers }) → GradedResult` — scores responses, returns
  per-question feedback, and writes results as workspace data.

Skill: **`recall-coach`** — selected when the request is about making or
practicing cards/quizzes; allowed tools = inspection + the three above +
`apply_ops` + `quality-reviewer`; completion criterion = a validated card/quiz
set (or grade summary) applied to the candidate.

### 8.2 Grade projection (Stage 3)

- `project_grade({ courseRef, scenario? }) → GradeProjection` — reads marks and
  weights from the student's grades database (convention: a workspace database
  with weight + score columns), computes current standing and the marks required
  to hit a target, and returns a structured observation. Optionally writes a
  short summary block.

Skill: **`grade-analyst`** — selected for grade/projection questions; tools =
inspection + `project_grade` + `apply_ops` (for the optional summary) +
`quality-reviewer`. Requires a clarifying question only when no grades data can
be identified.

### 8.3 Outside integrations (Stage 4)

The largest new surface; ships last.

- Providers: Google Calendar, Google Drive, Notion.
- Per-user OAuth with **encrypted token storage** and per-provider connection
  records; refresh handled server-side. Tokens are never exposed to the model or
  to tools as raw secrets.
- Tools (illustrative): `calendar_list_events`, `calendar_create_events`,
  `drive_search`, `drive_import_doc`, `notion_search`, `notion_import_page`.
- All imported external content is **untrusted data**: it flows through the same
  candidate → validation → atomic apply path as web research, and instructions
  found inside imported content cannot change tool permissions, budgets, or
  policy.

Skill: **`integrator`** — selected for "import from / push to {provider}"
requests; tools = the relevant connector(s) + inspection + `apply_ops` +
`quality-reviewer`.

## 9. Data model

- **Flashcards & quizzes — workspace-native.** Stored as workspace data
  (databases or blocks) so they render in the existing UI for free, are covered
  by atomic apply, and are undoable. Recommended representation: a managed
  database per type (Flashcards: Front/Back/Tags/Due; Quiz: Question/Type/
  Options/Answer/Result), created on first use. *Open detail confirmed during
  planning: managed database vs. dedicated block type.*
- **Grades convention.** Grade projection reads an existing grades database; if
  none exists the agent asks one clarifying question or offers to create one.
- **Agent memory.** Owner- and workspace-scoped record (summary, structured
  preferences, recent outcomes, revision number) per M1; every query includes
  both owner ID and workspace ID; committed only after successful completion.
- **AgentTask extensions.** Durable steps, sanitized public events, bounded
  observations, candidate op list, usage/budget counters, cancellation
  timestamp, lease/heartbeat, final response or safe error category; conditional
  terminal transitions so `cancelled` cannot become `done` per M1.
- **OAuth connections (Stage 4).** Encrypted per-user provider tokens + connection
  metadata; owner-scoped.

All migrations are applied to Neon **before** pushing (the deploy pipeline runs
none) — see the deployment memory.

## 10. Security & reliability (carried from Milestone One)

- The model proposes; trusted code executes. Tool schemas, handlers, permissions,
  and limits are owned by the application.
- Every model output and fetched/imported result is untrusted and passes strict
  schemas + policy checks. Prompt injection in workspace, web, or imported
  content cannot change tool permissions, budgets, system instructions, or
  external-write policy.
- Research is HTTPS, GET/HEAD-only, allowlisted, size-capped, time-capped, and
  redirect-revalidated. Tool timeouts are enforced (via `AbortSignal`), not just
  documented.
- Candidate operations are replayed against the latest owned snapshot only at the
  final apply boundary; stale, cancelled, invalid, oversized, or cross-tenant
  results never apply.
- Route handlers and server actions re-authenticate and re-check ownership; the
  client never submits trusted operations, skills, validation evidence, or memory
  writes.
- Logs store IDs, timings, tool IDs, safe categories, and usage — never raw
  workspace content, fetched bodies, secrets, or imported documents. Failed tasks
  do not update memory.

## 11. Staging plan

| Stage | Ships | Outcome |
|-------|-------|---------|
| **1 — Real engine** | Orchestration loop; registries wired; core inspect/edit/validate tools; `precise-edit` + `study-planner` + `quality-reviewer`; evidence-based progress; tiered models; background execution | "It thinks and shows real work" |
| **2 — Research & memory** | `read_web_source` (small domain allowlist) + `research-synthesizer`; workspace memory | "It looks things up and remembers me" |
| **3 — Study superpowers** | flashcards / quiz / grade-projection tools; `recall-coach` + `grade-analyst` | "It's a real study tool" |
| **4 — Integrations** | Calendar / Drive / Notion connectors + `integrator` | "It plugs into my life" |
| *later* | Visual dashboard-builder (presentation system); paid sandbox only if ever | *(deferred)* |

Each stage is gated by the `AUTHENTIC_AGENT` flag and per-skill enablement:
internal accounts → cohort. The legacy agent stays available as an emergency
fallback during rollout but a request is never silently downgraded after the new
agent has started.

## 12. Testing strategy

- **Unit:** planner/action and tool schemas; loop state transitions and budgets;
  tool deadline/cancellation/input/output/permission enforcement; skill
  capability restrictions and selection; candidate op application; every semantic
  reference type; memory validation and owner/workspace scoping; progress
  redaction and monotonicity; conditional task terminal transitions; rate/
  concurrency calculations; Phase-2 tool schemas (flashcard/quiz/grade/connector).
- **Integration:** multi-tool edit through atomic apply; research-and-edit with
  citations; repair after a deliberately invalid first candidate; cancellation
  during planning/tool/validation/just-before-apply; reconnect to running and
  completed tasks; stale base-version conflict; cross-tenant isolation of task,
  memory, workspace, and OAuth tokens; failed validation leaves workspace and
  memory unchanged; flashcard/quiz round-trip; grade projection over a sample
  grades database; integration import with token isolation.
- **UI:** real orchestration events populate the Living Story; reopening chat
  restores the task; result renders once after reconnect; clarification choices
  resume; Undo restores the prior workspace; no internal identifiers/prompts/tool
  names/logs/stack traces appear.
- **Browser acceptance (per stage):** precise edit; revision planner;
  source-backed research with citations; flashcard generation + quiz + grading;
  grade projection; integration import; cancel a long task (no apply); close/
  reopen during a task (recovery); manual edit during a task (conflict
  protection); Undo each successful mutation; desktop/tablet/mobile + dark mode +
  all locales.

## 13. Open details for planning

1. Flashcards/quizzes representation: managed database vs. dedicated block type.
2. Exact free/pro model IDs after a tool-call-reliability spike.
3. Background worker mechanism on the current GCP Cloud Run deployment
   (in-process detached run vs. a queued worker) within the no-paid-infra
   constraint.
4. Web-research initial domain allowlist contents.
5. Whether `grade-analyst` is its own skill or folded into `study-planner`.

## 14. Success criteria

- The live route executes the registered tool + skill system (registries are no
  longer dormant).
- A broad request produces coordinated, validated changes and at least one
  observation-driven revision when initial work fails completion criteria.
- Progress events correspond to real completed actions; the real plan is shown.
- A task can outlive the request and be reconnected; cancellation reliably
  prevents apply.
- Pro is materially better than free (stronger model + larger budgets).
- Students can generate and practice flashcards/quizzes, get grade projections,
  and import from at least one outside integration — all undoable.
- Existing workspaces remain compatible; no invalid references can persist; no
  secrets, source, commands, or imported bodies are exposed.
- Lint, tests, type-checking, production build, and Neon migration checks pass per
  stage.
