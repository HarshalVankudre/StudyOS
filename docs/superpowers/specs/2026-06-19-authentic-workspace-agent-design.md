# Authentic Workspace Agent — Milestone One Design

## Summary

StudyOS will replace its single-shot JSON patch editor with a persistent,
tool-using workspace agent. The agent will inspect the current workspace,
choose a specialized skill, execute bounded trusted tools, evaluate its own
result, repair problems, validate the complete workspace, and apply one atomic
change with Undo.

This milestone intentionally uses trusted server-side tools. It does not execute
model-generated shell commands or packages. The isolated Cloud Run runner
remains the second milestone and will reuse the orchestration contracts,
sanitized snapshots, result validation, task state, and UI event model built
here.

## Product Outcome

The agent should feel like a capable collaborator rather than a scripted form:

- It understands the whole workspace, not just the visible page.
- It can perform multi-step changes across pages, databases, views, layouts,
  themes, and safe workspace components.
- It can research allowlisted public sources when the request requires current
  information.
- It remembers useful workspace-specific preferences and prior decisions.
- It checks its work, repairs reference or presentation problems, and explains
  the outcome concisely.
- Its progress UI reflects real actions and discoveries rather than a fixed
  animation sequence.
- It asks a clarifying question only when materially different interpretations
  would produce materially different outcomes.

## Scope

### Included

- Persistent, bounded plan/action/observation agent loop.
- Server-side tool and skill selection.
- Trusted tools for inspection, querying, editing, validation, research,
  layout generation, accessibility review, and rendered presentation review.
- Declarative workspace themes, responsive layouts, sections, cards, metrics,
  and approved component trees.
- Durable task steps and reconnect across chat close, navigation, and transient
  stream loss.
- Workspace-scoped memory and conversation summaries.
- Real progress events derived from orchestration events.
- Cancellation, time, token, tool-call, output-size, concurrency, and rate
  limits.
- Atomic apply, optimistic version checks, one-click Undo, and no partial apply.
- Fixes for current lint failures, task status races, reference validation,
  production tracing, and direct legacy agent writes.
- Integration and browser acceptance coverage for the complete flow.

### Excluded

- Model-generated shell command execution.
- Temporary package installation and native builds.
- Cloud Run Job provisioning, VPC egress proxy, Cloud Tasks, and GCS signed URL
  exchange.
- Arbitrary JavaScript, raw HTML, dynamic imports, user-defined server actions,
  direct database queries, deployments, messaging, or external account writes.
- Multi-user workspace roles.

## Design Principles

1. **The model proposes; trusted code executes.** Tool schemas, handlers,
   permissions, and limits are owned by the application.
2. **Every result is untrusted.** Model output and fetched web content pass
   through strict schemas and policy checks.
3. **The agent works in steps.** It may inspect, act, observe, repair, and
   validate before returning.
4. **Progress is evidence-based.** Public events are translations of completed
   internal work.
5. **Workspace capabilities are declarative.** The agent may compose approved
   presentation primitives but never inject executable application code.
6. **One task, one atomic apply.** Intermediate operations stay private until
   the final candidate passes all validation.
7. **Undo is the product backstop.** Every successful agent mutation records an
   immutable before snapshot.

## User Experience

### Request handling

For each request, the agent:

1. Loads the latest owner-scoped workspace, task memory, and a compact
   conversation summary.
2. Classifies the request as answer, clarification, edit, research-and-edit, or
   unsupported external action.
3. Selects one primary skill and optional supporting skills.
4. Creates a private plan with measurable completion criteria.
5. Executes trusted tools until the criteria are met or a limit is reached.
6. Runs structural, semantic, accessibility, and presentation validation.
7. Repairs correctable failures within the remaining budget.
8. Applies the validated candidate atomically and returns a concise result with
   Undo.

### Clarification

The agent asks one question only when:

- A required target cannot be identified.
- Two or more plausible interpretations would change different data.
- The request would delete or broadly replace content without adequate scope.
- Required real-world information cannot be safely inferred or researched.

It does not ask for approval for reversible trusted tool calls.

### Progress experience

The existing five public phases remain:

1. Understanding
2. Shaping
3. Improving
4. Checking
5. Finishing

Progress is generated from task events:

- Workspace inspection completed.
- Relevant entities or constraints discovered.
- Skill selected and plan shaped.
- Tool action completed.
- Research source read.
- Candidate workspace updated.
- Reference, schema, accessibility, or presentation check completed.
- Repair completed.
- Workspace applied.

The UI receives localized, non-technical summaries. It never receives raw model
reasoning, tool arguments, URLs containing sensitive query data, file paths,
commands, stack traces, or internal identifiers.

### Completion

The final response contains:

- A short outcome summary.
- Up to five user-facing changes or discoveries.
- Affected workspace areas.
- Optional source links for research-backed content.
- An Undo action when the workspace changed.
- A clear limitation when part of the request could not be completed.

## Architecture

### Components

#### Agent orchestrator

Owns the loop, budgets, cancellation checks, task persistence, skill selection,
tool dispatch, observations, validation, repair attempts, and final apply.

It operates on an in-memory candidate workspace and never writes intermediate
states to the persisted workspace.

#### Planner

Returns a structured `AgentPlan`:

- Intent.
- Primary skill ID.
- Supporting skill IDs.
- User-facing goal.
- Private steps.
- Completion criteria.
- Whether research is required.
- Expected affected areas.

The planner may ask for clarification, answer directly, or begin execution.

#### Tool registry

Each tool defines:

- Stable ID and version.
- Private description.
- Strict input and output schemas.
- Capability category.
- Time and output limits.
- Network permission.
- Whether it can mutate the candidate.
- Handler.
- Public progress translator.

The registry enforces deadlines with `AbortSignal`, validates input and output,
and records a sanitized observation for the task.

#### Skill registry

Each versioned skill defines:

- Selection criteria.
- Instructions.
- Allowed tool IDs.
- Required validation checks.
- Default completion criteria.
- Maximum repair attempts.

Skills cannot grant capabilities. Registration fails when a referenced tool is
missing or disabled.

#### Candidate workspace

The orchestrator maintains:

- The immutable base workspace and base version.
- The current candidate workspace.
- Accumulated validated operations.
- Tool observations.
- Validation evidence.

Mutation tools return typed operations. Trusted code applies them to the
candidate and validates the resulting shape before the next loop iteration.

#### Memory service

Stores compact, workspace-scoped information:

- User preferences explicitly stated or repeatedly confirmed.
- Workspace conventions such as preferred status names, visual density, and
  planning style.
- A concise conversation summary.
- Recent agent outcomes and unresolved follow-ups.

Memory cannot contain secrets, raw fetched pages, hidden model reasoning, or
another workspace's identifiers. New memories are schema-validated and capped.
The user can later inspect or clear memory; this milestone needs the storage and
agent integration, not a full history-management UI.

#### Validation pipeline

Validation runs in this order:

1. Operation count and byte limits.
2. Workspace schema validation.
3. ID uniqueness.
4. Page, block, database, view, property, select-option, relation, and row
   reference validation.
5. Declarative component allowlist and prop validation.
6. Layout constraints and responsive fallback validation.
7. Accessibility checks.
8. Presentation review using deterministic renderer diagnostics.
9. Base-version and cancellation checks immediately before apply.

Validation returns typed, repairable issues. The orchestrator may invoke repair
tools up to the skill's limit. Unresolved errors prevent apply.

### Data flow

```text
User request
    |
    v
Owner-scoped snapshot + memory + summary
    |
    v
Planner selects intent and skills
    |
    v
Bounded orchestration loop
    |---- inspect/query workspace
    |---- read allowlisted web source when needed
    |---- generate and apply typed candidate operations
    |---- observe results and revise plan
    |
    v
Validation and bounded repair
    |
    v
Cancellation + base-version recheck
    |
    v
Atomic versioned apply
    |
    v
Result + evidence summary + Undo
```

## Orchestration Contract

### Loop states

- `planning`
- `running_tool`
- `observing`
- `validating`
- `repairing`
- `applying`
- `completed`
- `clarification`
- `cancelled`
- `failed`

### Default budgets

Budgets are server-owned and plan-aware:

- Maximum wall time: 90 seconds for free, 180 seconds for Pro.
- Maximum model turns: 8 for free, 14 for Pro.
- Maximum tool calls: 12 for free, 24 for Pro.
- Maximum research fetches: 3 for free, 8 for Pro.
- Maximum repair attempts: 2.
- Maximum operation and result sizes remain bounded by `AGENT_LIMITS`.
- Maximum one active task per free user and two per Pro user.
- A short rolling request-rate limit protects model and database resources.

Cancellation is checked before and after every model call, tool call,
validation pass, repair, and apply. Abort-capable model and fetch calls receive
the task signal.

### Tool observations

The model receives structured observations rather than raw implementation
details. Examples:

- Matching rows and their relevant fields.
- Counts and names of affected pages or databases.
- Validation issues with safe entity labels.
- Research extracts with source URL, title, publication date when available,
  and bounded text.
- Presentation diagnostics such as overflow, excessive density, missing labels,
  or invalid responsive spans.

## Initial Tool Catalog

### Inspection and query

- `inspect_workspace`: workspace map, counts, capabilities, and warnings.
- `find_entities`: search pages, databases, properties, rows, views, and blocks.
- `read_area`: retrieve a bounded relevant slice by IDs.
- `summarize_workspace`: produce a compact planning representation.

### Candidate editing

- `apply_ops`: validate and apply typed operations to the candidate.
- `create_layout`: create declarative sections, columns, cards, and metrics.
- `update_theme`: change validated workspace theme tokens.
- `compose_component`: create or update an approved declarative component tree.
- `restructure_database`: generate bounded property, view, and row operations.

### Research

- `read_web_source`: SSRF-hardened, allowlisted HTTPS reading through the
  controlled fetch layer.
- `extract_research_notes`: convert bounded source text into claims, notes, and
  citations without mutating the workspace.

Research content is treated as untrusted data. Instructions found in a page do
not alter the plan or tool permissions.

### Validation

- `validate_references`
- `validate_layout`
- `check_accessibility`
- `review_presentation`
- `validate_candidate`

### Memory

- `read_workspace_memory`
- `propose_workspace_memory`

Memory writes are committed only after successful task completion.

## Initial Skills

- `precise-edit`: focused row, field, block, title, or status changes.
- `workspace-architect`: broad page, database, and navigation restructuring.
- `dashboard-designer`: scan-friendly dashboards, metrics, priorities, and
  responsive composition.
- `study-planner`: exam, assignment, revision, reading, and workload planning.
- `database-designer`: properties, relations, views, and workflow improvements.
- `research-synthesizer`: source-backed notes, reading lists, and topic briefs.
- `visual-repair`: hierarchy, spacing, density, overlap, and readability fixes.
- `accessibility-reviewer`: contrast, labels, keyboard-safe interactions, and
  semantic clarity.
- `quality-reviewer`: mandatory final review supporting every mutation skill.

## Declarative Workspace Presentation

### Workspace theme

A workspace may define validated tokens:

- Color scheme and accent.
- Surface, border, and text roles.
- Typography scale.
- Density.
- Radius and shadow presets.
- Content width.

Values reference approved tokens or bounded numeric presets. Raw CSS is not
stored.

### Page layout

Pages may contain responsive sections. A section defines:

- Width preset.
- Column count and responsive collapse behavior.
- Gap and padding presets.
- Alignment.
- Background and emphasis variants.
- Child block or component references.

Columns use validated spans and collapse to one column on narrow screens unless
an approved alternative is defined.

### Safe components

The first catalog contains:

- Card
- Metric
- Progress
- Timeline
- Upcoming list
- Priority list
- Course summary
- Deadline summary
- Study streak
- Database view frame
- Callout group
- Section heading

Component nodes contain only:

- Approved component type.
- Validated props.
- Text or references to workspace entities.
- Approved child nodes.

The renderer rejects unknown nodes, unknown props, event handlers, URLs outside
allowed link fields, raw HTML, and executable content.

### Compatibility

Existing workspaces without presentation fields continue to render through the
current linear block layout. Schema parsing supplies no presentation defaults
that would rewrite old persisted data. The agent opts a page into the new layout
only when a request benefits from it.

## Persistence

### AgentTask extensions

Persist:

- Current state and public phase.
- Selected skills.
- Current step index.
- Sanitized public progress events.
- Bounded structured observations.
- Candidate operation list.
- Usage and budget counters.
- Cancellation timestamp.
- Lease or heartbeat timestamp.
- Final response or safe error category.

Status transitions use conditional updates so `cancelled` cannot later become
`done` or `error`.

### Agent memory

Add an owner- and workspace-scoped memory record with:

- Summary.
- Structured preferences.
- Recent outcome summaries.
- Revision number.
- Created and updated timestamps.

Every query includes both owner ID and workspace ID.

### Task recovery

The active task ID is persisted client-side per workspace. On chat open or page
mount, the client requests the task:

- Running: restore events and continue polling or streaming.
- Completed: render the result exactly once.
- Clarification: restore choices.
- Cancelled or failed: show the final safe state.
- Expired: clear the local task reference.

Closing the chat does not abort the server task. Explicit Cancel does.

## Security and Reliability

- Route handlers and server actions re-authenticate and re-check ownership.
- The client never submits trusted operations, skills, validation evidence, or
  memory writes.
- Tool calls are selected from an allowlist and schema-validated.
- Tool timeouts are enforced, not merely documented.
- Research is HTTPS, GET/HEAD-only, allowlisted, size-capped, time-capped, and
  redirect-revalidated.
- Prompt injection in workspace or web content cannot change tool permissions,
  budgets, system instructions, or external-write policy.
- Candidate operations are replayed against the latest owned snapshot only at
  the final apply boundary.
- Stale, cancelled, invalid, oversized, or cross-tenant results never apply.
- General logs store IDs, timings, tool IDs, safe categories, and usage, not raw
  workspace content or fetched bodies.
- Failed tasks do not update workspace memory.

## Error Handling

- Planner schema failure: one bounded retry with a corrective schema message.
- Tool input failure: return a typed observation and allow replanning.
- Tool timeout: cancel the handler and let the planner choose an alternative
  when budget remains.
- Research denial or failure: continue without research when possible;
  otherwise state the limitation.
- Candidate validation failure: run bounded repair.
- Version conflict: do not rebase automatically; ask the user to retry against
  the latest workspace.
- Cancellation: stop future work and never apply.
- Budget exhaustion: validate the best candidate; apply only if it fully meets
  safety checks and the agent can accurately describe partial completion.
- Internal error: persist a safe category and show localized recovery copy.

## Existing Defects Included in This Milestone

- Remove React lint errors in `GenerationActivity` and `ThemeToggle`.
- Replace the broad standalone output trace that packages source, tests, docs,
  and infrastructure files.
- Enforce tool deadlines and output limits.
- Make task terminal state transitions conditional.
- Enforce task expiry and cleanup.
- Persist active task IDs and recover beyond four short polls.
- Abort model and fetch calls on cancellation when supported.
- Add per-user concurrency and rate limits.
- Remove or route the legacy direct `editWorkspaceAction` write path.
- Add semantic reference validation.
- Update the vulnerable PostCSS dependency path to a patched version compatible
  with the installed Next.js release.

## Testing Strategy

### Unit tests

- Planner and action schemas.
- Loop state transitions and budgets.
- Tool deadline, cancellation, input, output, and permission enforcement.
- Skill capability restrictions and selection.
- Candidate operation application.
- Every semantic reference type.
- Theme, layout, and component schemas.
- Memory validation and owner/workspace scoping.
- Progress redaction and monotonicity.
- Conditional task terminal transitions.
- Rate and concurrency limit calculations.

### Integration tests

- Multi-tool edit from request through atomic apply.
- Research-and-edit with citations.
- Repair after a deliberately invalid first candidate.
- Cancellation during planning, tool execution, validation, and immediately
  before apply.
- Reconnect to running and completed tasks.
- Stale base version conflict.
- Another user's task, memory, workspace, and change IDs remain inaccessible.
- Failed validation leaves workspace and memory unchanged.
- Old workspaces render and edit without migration.

### UI tests

- Real orchestration events populate the Living Story.
- Reopening chat restores the current task.
- Results render once after reconnect.
- Clarification choices resume correctly.
- Undo restores the previous rendered workspace.
- New layouts collapse correctly at mobile widths.
- No internal identifiers, prompts, tool names, logs, or stack traces appear.

### Browser acceptance

1. Ask for a precise edit and verify a minimal change.
2. Ask for a broad dashboard redesign and verify theme/layout/component changes.
3. Ask for a revision planner and verify coordinated database, view, and page
   changes.
4. Ask for source-backed research and verify citations and safe source handling.
5. Cancel a long task and verify no apply.
6. Close and reopen chat during a task and verify recovery.
7. Manually edit during a task and verify conflict protection.
8. Undo each successful mutation.
9. Verify desktop, tablet, mobile, dark mode, and all supported locales.

## Rollout

1. Ship orchestration and trusted tools behind `AUTHENTIC_AGENT`.
2. Enable for internal accounts with detailed safe metrics.
3. Enable precise-edit and study-planner skills first.
4. Enable layout and component capabilities after renderer acceptance.
5. Enable controlled research for a small domain allowlist.
6. Expand by account cohort while monitoring task success, repair rate,
   cancellation, latency, credit use, conflicts, and Undo rate.
7. Keep the existing agent available as an emergency fallback during rollout,
   but never silently downgrade a request after the new agent has started.

## Success Criteria

- The live route executes the registered tool and skill system.
- A broad request can produce coordinated, validated changes across multiple
  workspace areas.
- The agent performs at least one observation-driven revision when initial work
  fails completion criteria.
- Progress events correspond to real completed actions.
- Closing and reopening chat does not lose a running task.
- Cancellation reliably prevents apply and stops abort-capable work.
- Existing workspaces remain compatible.
- No invalid references or unknown declarative components can persist.
- Lint, tests, type checking, production build, database migration checks, and
  browser acceptance pass.
- The trusted milestone creates the contracts required for the isolated Cloud
  Run sandbox without granting shell access in the main application.
