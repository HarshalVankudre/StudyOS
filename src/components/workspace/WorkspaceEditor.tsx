"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { updateWorkspaceAction } from "@/app/app/actions";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useI18n } from "@/lib/i18n/client";
import type { Workspace } from "@/lib/workspace/types";
import { AccountMenu } from "@/components/account/AccountMenu";
import { CreditMeter } from "@/components/account/CreditMeter";
import { AgentChat } from "./AgentChat";
import { PageView } from "./PageView";
import { StudyLauncher } from "./StudyLauncher";
import { WorkspaceProvider, type SaveStatus } from "./WorkspaceContext";

export function WorkspaceEditor({
  id,
  initialWorkspace,
  initialCredits = 0,
}: {
  id: string;
  initialWorkspace: Workspace;
  initialCredits?: number;
}) {
  const { dict } = useI18n();
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);

  const latest = useRef(workspace);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentBusyRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    requestAnimationFrame(() => {
      if (sidebarTriggerRef.current?.offsetParent) {
        sidebarTriggerRef.current.focus();
      }
    });
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    sidebarCloseRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeSidebar, sidebarOpen]);

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
      // Suppress autosave while the agent is processing to avoid a version
      // conflict when it tries to commit its result.
      if (agentBusyRef.current) {
        pendingSaveRef.current = true;
        return;
      }
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

  // When the agent finishes, flush any save that was deferred while it was busy.
  const handleAgentBusyChange = useCallback((busy: boolean) => {
    agentBusyRef.current = busy;
    setAgentBusy(busy);
    if (!busy && pendingSaveRef.current) {
      pendingSaveRef.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try {
          await updateWorkspaceAction(id, latest.current);
          setStatus("saved");
        } catch {
          setStatus("error");
        }
      }, 300);
    }
  }, [id]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Agent apply and Undo are already persisted server-side; reflect them live.
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
        title: dict.editor.untitled,
        icon: "📄",
        blocks: [
          { id: crypto.randomUUID(), type: "heading", level: 1, text: dict.editor.untitled },
        ],
      });
    });
    setActivePageId(id);
    closeSidebar();
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
    <WorkspaceProvider value={{ workspace, update, status, rev, agentBusy, setAgentBusy: handleAgentBusyChange }}>
      <div className="flex h-[100dvh] w-full overflow-hidden bg-paper text-ink">
        {sidebarOpen && (
          <button
            type="button"
            aria-label={dict.common.cancel}
            tabIndex={-1}
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] md:hidden"
            onClick={closeSidebar}
          />
        )}

        {/* Sidebar */}
        <aside
          aria-label={workspace.name}
          className={`fixed inset-y-0 start-0 z-50 flex w-[min(20rem,85vw)] shrink-0 flex-col border-e border-line bg-surface shadow-pop transition-transform duration-200 md:static md:z-auto md:w-60 md:translate-x-0 md:shadow-none ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"
          }`}
        >
          <div className="flex min-h-12 items-center justify-between ps-4 pe-2 pt-1">
            <Link
              href="/app"
              className="flex items-center gap-1.5 font-display text-[15px] font-extrabold tracking-tight text-ink"
            >
              StudyOS
              <span className="mb-1.5 h-1 w-1 rounded-full bg-lime" aria-hidden />
            </Link>
            <button
              ref={sidebarCloseRef}
              type="button"
              onClick={closeSidebar}
              aria-label={dict.common.cancel}
              className="grid h-11 w-11 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink md:hidden"
            >
              <span aria-hidden>✕</span>
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 pb-2 pt-1">
            <input
              value={workspace.icon ?? ""}
              onChange={(e) =>
                update((d) => {
                  d.icon = e.target.value;
                })
              }
              aria-label={dict.editor.workspaceIcon}
              maxLength={8}
              className="h-8 w-8 rounded-md bg-transparent text-center text-xl outline-none hover:bg-hover focus:bg-card focus:ring-1 focus:ring-ink/20"
            />
            <input
              value={workspace.name}
              aria-label={workspace.name}
              onChange={(e) =>
                update((d) => {
                  d.name = e.target.value;
                })
              }
              className="w-full truncate rounded-md px-1 py-0.5 font-display text-sm font-bold text-ink outline-none hover:bg-hover focus:bg-card focus:ring-1 focus:ring-ink/20"
            />
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
            {workspace.pages.map((page) => {
              const active = page.id === activePage?.id;
              return (
                <div key={page.id} className="group flex items-center">
                  <button
                    onClick={() => {
                      setActivePageId(page.id);
                      closeSidebar();
                    }}
                    className={`flex min-h-11 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition ${
                      active
                        ? "bg-hover font-medium text-ink"
                        : "text-ink-soft hover:bg-hover"
                    }`}
                  >
                    <span className="w-5 text-center">{page.icon}</span>
                    <span className="truncate">{page.title}</span>
                  </button>
                  {workspace.pages.length > 1 && (
                    <button
                      onClick={() => deletePage(page.id)}
                      title={dict.editor.deletePage}
                      aria-label={`${dict.editor.deletePage}: ${page.title}`}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft/70 opacity-0 transition hover:bg-hover hover:text-rose-500 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      <span aria-hidden>✕</span>
                    </button>
                  )}
                </div>
              );
            })}
            <button
              onClick={addPage}
              className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-ink-soft transition hover:bg-hover hover:text-ink"
            >
              <span className="w-5 text-center">+</span>
              <span>{dict.editor.newPage}</span>
            </button>
          </nav>

          <Link
            href="/app"
            className="border-t border-line px-4 py-2.5 text-xs text-ink-soft transition hover:bg-hover hover:text-ink"
          >
            {dict.editor.allWorkspaces}
          </Link>

          <div className="flex min-h-12 items-center gap-2 border-t border-line px-3 py-2">
            <CreditMeter initial={initialCredits} />
            <span className="ms-auto flex items-center gap-1">
              <ThemeToggle />
              <LanguageSwitcher compact />
            </span>
          </div>

          <AccountMenu />
        </aside>

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-14 items-center gap-2 border-b border-line px-2 sm:px-4 lg:px-6">
            <button
              ref={sidebarTriggerRef}
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label={workspace.name}
              aria-expanded={sidebarOpen}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-lg text-ink-soft transition hover:bg-hover hover:text-ink md:hidden"
            >
              <span aria-hidden>☰</span>
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden font-mono text-[11px] text-ink-faint">
              <span className="hidden truncate sm:inline">
                {workspace.icon} {workspace.name}
              </span>
              <span className="hidden sm:inline">/</span>
              <span className="truncate text-ink-soft">
                {activePage?.icon} {activePage?.title}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <StudyLauncher />
              <button
                onClick={() => {
                  setAiOpen((v) => {
                    if (!v && timer.current) {
                      // Opening the agent panel — flush any pending save
                      // immediately so the DB version matches before the
                      // agent reads it.
                      clearTimeout(timer.current);
                      timer.current = null;
                      void updateWorkspaceAction(id, latest.current).then(
                        () => setStatus("saved"),
                        () => setStatus("error"),
                      );
                    }
                    return !v;
                  });
                }}
                aria-pressed={aiOpen}
                aria-label={aiOpen ? dict.editor.closeAgent : dict.editor.askAi}
                className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border px-2 text-xs font-semibold transition sm:min-h-0 sm:min-w-0 sm:px-3.5 sm:py-1.5 ${
                  aiOpen
                    ? "border-lime bg-lime-faint text-ink"
                    : "border-line-strong bg-card text-ink hover:bg-hover"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
                <span className="hidden sm:inline">
                  {aiOpen ? dict.editor.closeAgent : dict.editor.askAi}
                </span>
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
            onBusyChange={handleAgentBusyChange}
          />
        )}
      </div>
    </WorkspaceProvider>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const { dict } = useI18n();
  const label =
    status === "saving"
      ? dict.editor.saving
      : status === "error"
        ? dict.editor.saveFailed
        : dict.editor.saved;
  return (
    <span
      role="status"
      aria-label={label}
      className={`flex min-h-11 items-center gap-1.5 px-1 text-xs sm:min-h-0 sm:px-0 ${status === "error" ? "text-rose-500" : "text-ink-soft"}`}
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
      <span className="hidden lg:inline">{label}</span>
    </span>
  );
}
