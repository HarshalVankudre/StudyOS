"use client";

import Link from "next/link";
import { Download, Layers, ListChecks, MoreHorizontal, Redo2, RotateCw, Search, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Toaster } from "@/components/ui/sonner";
import { useI18n } from "@/lib/i18n/client";
import type { Removal } from "@/lib/workspace/history";
import type { Workspace } from "@/lib/workspace/types";
import { AccountMenu } from "@/components/account/AccountMenu";
import { CreditMeter } from "@/components/account/CreditMeter";
import { ExportMenu } from "@/components/command/ExportMenu";
import {
  emit,
  OPEN_EXPORT_EVENT,
  OPEN_PALETTE_EVENT,
  OPEN_STUDY_HUB_EVENT,
  SHOW_GETTING_STARTED_EVENT,
} from "@/components/command/events";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchButton } from "@/components/command/SearchButton";
import { GettingStarted } from "@/components/onboarding/GettingStarted";
import { AgentChat } from "./AgentChat";
import { DeepLinkProvider } from "./DeepLinkContext";
import { FeedAutoSync } from "./feeds/FeedAutoSync";
import { PageView } from "./PageView";
import { StudyLauncher } from "./StudyLauncher";
import { StudyKitHost } from "./materials/StudyKitHost";
import { hasQuizzes } from "./quiz/QuizHub";
import { WorkspaceProvider, type SaveStatus } from "./WorkspaceContext";
import { useEditorLocation } from "./useEditorLocation";
import { focusedFieldKey, isTextEntry, useWorkspaceSync } from "./useWorkspaceSync";
import type { MergeNotice, Notice, PendingField, UpdateOptions } from "./workspace-sync";
import { PendingFieldsContext } from "./editor/pendingFields";
import { DraftInput } from "./editor/DraftInput";

const TOAST_MS = 8000;

export function WorkspaceEditor({
  id,
  initialWorkspace,
  initialVersion = 1,
  initialCredits = 0,
  kitCreditsPerSection,
}: {
  id: string;
  initialWorkspace: Workspace;
  /** The saved version `initialWorkspace` was read at (for conflict checks). */
  initialVersion?: number;
  initialCredits?: number;
  /** Typical credits per study-kit section on the student's model (server-priced). */
  kitCreditsPerSection?: number;
}) {
  const { dict, t, dir, plural } = useI18n();
  const S = dict.safety;

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
            ? plural(S.removedPages, removal.count)
            : t(S.removedPage, { name: removal.name || dict.editor.untitled });
        case "database":
          return S.removedDatabase;
        case "block":
          return many ? plural(S.removedBlocks, removal.count) : S.removedBlock;
        case "column":
          return S.removedColumn;
        case "row":
          return many ? plural(S.removedRows, removal.count) : S.removedRow;
        case "columnData":
          return S.removedColumnData;
        case "card":
          return many ? plural(S.removedCards, removal.count) : S.removedCard;
      }
    },
    [S, dict.editor.untitled, plural, t],
  );

  // Declared before use by the toast callbacks via a ref (the engine is
  // created on first render).
  const undoToRef = useRef<(entryId: number) => void>(() => {});
  const undoRef = useRef<() => void>(() => {});

  const { sync, snapshot } = useWorkspaceSync(id, initialWorkspace, initialVersion, {
    onRemoval: (removal, entryId) => {
      toast(removalMessage(removal), {
        duration: TOAST_MS,
        action: { label: S.undo, onClick: () => undoToRef.current(entryId) },
      });
    },
    onNotice: (notice: Notice) => {
      if (notice === "draftRestored") {
        // Merged in as one undoable step.
        toast(S.draftRestored, {
          duration: TOAST_MS,
          action: { label: S.undo, onClick: () => undoRef.current() },
        });
      } else if (notice === "localCopyFailed") {
        toast(S.localCopyFailed, { duration: 15_000 });
      } else {
        toast(notice === "undoPartial" ? S.undoPartial : S.updatedElsewhere, {
          duration: TOAST_MS,
        });
      }
    },
  });
  const { workspace, rev, status, canUndo, canRedo, conflict, merge } = snapshot;

  // The open page lives in the URL (?page=), and deep links (?block=,
  // ?db=&row=) are handed to the page and database views to show.
  const { pageId: activePageId, goToPage, deepLink } = useEditorLocation(workspace);
  /** Open a page (kept in the URL). */
  const setActivePageId = useCallback((pageId: string) => goToPage(pageId), [goToPage]);

  const update = useCallback(
    (mutator: (draft: Workspace) => void, options?: UpdateOptions) =>
      sync.update(mutator, { coalesceKey: focusedFieldKey(), ...options }),
    [sync],
  );
  const registerField = useCallback((field: PendingField) => sync.registerField(field), [sync]);
  const fieldSync = useMemo(() => ({ register: registerField, rev }), [registerField, rev]);
  const settle = useCallback(() => sync.settle(), [sync]);
  const getVersion = useCallback(() => sync.version, [sync]);
  const retrySave = useCallback(() => sync.retry(), [sync]);

  // After undo/redo, follow a page that came back (e.g. undoing a delete).
  const followRestoredPage = useCallback(
    (before: Workspace) => {
      const known = new Set(before.pages.map((p) => p.id));
      const restored = sync.workspace.pages.find((p) => !known.has(p.id));
      if (restored) goToPage(restored.id, "replace");
    },
    [goToPage, sync],
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
    undoRef.current = undo;
  }, [followRestoredPage, sync, undo]);

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
    void sync.settle();
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

  // A new page starts with its title selected (type to name it) and one
  // empty line to write on, not a heading that repeats "Untitled".
  const [freshPageId, setFreshPageId] = useState<string | null>(null);
  const addPage = () => {
    const pageId = crypto.randomUUID();
    update((d) => {
      d.pages.push({
        id: pageId,
        title: dict.editor.untitled,
        icon: "📄",
        blocks: [{ id: crypto.randomUUID(), type: "paragraph", text: "" }],
      });
    });
    setFreshPageId(pageId);
    goToPage(pageId);
    // Close the phone drawer without sending focus back to its button: focus
    // goes to the new page's title.
    setSidebarOpen(false);
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
    if (activePageId === pageId) goToPage(remaining[0]?.id, "replace");
  };

  const activePage =
    workspace.pages.find((p) => p.id === activePageId) ?? workspace.pages[0];
  // The study hub exists once there is something to study (see StudyLauncher).
  const hasStudyHub =
    workspace.pages.some((p) => p.blocks.some((b) => b.type === "flashcards")) || hasQuizzes(workspace);

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
        settle,
        getVersion,
        retrySave,
      }}
    >
     <PendingFieldsContext.Provider value={fieldSync}>
      <Toaster dir={dir} position="bottom-center" />
      <FeedAutoSync />
      <StudyKitHost
        activePageId={activePage?.id}
        onOpenPage={setActivePageId}
        creditsPerSection={kitCreditsPerSection}
      />
      <div className="flex h-[100dvh] w-full overflow-hidden bg-paper text-ink">
        {sidebarOpen && (
          <button
            type="button"
            aria-label={dict.shell.closeMenu}
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
              aria-label={dict.shell.closeMenu}
              className="grid h-11 w-11 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink md:hidden"
            >
              <span aria-hidden>✕</span>
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 pb-2 pt-1">
            {/* Buffered: one write per typing burst, not per key. */}
            <DraftInput
              value={workspace.icon ?? ""}
              onCommit={(icon) =>
                update((d) => {
                  d.icon = icon;
                })
              }
              aria-label={dict.editor.workspaceIcon}
              maxLength={8}
              className="h-8 w-8 rounded-md bg-transparent text-center text-xl outline-none hover:bg-hover focus:bg-card focus:ring-1 focus:ring-ink/20"
            />
            <DraftInput
              value={workspace.name}
              dir="auto"
              aria-label={workspace.name}
              onCommit={(name) =>
                update((d) => {
                  d.name = name;
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
                      goToPage(page.id);
                      closeSidebar();
                    }}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition ${
                      active
                        ? "bg-hover font-medium text-ink"
                        : "text-ink-soft hover:bg-hover"
                    }`}
                  >
                    <span className="w-5 shrink-0 text-center">{page.icon}</span>
                    <span dir="auto" className="truncate">{page.title || dict.editor.untitled}</span>
                  </button>
                  {workspace.pages.length > 1 && (
                    <PageActions
                      name={page.title || dict.editor.untitled}
                      active={active}
                      onDelete={() => deletePage(page.id)}
                    />
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
          <div
            data-print="hide"
            className="relative flex min-h-14 items-center gap-1 border-b border-line px-2 sm:gap-2 sm:px-4 lg:px-6"
          >
            <button
              ref={sidebarTriggerRef}
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label={dict.shell.openMenu}
              aria-expanded={sidebarOpen}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-lg text-ink-soft transition hover:bg-hover hover:text-ink md:hidden"
            >
              <span aria-hidden>☰</span>
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden font-mono text-[11px] text-ink-faint">
              <span dir="auto" className="hidden truncate sm:inline">
                {workspace.icon} {workspace.name}
              </span>
              <span className="hidden sm:inline">/</span>
              <span dir="auto" className="truncate text-ink-soft">
                {activePage?.icon} {activePage?.title}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              {/* Phones get the floating search button (AppShell) instead. */}
              <SearchButton className="hidden sm:flex" />
              <div role="group" aria-label={S.history} className="hidden items-center sm:flex">
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
              <GettingStarted onAskAi={openAi} />
              <StudyLauncher />
              <ExportMenu workspace={workspace} page={activePage} />
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
                <span className="whitespace-nowrap">
                  {aiOpen ? dict.editor.closeAgent : dict.editor.askAi}
                </span>
              </button>
              <MoreActions
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
                study={hasStudyHub}
              />
              <SaveIndicator status={status} onRetry={() => sync.retry()} />
            </div>
          </div>

          {conflict && (
            <ConflictBanner
              discards={conflict.discards}
              onKeepMine={() => sync.resolveConflict("mine")}
              onUseLatest={() => sync.resolveConflict("theirs")}
            />
          )}
          {merge && (
            <MergeBanner
              merge={merge}
              onUseTheirs={() => sync.restoreTheirs()}
              onDismiss={() => sync.dismissMerge()}
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
            <DeepLinkProvider value={deepLink}>
              {activePage && (
                <PageView
                  page={activePage}
                  focusTitle={activePage.id === freshPageId}
                  onTitleFocused={() => setFreshPageId(null)}
                />
              )}
            </DeepLinkProvider>
          </div>
        </main>

        {aiMounted && (
          <div className={aiOpen ? "contents" : "hidden"}>
            <AgentChat
              workspaceId={id}
              onApplied={applyAgentWorkspace}
              onClose={closeAi}
              onBusyChange={handleAgentBusyChange}
              syncKey={`${rev}:${status}`}
            />
          </div>
        )}
      </div>
     </PendingFieldsContext.Provider>
    </WorkspaceProvider>
  );
}

/**
 * Phones: the header keeps the menu, the page name, "Study N due" and
 * "Ask AI"; everything else (search, undo and redo, the study hub, the
 * getting-started guide, export and print) lives in this one menu. Larger
 * screens have those as header buttons and do not show it.
 */
function MoreActions({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  study,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  study: boolean;
}) {
  const { dict } = useI18n();
  const S = dict.safety;
  const A = dict.command.actions;
  const ITEM = "min-h-11 gap-2.5 px-2.5 text-ink";
  // Let the menu close (and hand focus back) before another overlay opens.
  const later = (name: string) => () => setTimeout(() => emit(name), 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={dict.editor.moreActions}
        title={dict.editor.moreActions}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink data-[state=open]:bg-hover sm:hidden"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 border-line-strong bg-card text-ink">
        <DropdownMenuItem className={ITEM} onSelect={later(OPEN_PALETTE_EVENT)}>
          <Search className="h-4 w-4" aria-hidden />
          {dict.command.search}
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} disabled={!canUndo} onSelect={onUndo}>
          <Undo2 className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          {S.undo}
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} disabled={!canRedo} onSelect={onRedo}>
          <Redo2 className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          {S.redo}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {study && (
          <DropdownMenuItem className={ITEM} onSelect={later(OPEN_STUDY_HUB_EVENT)}>
            <Layers className="h-4 w-4" aria-hidden />
            {A.studyHub}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={ITEM} onSelect={later(SHOW_GETTING_STARTED_EVENT)}>
          <ListChecks className="h-4 w-4" aria-hidden />
          {A.gettingStarted}
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onSelect={later(OPEN_EXPORT_EVENT)}>
          <Download className="h-4 w-4" aria-hidden />
          {A.export}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A page's actions menu in the sidebar, so a destructive action is never the
 * next Tab stop after every page. Only the open page's menu is in the Tab
 * order (and always visible, for touch); a mouse can reach any page's menu
 * on hover. Deleting is undoable from the toast or with Ctrl+Z.
 */
function PageActions({ name, active, onDelete }: { name: string; active: boolean; onDelete: () => void }) {
  const { dict, t } = useI18n();
  const label = t(dict.editor.pageActions, { name });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        tabIndex={active ? 0 : -1}
        className={`grid h-11 w-9 shrink-0 place-items-center rounded-md text-ink-faint transition hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:opacity-100 ${
          active ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:hidden"
        }`}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52 border-line-strong bg-card text-ink">
        <DropdownMenuItem
          className="min-h-11 gap-2.5 px-2.5 text-rose-600 focus:text-rose-600 dark:text-rose-400"
          onSelect={onDelete}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {dict.editor.deletePage}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

/** Last resort: only shown if merging with a newer version failed unexpectedly. */
function ConflictBanner({
  discards,
  onKeepMine,
  onUseLatest,
}: {
  /** Changes made elsewhere that "Keep my version" replaces (Undo restores them). */
  discards: number;
  onKeepMine: () => void;
  onUseLatest: () => void;
}) {
  const { dict, plural } = useI18n();
  const S = dict.safety;
  return (
    <div
      role="alert"
      className="border-b border-line bg-lime-faint px-4 py-3 text-sm text-ink sm:px-6"
    >
      <p className="font-semibold">{S.conflictTitle}</p>
      <p className="mt-0.5 text-ink-soft">{S.conflictBody}</p>
      {discards > 0 && (
        <p className="mt-0.5 text-ink-soft">
          {plural(S.conflictDiscards, discards, { count: discards })}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onKeepMine}
          className="min-h-11 rounded-md bg-ink px-3.5 text-xs font-semibold text-paper transition hover:opacity-90 sm:min-h-0 sm:py-2"
        >
          {S.keepMine}
        </button>
        <button
          type="button"
          onClick={onUseLatest}
          className="min-h-11 rounded-md border border-line-strong bg-card px-3.5 text-xs font-semibold text-ink transition hover:bg-hover sm:min-h-0 sm:py-2"
        >
          {S.useLatest}
        </button>
        <span className="text-xs text-ink-soft">{S.useLatestHint}</span>
      </div>
    </div>
  );
}

/**
 * After this tab's unsaved edits were merged with a newer version (or a
 * recovered draft), say plainly what had to be reconciled. Nothing was lost;
 * values the student's edits replaced can be put back.
 */
function MergeBanner({
  merge,
  onUseTheirs,
  onDismiss,
}: {
  merge: MergeNotice;
  onUseTheirs: () => void;
  onDismiss: () => void;
}) {
  const { dict, t } = useI18n();
  const S = dict.safety;
  const { keptBoth, restored, keptDeleted, overwritten, skipped, repaired } = merge.report;
  const lines = [
    keptBoth > 0 && t(S.mergeKeptBoth, { count: keptBoth }),
    restored > 0 && t(S.mergeRestored, { count: restored }),
    keptDeleted > 0 && t(S.mergeKeptDeleted, { count: keptDeleted }),
    overwritten.length > 0 && t(S.mergeOverwrote, { count: overwritten.length }),
    skipped > 0 && t(S.mergeSkipped, { count: skipped }),
    repaired > 0 && t(S.mergeRepaired, { count: repaired }),
  ].filter((line): line is string => Boolean(line));
  return (
    <div
      role="status"
      className="border-b border-line bg-lime-faint px-4 py-3 text-sm text-ink sm:px-6"
    >
      <p className="font-semibold">
        {merge.source === "draft" ? S.mergeTitleDraft : S.mergeTitle}
      </p>
      <ul className="mt-0.5 list-disc space-y-0.5 ps-5 text-ink-soft">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {overwritten.length > 0 && (
          <button
            type="button"
            onClick={onUseTheirs}
            className="min-h-11 rounded-md border border-line-strong bg-card px-3.5 text-xs font-semibold text-ink transition hover:bg-hover sm:min-h-0 sm:py-2"
          >
            {S.mergeUseTheirs}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-11 rounded-md bg-ink px-3.5 text-xs font-semibold text-paper transition hover:opacity-90 sm:min-h-0 sm:py-2"
        >
          {S.mergeDismiss}
        </button>
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
