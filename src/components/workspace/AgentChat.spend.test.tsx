import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { resetCreditsBusForTests } from "@/lib/credits-bus";
import type { Workspace } from "@/lib/workspace/types";
import { AgentChat } from "./AgentChat";
import { WorkspaceProvider, type WorkspaceCtx } from "./WorkspaceContext";
import { agentEditsSetAside, keptCopyIds } from "./agentSetAside";

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./AgentUndoButton", () => ({
  AgentUndoButton: ({ changeId }: { changeId: string }) => <button data-testid={`undo-${changeId}`}>Undo</button>,
}));
vi.mock("./AgentProgressCard", () => ({ AgentProgressCard: () => null }));
// The live balance (lib/credits-bus) re-reads it from the server: never answers here.
vi.mock("@/app/app/account-actions", () => ({ getAccountSummaryAction: () => new Promise(() => {}) }));

function routeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    for (const [pattern, handler] of Object.entries(routes)) {
      const [m, path] = pattern.split(" ");
      if (m === method && url.startsWith(path)) return handler();
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

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

const inEnglish = (node: ReactNode) => (
  <I18nProvider locale="en" dictionary={en}>
    {node}
  </I18nProvider>
);

beforeEach(() => resetCreditsBusForTests());
afterEach(() => vi.unstubAllGlobals());

describe("AgentChat: the cost before sending", () => {
  it("says what a message costs, the ceiling of a long one, and the balance, under the input", () => {
    routeFetch({ "GET /api/agent/history": () => Response.json({ messages: [] }) });
    render(
      inEnglish(
        <AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} messageQuote={{ price: 3, max: 30 }} initialCredits={286} />,
      ),
    );
    expect(screen.getByTestId("agent-cost-hint")).toHaveTextContent(
      "A message costs 3 credits. A long request can cost more, never more than 30 credits. You have 286 credits.",
    );
  });

  it("says nothing it cannot back with a figure", () => {
    routeFetch({ "GET /api/agent/history": () => Response.json({ messages: [] }) });
    render(inEnglish(<AgentChat workspaceId="ws-1" onApplied={vi.fn()} onClose={vi.fn()} />));
    expect(screen.queryByTestId("agent-cost-hint")).toBeNull();
  });
});

const ws = (blocks: Array<Record<string, unknown>>): Workspace =>
  ({ id: "ws-1", name: "W", pages: [{ id: "p1", title: "FBD", blocks }], databases: [] }) as unknown as Workspace;
const before = ws([{ id: "b1", type: "paragraph", text: "[T2-start] Picture every force." }]);
const agent = ws([{ id: "b1", type: "paragraph", text: "Draw every force." }]);
// What the editor holds after replaying the student's typing on the agent's result
// (lib/workspace/changes.ts keepBothBlocks: theirs goes right after, marked).
const merged = ws([
  { id: "b1", type: "paragraph", text: "[T2-start] Picture every force. TYPED" },
  { id: "b9", type: "paragraph", text: "Draw every force.", keptFrom: "b1" },
]);

describe("agentEditsSetAside", () => {
  it("counts marked copies holding the agent's text with the student's text in place", () => {
    expect(agentEditsSetAside(keptCopyIds(before), agent, merged)).toBe(1);
  });

  it("ignores copies that were there before the turn, and clean merges", () => {
    expect(agentEditsSetAside(new Set(["b9"]), agent, merged)).toBe(0);
    expect(agentEditsSetAside(new Set(), agent, ws([{ id: "b1", type: "paragraph", text: "Draw every force. TYPED" }]))).toBe(0);
  });

  it("ignores a copy of someone else's text (another device)", () => {
    const other = ws([
      { id: "b1", type: "paragraph", text: "Draw every force." },
      { id: "b9", type: "paragraph", text: "Text from the phone", keptFrom: "b1" },
    ]);
    expect(agentEditsSetAside(new Set(), agent, other)).toBe(0);
  });
});

describe("AgentChat: an edit the merge set aside", () => {
  const ctx = (workspace: Workspace): WorkspaceCtx => ({
    workspace,
    update: vi.fn(),
    status: "saved",
    rev: 0,
    agentBusy: false,
    setAgentBusy: vi.fn(),
    settle: async () => ({ ok: true, version: 3 }),
  });

  async function runTurn(undoAfterMerge: "available" | "unavailable") {
    routeFetch({
      "GET /api/agent/history?workspaceId=ws-1&undo=1": () => Response.json({ undo: { c1: undoAfterMerge } }),
      "GET /api/agent/history": () => Response.json({ messages: [] }),
      "POST /api/agent": () =>
        resultStream({ reply: "Done. The rest of the page is unchanged.", changed: true, workspace: agent, changeId: "c1" }),
    });
    const onApplied = vi.fn();
    const chat = (workspace: Workspace, syncKey: string) =>
      inEnglish(
        <WorkspaceProvider value={ctx(workspace)}>
          <AgentChat workspaceId="ws-1" onApplied={onApplied} onClose={vi.fn()} syncKey={syncKey} />
        </WorkspaceProvider>,
      );
    const view = render(chat(before, "1:saved"));
    await userEvent.type(screen.getByRole("textbox"), "clean up the paragraph{Enter}");
    expect(await screen.findByText("Done. The rest of the page is unchanged.")).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalledWith(agent);
    // Not merged yet: nothing to correct.
    expect(screen.queryByTestId("agent-set-aside")).toBeNull();
    view.rerender(chat(merged, "2:saved"));
    return view;
  }

  it("says so under the turn and keeps Undo while the server can honour it", async () => {
    await runTurn("available");
    expect(await screen.findByTestId("agent-set-aside")).toHaveTextContent(en.spend.keptYours);
    await new Promise((resolve) => setTimeout(resolve, 1_500)); // the Undo re-check has run
    expect(screen.getByTestId("undo-c1")).toBeInTheDocument();
    expect(screen.getByTestId("agent-set-aside")).not.toHaveTextContent(en.spend.keptYoursNoUndo);
  });

  it("explains the way back when the server cannot undo it", async () => {
    await runTurn("unavailable");
    await vi.waitFor(() => expect(screen.queryByTestId("undo-c1")).toBeNull(), { timeout: 3000 });
    expect(screen.getByTestId("agent-set-aside")).toHaveTextContent(en.spend.keptYoursNoUndo);
  });
});
