# Agent Thinking and Immediate Stop Design

**Status:** Approved in chat on 2026-06-21.

## Goal

Make the in-workspace AI agent show its live model-provided thinking in every
runtime mode and provide a Stop task control that interrupts active work,
records cancellation durably, and guarantees that no cancelled result is
applied to the workspace.

## Current behavior and root causes

- The UI and authentic tool-loop already understand `thinking` stream events,
  but only the `AUTHENTIC_AGENT=1` path emits them. The legacy path uses
  non-streaming model calls, so the default/unset flag produces no thinking.
- The current Cancel text aborts the browser response and marks the durable task
  cancelled. It does not propagate an abort signal into an active OpenRouter
  request or tool handler, so server work may continue until the next final
  cancellation check.
- A cancellation request can reach a different server instance from the active
  agent request. An in-memory abort registry alone therefore cannot provide a
  reliable stop guarantee.

## User experience

While a task is running, the progress card displays:

- live model-provided thinking as a capped, scrolling text region;
- the existing real phase, plan, area, discovery, and progress information;
- a prominent `Stop task` button instead of the small generic Cancel action.

After the user presses Stop:

1. The control changes to `Stopping…` and cannot be pressed again.
2. The client requests durable cancellation and keeps the progress card visible
   until cancellation is acknowledged.
3. The active response stream is closed locally after acknowledgement.
4. The progress card is removed and the conversation shows `Task stopped.`
5. The input becomes available for a new request.

If cancellation cannot be confirmed, the UI reports that stopping failed and
keeps the task state recoverable instead of falsely claiming that it stopped.

## Architecture

### Shared model streaming

Both agent engines use the same streaming OpenRouter boundary:

- The authentic loop continues using `streamChatCompletion`.
- The legacy planner and editor switch from `chatCompletion` to
  `streamChatCompletion`.
- Planner reasoning emits `thinking` events in the `planning` phase.
- Editor/tool-loop reasoning emits `thinking` events in the `updating` phase.
- Visible JSON output is still accumulated server-side and parsed only after the
  model turn finishes, so existing schemas and apply behavior remain unchanged.

The `AUTHENTIC_AGENT` flag continues to control which orchestration engine runs;
it no longer controls whether thinking is visible.

### Cancellation signal

Each running task owns one server-side `AbortController`. Its signal is passed
through every abort-capable boundary:

- legacy planner and editor model calls;
- authentic-loop model calls;
- tool registry execution context;
- controlled network fetches;
- tool timeout handling.

The orchestrators check cancellation before and after each model call, tool
call, validation step, and immediately before apply. Abort errors are classified
as cancellation, not as agent failures.

### Same-instance and cross-instance cancellation

The active server process registers the task controller in a small in-memory
registry keyed by task ID. The cancel route performs two actions:

1. conditionally changes the owner-scoped durable task from `running` to
   `cancelled`;
2. aborts a matching local controller when the active run is on the same
   instance.

To cover a cancel request routed to another instance, the active run also uses a
short-lived cancellation watcher that checks the durable task status at a
bounded interval while model/tool work is active. When it observes
`cancelled`, it aborts the same task controller. The watcher is stopped and the
registry entry is removed in a `finally` block.

This gives fast same-instance cancellation and reliable cross-instance
cancellation without introducing new infrastructure.

### Durable state and apply safety

`cancelled` remains a terminal task state:

- `markTaskDone` and `markTaskError` must only update a `running` task.
- No result is charged, persisted as done, or applied after cancellation.
- The existing pre-apply cancellation check remains as defense in depth.
- A cancelled run emits no generic error message.

The cancel endpoint returns an explicit outcome so the client can distinguish
`cancelled`, `already_finished`, and failure conditions.

## Component boundaries

- `openrouter.ts`: streaming content/reasoning and external abort support.
- `agent.ts`: legacy planner/editor streaming options.
- `agent-loop.ts`: external cancellation signal and cancellation checks.
- `tools/registry.ts`: task signal in `ToolContext`, timeout enforcement, and
  abort propagation.
- task cancellation service/registry: local controller registration plus the
  bounded durable-status watcher.
- agent route: creates and owns the task controller, emits thinking for both
  engines, and handles cancellation as a normal terminal path.
- cancel route: durable cancel first, then best-effort local abort.
- `AgentChat.tsx`: stopping state, acknowledgement flow, and stopped message.
- `AgentProgressCard.tsx`: prominent Stop task control and accessible labels.
- dictionaries: localized `Stop task`, `Stopping…`, `Task stopped`, and stop
  failure messages.

## Error handling

- User cancellation is not logged or rendered as an agent error.
- Deadline aborts remain distinct from user cancellation so existing graceful
  budget behavior is preserved.
- Network/model/tool failures continue through the existing safe error path.
- Reconnect returns `cancelled`; the client renders the stopped terminal state
  instead of trying to recover a result.
- Closing the chat remains different from Stop: closing the panel may detach the
  client, while explicit Stop cancels the durable task.

## Testing

### Unit

- Legacy planner and editor forward streamed reasoning and an abort signal.
- Authentic-loop model calls abort when the task signal aborts.
- Tool execution combines task cancellation with the tool timeout.
- Durable cancellation cannot later transition to done or error.
- Cross-instance watcher aborts when durable status becomes `cancelled`.
- Thinking reduction remains capped and does not change progress.

### UI

- A thinking event renders the Thinking region.
- Stop task calls the cancel endpoint, shows `Stopping…`, and aborts the local
  stream only after acknowledgement.
- Confirmed cancellation shows `Task stopped.` and re-enables input.
- Failed cancellation does not claim success.

### Integration and browser acceptance

- Verify thinking with `AUTHENTIC_AGENT=0` and `AUTHENTIC_AGENT=1`.
- Stop during planning and during updating; the upstream request ends promptly.
- Confirm the workspace version and content do not change after either stop.
- Confirm a completed task cannot be retroactively marked cancelled.
- Confirm close/reopen still recovers running and completed tasks correctly.

## Non-goals

- Removing the legacy agent engine.
- Persisting or replaying high-frequency thinking text.
- Adding a queue, Redis pub/sub, or a separate worker.
- Showing private prompts, tool arguments, raw observations, secrets, or logs.

