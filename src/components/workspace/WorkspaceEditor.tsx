"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { updateWorkspaceAction } from "@/app/app/actions";
import type { Workspace } from "@/lib/workspace/types";
import { AgentChat } from "./AgentChat";
import { PageView } from "./PageView";
import { WorkspaceProvider, type SaveStatus } from "./WorkspaceContext";

export function WorkspaceEditor({
  id,
  initialWorkspace,
}: {
  id: string;
  initialWorkspace: Workspace;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [activePageId, setActivePageId] = useState(
    initialWorkspace.homePageId ?? initialWorkspace.pages[0]?.id,
  );
  const [status, setStatus] = useState<SaveStatus>("saved");
  // Bumped only when the AI swaps in a whole new workspace, so uncontrolled
  // inputs remount with its values (see WorkspaceCtx.rev).
  const [rev, setRev] = useState(0);

  // AI agent chat panel
  const [aiOpen, setAiOpen] = useState(false);

  const latest = useRef(workspace);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(
    (mutator: (draft: Workspace) => void) => {
      setWorkspace((prev) => {
        const next = structuredClone(prev);
        mutator(next);
        latest.current = next;
        return next;
      });
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try {
          await updateWorkspaceAction(id, latest.current);
          setStatus("saved");
        } catch {
          setStatus("error");
        }
      }, 800);
    },
    [id],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // The agent already persisted the new workspace server-side; reflect it live.
  const applyAgentWorkspace = useCallback((updated: Workspace) => {
    if (timer.current) clearTimeout(timer.current);
    latest.current = updated;
    setWorkspace(updated);
    setRev((r) => r + 1); // remount uncontrolled inputs onto the agent's values
    setStatus("saved");
    setActivePageId((prev) =>
      updated.pages.some((p) => p.id === prev)
        ? prev
        : (updated.homePageId ?? updated.pages[0]?.id),
    );
  }, []);

  const addPage = () => {
    const id = crypto.randomUUID();
    update((d) => {
      d.pages.push({
        id,
        title: "Untitled",
        icon: "📄",
        blocks: [
          { id: crypto.randomUUID(), type: "heading", level: 1, text: "Untitled" },
        ],
      });
    });
    setActivePageId(id);
  };

  const deletePage = (pageId: string) => {
    if (workspace.pages.length <= 1) return;
    const remaining = workspace.pages.filter((p) => p.id !== pageId);
    update((d) => {
      d.pages = d.pages.filter((p) => p.id !== pageId);
      if (d.homePageId === pageId) d.homePageId = remaining[0]?.id;
    });
    if (activePageId === pageId) setActivePageId(remaining[0]?.id);
  };

  const activePage =
    workspace.pages.find((p) => p.id === activePageId) ?? workspace.pages[0];

  return (
    <WorkspaceProvider value={{ workspace, update, status, rev }}>
      <div className="flex h-screen w-full overflow-hidden bg-white text-ink">
        {/* Sidebar */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-ink/10 bg-paper">
          <div className="flex items-center gap-2 px-3 py-4">
            <input
              value={workspace.icon ?? ""}
              onChange={(e) =>
                update((d) => {
                  d.icon = e.target.value;
                })
              }
              aria-label="Workspace icon"
              maxLength={8}
              className="w-8 rounded bg-transparent text-center text-xl outline-none hover:bg-ink/5 focus:bg-white focus:ring-1 focus:ring-ink/20"
            />
            <input
              value={workspace.name}
              onChange={(e) =>
                update((d) => {
                  d.name = e.target.value;
                })
              }
              className="w-full truncate rounded px-1 py-0.5 font-display text-sm font-bold text-ink outline-none hover:bg-ink/5 focus:bg-white focus:ring-1 focus:ring-ink/20"
            />
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
            {workspace.pages.map((page) => {
              const active = page.id === activePage?.id;
              return (
                <div key={page.id} className="group flex items-center">
                  <button
                    onClick={() => setActivePageId(page.id)}
                    className={`flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                      active
                        ? "bg-ink/[0.08] font-medium text-ink"
                        : "text-ink-soft hover:bg-ink/5"
                    }`}
                  >
                    <span className="w-5 text-center">{page.icon}</span>
                    <span className="truncate">{page.title}</span>
                  </button>
                  {workspace.pages.length > 1 && (
                    <button
                      onClick={() => deletePage(page.id)}
                      title="Delete page"
                      className="px-1.5 text-ink-soft/40 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            <button
              onClick={addPage}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-soft transition hover:bg-ink/5 hover:text-ink"
            >
              <span className="w-5 text-center">+</span>
              <span>New page</span>
            </button>
          </nav>

          <Link
            href="/app"
            className="border-t border-ink/10 px-4 py-3 text-xs text-ink-soft transition hover:bg-ink/5 hover:text-ink"
          >
            ← All workspaces
          </Link>
        </aside>

        {/* Main */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink/10 px-6 py-2.5">
            <div className="flex items-center gap-1.5 text-sm text-ink-soft">
              <span>
                {workspace.icon} {workspace.name}
              </span>
              <span>/</span>
              <span className="text-ink">
                {activePage?.icon} {activePage?.title}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAiOpen((v) => !v)}
                aria-pressed={aiOpen}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                  aiOpen
                    ? "bg-ink/10 text-ink hover:bg-ink/15"
                    : "bg-ink text-paper hover:bg-ink/90"
                }`}
              >
                <span className="text-[13px] leading-none">✦</span>
                {aiOpen ? "Close agent" : "Ask AI"}
              </button>
              <SaveIndicator status={status} />
            </div>
          </div>

          <div className="relative flex-1 overflow-y-auto">
            {activePage && <PageView page={activePage} />}
          </div>
        </main>

        {aiOpen && (
          <AgentChat
            workspaceId={id}
            onApplied={applyAgentWorkspace}
            onClose={() => setAiOpen(false)}
          />
        )}
      </div>
    </WorkspaceProvider>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const label =
    status === "saving" ? "Saving…" : status === "error" ? "Save failed" : "Saved";
  return (
    <span
      className={`flex items-center gap-1.5 text-xs ${status === "error" ? "text-rose-500" : "text-ink-soft"}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "saving"
            ? "bg-amber-400"
            : status === "error"
              ? "bg-rose-500"
              : "bg-emerald-500"
        }`}
      />
      {label}
    </span>
  );
}
