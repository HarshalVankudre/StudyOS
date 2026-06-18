# Workspace Agent Tools and Autonomy Design

## Summary

StudyOS will evolve its in-workspace AI agent from a fixed JSON content editor into an extensible workspace-building agent. It may use powerful internal tools and reusable skills, but all execution remains isolated from the StudyOS application, production infrastructure, secrets, and other users.

The user experience hides implementation details. Users ask for outcomes in natural language, watch an interactive “Living Story” progress experience, and receive finished changes inside their own workspace. Successful changes apply automatically and always offer one-click Undo.

## Goals

- Let the agent edit workspace content, data, layouts, styling, themes, views, and safe workspace components.
- Let the agent use internal file, shell, package, web, validation, and skill capabilities inside an isolated task sandbox.
- Keep all user-generated changes scoped to the authenticated user’s workspace.
- Make long-running work feel active and understandable without exposing code, commands, logs, filenames, or technical diffs.
- Automatically apply validated changes and provide reliable one-click Undo.
- Make future tools and skills addable through a server-side registry instead of rewriting the chat architecture.

## Non-Goals

- Giving end users access to the StudyOS repository or source code.
- Allowing workspace agents to modify or deploy the StudyOS platform.
- Executing unrestricted user-generated JavaScript in the main application.
- Giving a workspace access to production credentials, deployment systems, or another user’s data.
- Exposing a developer console, terminal, raw tool logs, or code review interface to normal users.
- Supporting multi-user workspace roles in the first version. The authenticated workspace owner is the only actor.

## User Experience

### Natural interaction

The agent accepts outcome-oriented requests such as:

- “Fix the overlapping text everywhere.”
- “Make this dashboard easier to scan.”
- “Create a revision planner for my exams.”
- “Research this topic and organize the useful information.”

The agent asks one natural clarifying question only when materially different interpretations would lead to different results. Otherwise, it begins work immediately.

### Living Story progress

While work is running, the chat displays an interactive progress card with:

- A visible overall percentage.
- A smoothly animated progress bar.
- A current, plain-language status such as “Creating more breathing room.”
- Completed discovery cards such as “I found where the dashboard was getting crowded.”
- A current milestone and a preview of what comes next.
- Rotating meaningful updates during long-running phases so the interface never appears frozen.

The progress model is grounded in real orchestration events. Phase transitions, completed validations, and applied operations advance progress. Animation may move gently within the current phase, but it must not claim that a phase completed before the backend reports completion.

User-facing phases are:

1. Understanding
2. Shaping
3. Improving
4. Checking
5. Finishing

Internal tool names, commands, file paths, package names, stack traces, and model output are never rendered to the user.

### Completion and Undo

After validation succeeds:

- The result applies automatically to the current user’s workspace.
- The conversation shows a concise description of the outcome.
- A persistent Undo action is attached to the completed agent turn.
- Undo restores the exact workspace version from immediately before that turn.

If execution or validation fails, no partial result is applied. The user receives a friendly explanation and may retry.

## Architecture

### High-level flow

1. The authenticated user submits a request with a workspace ID.
2. The server loads the workspace through the owner-scoped data layer.
3. A planner creates a private task plan and selects registered skills and tools.
4. A task sandbox receives only a sanitized workspace snapshot and the minimum contextual data needed for the task.
5. The agent uses tools automatically inside the sandbox.
6. The sandbox returns a structured workspace change set plus validation evidence.
7. The server validates permissions, schemas, references, limits, and the final workspace.
8. The server atomically creates a version snapshot and applies the new workspace.
9. The UI receives the final result and an Undo token.

### Separation of responsibilities

The system is divided into focused units:

- **Planner:** Interprets intent, decides whether clarification is necessary, selects skills, and creates user-friendly milestones.
- **Tool registry:** Defines internal tools, input schemas, capability labels, limits, and execution handlers.
- **Skill registry:** Supplies reusable server-side instructions for specialized tasks such as layout improvement, research synthesis, or study planning.
- **Sandbox runner:** Creates an isolated environment for one task, executes approved internal tools, enforces resource limits, and destroys the environment afterward.
- **Workspace change compiler:** Converts sandbox results into structured workspace operations.
- **Policy and validation layer:** Verifies ownership, operation allowlists, data shape, references, size limits, and safe component definitions.
- **Version service:** Stores before-and-after workspace snapshots and performs atomic apply or Undo.
- **Progress translator:** Converts private orchestration events into Living Story updates.

These units communicate through typed data contracts. Client components receive only sanitized progress and result events.

## Workspace Capability Model

The current workspace schema supports pages, content blocks, databases, and views. It will be extended with declarative presentation capabilities rather than arbitrary application code.

### Presentation

Workspaces may define:

- Workspace-level theme tokens.
- Page layouts and responsive sections.
- Spacing, alignment, width, hierarchy, and emphasis settings.
- Safe visual variants for existing blocks and database views.
- Reusable workspace components assembled from an approved component catalog.

### Safe components

A generated component is stored as a validated declarative component tree. Nodes reference approved renderer components and permitted properties. The renderer maps these definitions to built-in React components.

The workspace cannot store or execute:

- Arbitrary JavaScript.
- Dynamic imports.
- Raw server actions.
- Direct database queries.
- Unrestricted HTML or inline event handlers.
- Network credentials or environment variables.

This model gives the agent broad design freedom while keeping execution inside the StudyOS renderer’s safety boundary.

## Internal Tool and Skill System

### Initial tools

The internal registry will support these categories:

- Workspace inspection and structured editing.
- Layout and theme generation.
- Safe component-tree creation and modification.
- Temporary file reading and writing inside the task sandbox.
- Shell execution inside the task sandbox.
- Temporary package installation inside the task sandbox.
- Controlled web reading and research.
- Build, lint, schema, reference, and visual validation.
- Structured artifact generation for importing results into the workspace.

Tools execute automatically after a user request. The user is not asked to approve individual sandbox actions.

### Tool contract

Every tool definition includes:

- A stable tool ID.
- A private description for the planner.
- A strict input schema.
- A strict output schema.
- Resource and time limits.
- Network permissions.
- Whether output may become part of a workspace change set.
- A mapper from internal events to user-friendly progress events.

Unknown tools are rejected. Tool inputs and outputs are validated at every boundary.

### Skills

Skills are versioned server-side instruction bundles selected by the planner. Skills may guide workflows but cannot grant themselves capabilities. A skill can only call tools already enabled by server policy.

The initial skill set should cover:

- Workspace design and layout repair.
- Dashboard creation.
- Study planner creation.
- Database and view restructuring.
- Research and synthesis.
- Accessibility and readability checks.
- Final workspace quality verification.

## Sandbox Isolation

Each agent task runs in a fresh isolated sandbox with:

- A unique task identity.
- A sanitized, read-only initial workspace snapshot.
- A writable temporary filesystem available only for that task.
- CPU, memory, disk, process, output, and execution-time limits.
- Network access through an allowlisted and logged fetch layer.
- No production database connection.
- No StudyOS repository mount.
- No deployment credentials.
- No Clerk, Stripe, OpenRouter, or infrastructure secrets.
- Automatic destruction after completion, cancellation, or timeout.

Package installations are temporary and disappear with the sandbox. External writes, account actions, deployments, and arbitrary outbound messaging are unavailable.

The sandbox result is untrusted input. It cannot write directly to the workspace database; it must pass through the policy and validation layer.

## Ownership and Data Isolation

Every read, apply, history, and Undo operation re-authenticates the caller and scopes database access by both workspace ID and owner ID.

The client cannot choose another owner, submit a trusted change set, or mark validation as successful. Ownership and validation are established server-side for every request.

The sandbox receives no global user directory and no identifiers for other users’ workspaces. Cross-workspace relations are not supported.

## Applying Changes and Version History

### Atomic apply

Before applying an agent result, the server:

1. Reloads the latest owned workspace.
2. Checks that the task’s base version still matches.
3. Validates the change set and resulting workspace.
4. Writes an immutable “before” version.
5. Writes the updated workspace and an “after” version in one database transaction.

If the workspace changed concurrently, the result is not applied or automatically rebased in the first release. The user sees a friendly message that the workspace changed during the task and can retry against the latest version.

### Undo

Undo references a server-generated change ID, not client-supplied workspace JSON. The server verifies ownership and restores the associated “before” snapshot in a transaction.

Undo itself creates a new version so history remains auditable and a later redo feature remains possible.

The first release supports Undo for agent changes from the conversation in which they were made. Broader version-history browsing can be added later without changing the storage model.

## Progress Event Model

Private orchestration events include tool starts, tool completions, milestones, validations, retries, and apply status. A server-side translator emits only safe events:

- `phase_started`
- `phase_progress`
- `discovery`
- `milestone_completed`
- `applying`
- `completed`
- `failed`

Each public event contains a localized message, progress value, and optional friendly discovery. It does not contain raw tool arguments or output.

Progress is monotonic during a task. Recommended weighting:

- Understanding: 0–15%
- Shaping: 15–35%
- Improving: 35–75%
- Checking: 75–92%
- Finishing and applying: 92–100%

For an active phase, the UI may animate toward the phase ceiling but waits for a real event before crossing into the next phase.

## Error Handling

- Invalid requests fail before sandbox creation.
- Sandbox timeout, resource exhaustion, or tool failure cancels the task and discards its filesystem.
- Invalid or unsafe change sets are rejected before persistence.
- Final workspace schema or reference failures prevent apply.
- Database transaction failures preserve the previous workspace.
- Closing the chat or temporarily losing the connection does not cancel the task. Task status is retained for up to 10 minutes so the user can reconnect and receive the result. An explicit Cancel action stops the task and prevents apply.
- User-facing errors stay plain and actionable. Detailed diagnostics are logged privately with sensitive values redacted.

## Observability and Limits

The server records:

- Task ID, user ID, and workspace ID.
- Selected skill and tool IDs.
- Timing, token, sandbox, and credit usage.
- Sanitized failure categories.
- Validation outcomes.
- Apply and Undo change IDs.

Raw workspace content and external research results are not copied into general-purpose logs.

Per-plan limits control task duration, tool calls, web fetches, sandbox resources, and generated workspace size. Existing StudyOS credit behavior remains unchanged in the first release; sandbox resource limits are enforced internally and do not introduce a separate user-visible charge.

## Testing Strategy

### Unit tests

- Tool and skill registry schema validation.
- Workspace operation compilation.
- Declarative component validation.
- Progress weighting and monotonicity.
- Version creation and Undo selection.
- Redaction of internal details from public events.

### Integration tests

- Owner-scoped workspace loading and mutation.
- Sandbox result rejection when it references another workspace.
- Atomic apply with version snapshots.
- Concurrent workspace update conflict behavior.
- Undo restoring the exact previous workspace.
- Sandbox timeout and cleanup.
- Failed validation leaving persisted data unchanged.

### UI tests

- Living Story updates render in order.
- Percentage never decreases.
- Long phases continue to animate without falsely completing.
- Completion displays Undo.
- Undo restores the previous rendered workspace.
- Technical tool names, logs, commands, and file paths never appear.
- Cancellation and failure states remain understandable and usable.

### Security tests

- Attempts to access environment variables or production services fail.
- Arbitrary code cannot enter the production renderer.
- Direct object reference attacks cannot read, apply, or undo another user’s workspace.
- Forged change IDs and stale base versions are rejected.
- Network allowlists and response-size limits are enforced.

## Rollout

1. Add workspace versioning and reliable Undo around the existing agent.
2. Add the Living Story progress event model.
3. Extend the workspace schema with themes, layouts, and declarative components.
4. Introduce the internal tool and skill registries.
5. Add isolated sandbox execution behind a feature flag.
6. Enable sandbox-backed requests for internal testing.
7. Gradually release to workspace owners with monitoring and strict resource limits.

Each stage must leave the existing workspace editor usable and preserve compatibility with previously saved workspaces.

## Success Criteria

- A user can request a broad visual or structural workspace improvement without the agent refusing because it lacks layout or styling capability.
- The resulting change affects only the authenticated user’s workspace.
- The user sees an engaging, truthful Living Story progress experience with a visible percentage.
- Successful results apply automatically.
- Undo reliably restores the prior workspace.
- No source code, commands, filenames, logs, or technical diffs are exposed.
- Sandboxed work cannot access StudyOS source code, production secrets, infrastructure, or other users’ data.
- New tools and skills can be registered without redesigning the chat protocol.
