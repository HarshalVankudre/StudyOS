import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentChat } from "./AgentChat";

// The live balance (lib/credits-bus) re-reads it from the server: never answers here.
vi.mock("@/app/app/account-actions", () => ({ getAccountSummaryAction: () => new Promise(() => {}) }));

beforeAll(() => {
  // jsdom doesn't implement Element.scrollTo; AgentChat auto-scrolls on update.
  Element.prototype.scrollTo = vi.fn();
});

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./AgentUndoButton", () => ({
  AgentUndoButton: ({ changeId }: { changeId: string }) => (
    <button data-testid={`undo-${changeId}`}>Undo</button>
  ),
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
        other: "Other",
        otherPlaceholder: "Type your own answer…",
        otherLabel: "Type another answer",
        clearChat: "Clear conversation",
        clearConfirm: "Clear this conversation?",
        clearConfirmYes: "Clear",
        clearCancel: "Cancel",
        clearFailed: "Could not clear",
        stoppedAtLimit: "Stopped at limit",
      },
      credits: { turnCostTitle: "Cost" },
      spend: {
        agentTurn: "A request usually uses about {cost}. You have {balance}.",
        keptYours: "Your typing was kept; the assistant’s version is in a marked copy below it.",
        keptYoursNoUndo: "Undo isn’t possible for this turn.",
      },
      counts: { credits: { one: "{count} credit", other: "{count} credits" } },
    },
    t: (template: string, values: Record<string, unknown>) =>
      template.replace(/\{(\w+)\}/g, (_m, key: string) => String(values[key])),
    plural: (forms: { one: string; other: string }, count: number) =>
      (count === 1 ? forms.one : forms.other).replace("{count}", String(count)),
  }),
}));

/** Route fetches by URL; unmatched calls fail the test loudly. */
function routeFetch(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    for (const [pattern, handler] of Object.entries(routes)) {
      const [m, path] = pattern.split(" ");
      if (m === method && url.startsWith(path)) return handler(init);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

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
    const fetchMock = routeFetch({
      "GET /api/agent/history": () => Response.json({ messages: [] }),
      "POST /api/agent/task/task-1/cancel": () =>
        Response.json({ status: "cancelled", interrupted: true }),
      "POST /api/agent": () => new Response(stream),
    });

    render(
      <AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("complementary", { name: "AI agent" })).toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("textbox", { name: "Ask the agent…" })).toHaveAttribute(
      "aria-describedby",
    );
    await userEvent.type(
      screen.getByPlaceholderText("Ask the agent…"),
      "rename home",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Stop task" }),
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/task/task-1/cancel", {
      method: "POST",
    });
    expect(await screen.findByText("Task stopped.")).toBeInTheDocument();
    streamController.close();
  });
});

function resultStream(response: Record<string, unknown>): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"task","taskId":"task-9"}\n'));
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "result", response })}\n`));
        controller.close();
      },
    }),
  );
}

describe("AgentChat memory", () => {
  it("restores the stored conversation with Undo only where the server can honour it", async () => {
    routeFetch({
      "GET /api/agent/history": () =>
        Response.json({
          messages: [
            { id: "m1", role: "user", content: "add a quiz friday", createdAt: "2026-11-12T00:00:00Z" },
            { id: "m2", role: "assistant", content: "Added the quiz.", changed: true, changeId: "c-old", undo: "unavailable", createdAt: "2026-11-12T00:00:01Z" },
            { id: "m3", role: "user", content: "sort by due date", createdAt: "2026-11-12T00:00:02Z" },
            { id: "m4", role: "assistant", content: "Sorted.", changed: true, changeId: "c-new", undo: "available", creditsCost: 1, createdAt: "2026-11-12T00:00:03Z" },
            { id: "m5", role: "assistant", content: "Renamed.", changed: true, changeId: "c-undone", undo: "undone", creditsCost: 2, createdAt: "2026-11-12T00:00:04Z" },
          ],
        }),
    });
    render(<AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText("Added the quiz.")).toBeInTheDocument();
    expect(screen.getByText("sort by due date")).toBeInTheDocument();
    expect(screen.getByTestId("undo-c-new")).toBeInTheDocument();
    expect(screen.queryByTestId("undo-c-old")).not.toBeInTheDocument();
    expect(screen.queryByTestId("undo-c-undone")).not.toBeInTheDocument();
    expect(screen.getByText("Undone")).toBeInTheDocument();
    expect(screen.getByText("2 credits")).toBeInTheDocument();
    // A one-credit turn reads "1 credit", never "1 credits".
    expect(screen.getByText("1 credit")).toBeInTheDocument();
  });

  it("re-checks Undo when the workspace is saved again and hides a stale one", async () => {
    let undoState = "available";
    routeFetch({
      "GET /api/agent/history?workspaceId=ws-1&undo=1": () =>
        Response.json({ undo: { "c-1": undoState } }),
      "GET /api/agent/history": () =>
        Response.json({
          messages: [
            { id: "m1", role: "assistant", content: "Done.", changed: true, changeId: "c-1", undo: "available", createdAt: "2026-11-12T00:00:00Z" },
          ],
        }),
    });
    const { rerender } = render(
      <AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} syncKey="1:saved" />,
    );
    expect(await screen.findByTestId("undo-c-1")).toBeInTheDocument();
    undoState = "unavailable";
    rerender(
      <AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} syncKey="2:saved" />,
    );
    await vi.waitFor(() => expect(screen.queryByTestId("undo-c-1")).not.toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it("sends the student's time zone and the choice label as display text", async () => {
    const fetchMock = routeFetch({
      "GET /api/agent/history": () =>
        Response.json({
          messages: [
            {
              id: "m1", role: "assistant", content: "Which course?",
              choices: [{ id: "a", label: "Chemistry", value: "the CHEM110 course" }],
              createdAt: "2026-11-12T00:00:00Z",
            },
          ],
        }),
      "POST /api/agent": () => resultStream({ reply: "Done.", changed: false }),
    });
    render(<AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: /Chemistry/ }));

    const call = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/agent" && init?.method === "POST");
    const body = JSON.parse(String(call![1]!.body));
    expect(body.message).toBe("the CHEM110 course");
    expect(body.displayText).toBe("Chemistry");
    expect(body.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(await screen.findByText("Done.")).toBeInTheDocument();
  });

  it("asks before clearing, then forgets the conversation", async () => {
    const fetchMock = routeFetch({
      "GET /api/agent/history": () =>
        Response.json({
          messages: [{ id: "m1", role: "user", content: "hello there", createdAt: "2026-11-12T00:00:00Z" }],
        }),
      "DELETE /api/agent/history": () => Response.json({ cleared: 1 }),
    });
    render(<AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("hello there")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    // Nothing is deleted until the student confirms.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("hello there")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await vi.waitFor(() => expect(screen.queryByText("hello there")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/history?workspaceId=ws-1", { method: "DELETE" });
  });

  it("shows an up-front refusal (not enough credits) as the agent's answer", async () => {
    const encoder = new TextEncoder();
    routeFetch({
      "GET /api/agent/history": () => Response.json({ messages: [] }),
      "POST /api/agent": () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  '{"type":"error","code":"insufficient_credits","message":"This request needs about 4 credits and you have 1."}\n',
                ),
              );
              controller.close();
            },
          }),
        ),
    });
    render(<AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText("Ask the agent…"), "plan my finals");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByText("This request needs about 4 credits and you have 1."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Could not complete")).not.toBeInTheDocument();
  });

  it("marks a turn that stopped at its limit", async () => {
    routeFetch({
      "GET /api/agent/history": () => Response.json({ messages: [] }),
      "POST /api/agent": () =>
        resultStream({ reply: "I stopped before finishing.", changed: false, stopReason: "budget" }),
    });
    render(<AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText("Ask the agent…"), "plan everything");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Stopped at limit")).toBeInTheDocument();
  });
});

describe("AgentChat waits for pending saves", () => {
  it("settles the editor's saves first and sends the version it then holds", async () => {
    const { WorkspaceProvider } = await import("./WorkspaceContext");
    const order: string[] = [];
    const settle = vi.fn(async () => {
      order.push("settle");
      return { ok: true, version: 42 };
    });
    const fetchMock = routeFetch({
      "GET /api/agent/history": () => Response.json({ messages: [] }),
      "POST /api/agent": () => {
        order.push("agent");
        return resultStream({ reply: "Done.", changed: false });
      },
    });
    const ctx = {
      workspace: {} as never,
      update: vi.fn(),
      status: "saving" as const,
      rev: 0,
      agentBusy: false,
      setAgentBusy: vi.fn(),
      settle,
      getVersion: () => 41,
    };
    render(
      <WorkspaceProvider value={ctx}>
        <AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} />
      </WorkspaceProvider>,
    );
    await userEvent.type(screen.getByPlaceholderText("Ask the agent…"), "add a quiz");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(order).toEqual(["settle", "agent"]);
    const call = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/agent" && init?.method === "POST");
    expect(JSON.parse(String(call![1]!.body)).baseVersion).toBe(42);
  });

  it("pauses the editor's autosave only once its pending saves are written", async () => {
    const { WorkspaceProvider } = await import("./WorkspaceContext");
    const order: string[] = [];
    let finishSettle!: () => void;
    const settle = vi.fn(
      () =>
        new Promise<{ ok: boolean; version: number }>((resolve) => {
          finishSettle = () => {
            order.push("settled");
            resolve({ ok: true, version: 7 });
          };
        }),
    );
    const encoder = new TextEncoder();
    let agentStream!: ReadableStreamDefaultController<Uint8Array>;
    routeFetch({
      "GET /api/agent/history": () => Response.json({ messages: [] }),
      "POST /api/agent": () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              agentStream = controller;
            },
          }),
        ),
    });
    const onBusyChange = vi.fn((busy: boolean) => order.push(`busy:${busy}`));
    const ctx = {
      workspace: {} as never,
      update: vi.fn(),
      status: "saving" as const,
      rev: 0,
      agentBusy: false,
      setAgentBusy: vi.fn(),
      settle,
      getVersion: () => 6,
    };
    render(
      <WorkspaceProvider value={ctx}>
        <AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} onBusyChange={onBusyChange} />
      </WorkspaceProvider>,
    );
    await userEvent.type(screen.getByPlaceholderText("Ask the agent…"), "add a quiz");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await vi.waitFor(() => expect(settle).toHaveBeenCalled());
    // While the saves are being written, the editor is not paused.
    expect(onBusyChange).not.toHaveBeenCalledWith(true);
    finishSettle();
    // While the agent works, autosave is paused.
    await vi.waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
    agentStream.enqueue(
      encoder.encode(`${JSON.stringify({ type: "result", response: { reply: "Done.", changed: false } })}\n`),
    );
    agentStream.close();
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    await vi.waitFor(() => expect(order.at(-1)).toBe("busy:false"));
    // Mount reports "not busy"; the pause starts after the saves settled.
    expect(order).toEqual(["busy:false", "settled", "busy:true", "busy:false"]);
  });

  it("shows a refusal when the agent's work overlapped edits made during the task", async () => {
    const encoder = new TextEncoder();
    routeFetch({
      "GET /api/agent/history": () => Response.json({ messages: [] }),
      "POST /api/agent": () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('{"type":"task","taskId":"task-3"}\n'));
              controller.enqueue(
                encoder.encode(
                  '{"type":"error","code":"workspace_conflict","message":"The same part was edited elsewhere. Nothing was charged."}\n',
                ),
              );
              controller.close();
            },
          }),
        ),
    });
    render(<AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText("Ask the agent…"), "rename home");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByText("The same part was edited elsewhere. Nothing was charged."),
    ).toBeInTheDocument();
    // A clear answer, not a generic failure, and no attempt to recover the task.
    expect(screen.queryByText("Could not complete")).not.toBeInTheDocument();
  });
});
