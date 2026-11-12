"use client";

import Link from "next/link";
import { Redo2, RotateCw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Toaster } from "@/components/ui/sonner";
import { useI18n } from "@/lib/i18n/client";
import type { Removal } from "@/lib/workspace/history";
import type { Workspace } from "@/lib/workspace/types";
import { AccountMenu } from "@/components/account/AccountMenu";
import { CreditMeter } from "@/components/account/CreditMeter";
import { AgentChat } from "./AgentChat";
import { PageView } from "./PageView";
import { StudyLauncher } from "./StudyLauncher";
import { WorkspaceProvider, type SaveStatus } from "./WorkspaceContext";
import { focusedFieldKey, isTextEntry, useWorkspaceSync } from "./useWorkspaceSync";
import type { Conflict, Notice } from "./workspace-sync";

const TOAST_MS = 8000;

export function WorkspaceEditor({
  id,
  initialWorkspace,
  initialVersion = 1,
  initialCredits = 0,
}: {
  id: string;
  initialWorkspace: Workspace;
  /** The saved version `initialWorkspace` was read at (for conflict checks). */
  initialVersion?: number;
  initialCredits?: number;
}) {
  const { dict, t, dir } = useI18n();
  const S = dict.safety;
  const [activePageId, setActivePageId] = useState(
    initialWorkspace.homePageId ?? initialWorkspace.pages[0]?.id,
  );

  // AI agent chat panel. Once opened it stays mounted (hidden when closed) so
  // a running task keeps streaming and its result still lands in the editor.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMounted, setAiMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const aiOpenRef = useRef(false);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);

  const removalMessage = useCallback(
    (removal: Removal): string => {
      const many = removal.count > 1;
      switch (removal.kind) {
        case "page":
          return many
            ? t(S.removedPages, { count: removal.count })
            : t(S.removedPage, { name: removal.name || dict.editor.untitled });
        case "database":
          return S.removedDatabase;
        case "block":
          return many ? t(S.removedBlocks, { count: removal.count }) : S.removedBlock;
        case "column":
          return S.removedColumn;
        case "row":
          return many ? t(S.removedRows, { count: removal.count }) : S.removedRow;
        case "columnData":
          return S.removedColumnData;
        case "card":
          return many ? t(S.removedCards, { count: removal.count }) : S.removedCard;
      }
    },
    [S, dict.editor.untitled, t],
  );

  // Declared before use by the toast callbacks via a ref (the engine is
  // created on first render).
  const undoToRef = useRef<(entryId: number) => void>(() => {});

  const { sync, snapshot } = useWorkspaceSync(id, initialWorkspace, initialVersion, {
    onRemoval: (removal, entryId) => {
      toast(removalMessage(removal), {
        duration: TOAST_MS,
        action: { label: S.undo, onClick: () => undoToRef.current(entryId) },
      });
    },
    onNotice: (notice: Notice) => {
      toast(notice === "draftRestored" ? S.draftRestored : S.updatedElsewhere, {
        duration: TOAST_MS,
      });
    },
  });
  const { workspace, rev, status, canUndo, canRedo, conflict } = snapshot;

  const update = useCallback(
    (mutator: (draft: Workspace) => void) => sync.update(mutator, focusedFieldKey()),
    [sync],
  );

  // After undo/redo, follow a page that came back (e.g. undoing a delete).
  const followRestoredPage = useCallback(
    (before: Workspace) => {
      const known = new Set(before.pages.map((p) => p.id));
      const restored = sync.workspace.pages.find((p) => !known.has(p.id));
      if (restored) setActivePageId(restored.id);
    },
    [sync],
  );

  const undo = useCallback(() => {
    const before = sync.workspace;
    if (sync.undo()) followRestoredPage(before);
  }, [followRestoredPage, sync]);

  const redo = useCallback(() => {
    const before = sync.workspace;
    if (sync.redo()) followRestoredPage(before);
  }, [followRestoredPage, sync]);

  useEffect(() => {
    undoToRef.current = (entryId: number) => {
      const before = sync.workspace;
      if (sync.undoTo(entryId)) followRestoredPage(before);
    };
  }, [followRestoredPage, sync]);

  // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (and Ctrl+Y). Inside a text field the
  // browser's own text undo runs instead; dialogs (study sessions) are left
  // alone.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey);
      if (!isUndo && !isRedo) return;
      if (isTextEntry(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) {
        return;
      }
      event.preventDefault();
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, undo]);

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

  const openAi = useCallback(() => {
    // Save pending edits first so the agent reads the latest workspace.
    void sync.flush();
    aiOpenRef.current = true;
    setAiMounted(true);
    setAiOpen(true);
  }, [sync]);

  const closeAi = useCallback(() => {
    aiOpenRef.current = false;
    setAiOpen(false);
  }, []);

  // Autosave pauses while the agent works; when it finishes, the editor
  // re-reads the saved workspace and replays edits made meanwhile on top.
  const agentBusyRef = useRef(false);
  const handleAgentBusyChange = useCallback(
    (busy: boolean) => {
      const was = agentBusyRef.current;
      agentBusyRef.current = busy;
      setAgentBusy(busy);
      sync.setAgentBusy(busy);
      if (was && !busy && !aiOpenRef.current) {
        toast(S.agentFinished, {
          duration: TOAST_MS,
          action: { label: S.view, onClick: openAi },
        });
      }
    },
    [S.agentFinished, S.view, openAi, sync],
  );

  // Agent apply and its Undo are persisted server-side; fetch the saved
  // result (with its version) rather than trusting a possibly stale copy.
  const applyAgentWorkspace = useCallback(() => {
    void sync.resync();
  }, [sync]);

  const addPage = () => {
    const pageId = crypto.randomUUID();
    update((d) => {
      d.pages.push({
        id: pageId,
        title: dict.editor.untitled,
        icon: "📄",
        blocks: [
          { id: crypto.randomUUID(), type: "heading", level: 1, text: dict.editor.untitled },
        ],
      });
    });
    setActivePageId(pageId);
    closeSidebar();
  };

  // No confirm: the page can be brought back from the Undo toast or Ctrl+Z.
  const deletePage = (pageId: string) => {
    if (workspace.pages.length <= 1) return;
    const remaining = workspace.pages.filter((p) => p.id !== pageId);
    update((d) => {
      if (d.pages.length <= 1) return;
      d.pages = d.pages.filter((p) => p.id !== pageId);
      if (d.homePageId === pageId) d.homePageId = d.pages[0]?.id;
    });
    if (activePageId === pageId) setActivePageId(remaining[0]?.id);
  };

  const activePage =
    workspace.pages.find((p) => p.id === activePageId) ?? workspace.pages[0];

  return (
    <WorkspaceProvider
      value={{
        workspace,
        update,
        status,
        rev,
        agentBusy,
        setAgentBusy: handleAgentBusyChange,
        undo,
        redo,
        canUndo,
        canRedo,
      }}
    >
      <Toaster dir={dir} position="bottom-center" />
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
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft/70 transition hover:bg-hover hover:text-rose-500 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
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
          <div className="flex min-h-14 items-center gap-1 border-b border-line px-2 sm:gap-2 sm:px-4 lg:px-6">
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
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <div role="group" aria-label={S.history} className="flex items-center">
                <HistoryButton
                  label={S.undo}
                  shortcut="Ctrl+Z"
                  disabled={!canUndo}
                  onClick={undo}
                  icon={<Undo2 className="h-4 w-4 rtl:-scale-x-100" aria-hidden />}
                />
                <HistoryButton
                  label={S.redo}
                  shortcut="Ctrl+Shift+Z"
                  disabled={!canRedo}
                  onClick={redo}
                  icon={<Redo2 className="h-4 w-4 rtl:-scale-x-100" aria-hidden />}
                />
              </div>
              <StudyLauncher />
              <button
                onClick={() => (aiOpen ? closeAi() : openAi())}
                aria-pressed={aiOpen}
                aria-label={
                  aiOpen
                    ? dict.editor.closeAgent
                    : agentBusy
                      ? S.agentWorking
                      : dict.editor.askAi
                }
                className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border px-2 text-xs font-semibold transition sm:min-h-0 sm:min-w-0 sm:px-3.5 sm:py-1.5 ${
                  aiOpen
                    ? "border-lime bg-lime-faint text-ink"
                    : "border-line-strong bg-card text-ink hover:bg-hover"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full bg-lime ${agentBusy ? "animate-pulse" : ""}`}
                  aria-hidden
                />
                <span className="hidden sm:inline">
                  {aiOpen ? dict.editor.closeAgent : dict.editor.askAi}
                </span>
              </button>
              <SaveIndicator status={status} onRetry={() => sync.retry()} />
            </div>
          </div>

          {conflict && (
            <ConflictBanner
              conflict={conflict}
              onKeepMine={() => sync.resolveConflict("mine")}
              onUseLatest={() => sync.resolveConflict("theirs")}
            />
          )}
          {(status === "tooLarge" || status === "gone") && (
            <div
              role="alert"
              className="flex items-start gap-3 border-b border-line bg-amber-400/10 px-4 py-3 text-sm text-ink sm:px-6"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
              <p className="min-w-0 flex-1">{status === "tooLarge" ? S.tooLarge : S.gone}</p>
              {status === "tooLarge" && (
                <button
                  type="button"
                  onClick={() => sync.retry()}
                  className="min-h-11 shrink-0 rounded-md border border-line-strong bg-card px-3 text-xs font-semibold transition hover:bg-hover sm:min-h-0 sm:py-1.5"
                >
                  {S.retry}
                </button>
              )}
            </div>
          )}

          <div className="relative flex-1 overflow-y-auto">
            {activePage && <PageView page={activePage} />}
          </div>
        </main>

        {aiMounted && (
          <div className={aiOpen ? "contents" : "hidden"}>
            <AgentChat
              workspaceId={id}
              onApplied={applyAgentWorkspace}
              onClose={closeAi}
              onBusyChange={handleAgentBusyChange}
            />
          </div>
        )}
      </div>
    </WorkspaceProvider>
  );
}

function HistoryButton({
  label,
  shortcut,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  shortcut: string;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-keyshortcuts={shortcut.replace("Ctrl", "Control")}
      title={`${label} (${shortcut})`}
      className="grid h-11 w-11 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent sm:h-9 sm:w-9"
    >
      {icon}
    </button>
  );
}

function ConflictBanner({
  conflict,
  onKeepMine,
  onUseLatest,
}: {
  conflict: Conflict;
  onKeepMine: () => void;
  onUseLatest: () => void;
}) {
  const { dict } = useI18n();
  const S = dict.safety;
  const isDraft = conflict.kind === "draft";
  return (
    <div
      role="alert"
      className="border-b border-line bg-lime-faint px-4 py-3 text-sm text-ink sm:px-6"
    >
      <p className="font-semibold">{isDraft ? S.draftTitle : S.conflictTitle}</p>
      <p className="mt-0.5 text-ink-soft">{isDraft ? S.draftBody : S.conflictBody}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onKeepMine}
          className="min-h-11 rounded-md bg-ink px-3.5 text-xs font-semibold text-paper transition hover:opacity-90 sm:min-h-0 sm:py-2"
        >
          {isDraft ? S.restoreDraft : S.keepMine}
        </button>
        <button
          type="button"
          onClick={onUseLatest}
          className="min-h-11 rounded-md border border-line-strong bg-card px-3.5 text-xs font-semibold text-ink transition hover:bg-hover sm:min-h-0 sm:py-2"
        >
          {isDraft ? S.discardDraft : S.useLatest}
        </button>
        {!isDraft && <span className="text-xs text-ink-soft">{S.useLatestHint}</span>}
      </div>
    </div>
  );
}

function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  const { dict } = useI18n();
  const S = dict.safety;
  const label =
    status === "saving"
      ? dict.editor.saving
      : status === "saved"
        ? dict.editor.saved
        : status === "offline"
          ? S.offline
          : status === "error"
            ? dict.editor.saveFailed
            : S.notSaved;
  const tone =
    status === "saved"
      ? "bg-emerald-500"
      : status === "saving"
        ? "bg-amber-400"
        : status === "error"
          ? "bg-rose-500"
          : "bg-amber-500";
  const canRetry = status === "error" || status === "offline";
  return (
    <span className="flex items-center gap-1.5">
      <span
        role="status"
        aria-label={label}
        title={label}
        className={`flex min-h-11 items-center gap-1.5 px-1 text-xs sm:min-h-0 sm:px-0 ${
          status === "error" ? "text-rose-500" : "text-ink-soft"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />
        <span className="hidden lg:inline">{label}</span>
      </span>
      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={dict.safety.retry}
          className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md border border-line-strong bg-card px-2 text-xs font-semibold text-ink transition hover:bg-hover sm:min-h-0 sm:min-w-0 sm:py-1"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{dict.safety.retry}</span>
        </button>
      )}
    </span>
  );
}
