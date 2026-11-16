"use client";

/**
 * The notebook editor: a full-screen writing stage (the ink engine owns its
 * canvases and all pointer input), the toolbar, the page sidebar, the lasso
 * selection bar and the sync status. React renders chrome only; nothing in
 * the drawing hot path goes through React state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  ChevronLeft,
  Cloud,
  CloudOff,
  GraduationCap,
  LoaderCircle,
  MoveHorizontal,
  PanelLeft,
  PanelLeftClose,
  Settings2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pageSize, type NotebookDetail, type PageMeta, type PageTemplate } from "@/lib/notebooks/model";
import { DEFAULT_TOOLS, InkEngine, type EngineState, type FingerMode, type ToolSettings } from "./ink/engine";
import { closeAllPdfs } from "./ink/pdf";
import { NotebookSync, type SyncStatus } from "./sync/sync";
import { Toolbar, ToolButton } from "./Toolbar";
import { PagePanel } from "./PagePanel";
import { SelectionBar } from "./SelectionBar";
import { StudyKitDialog, type CourseOption } from "./StudyKitDialog";
import { api, ApiError, blobToBase64, jsonInit, patchNotebook, pdfErrorMessage, uploadPdf } from "./api";

const TOOLS_KEY = "studyos.notebooks.tools";
const FINGER_KEY = "studyos.notebooks.finger";
const HINT_KEY = "studyos.notebooks.hint120";
const PANEL_KEY = "studyos.notebooks.panel";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const INITIAL_STATE: EngineState = {
  zoom: 1,
  pageIndex: 0,
  pageCount: 0,
  canUndo: false,
  canRedo: false,
  selection: null,
  penSeen: false,
  hasClipboard: false,
};

function isIpad(): boolean {
  return /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

export function NotebookEditor({
  notebookId,
  initialPageId,
  courses,
}: {
  notebookId: string;
  initialPageId: string | null;
  courses: CourseOption[];
}) {
  const { dict, t, dir } = useI18n();
  const E = dict.notebooks.editor;
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<InkEngine | null>(null);
  const syncRef = useRef<NotebookSync | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfAfterRef = useRef<string | null>(null);
  const jumpedRef = useRef(false);

  const [engine, setEngine] = useState<InkEngine | null>(null);
  const [sync, setSync] = useState<NotebookSync | null>(null);
  const [detail, setDetail] = useState<NotebookDetail | null>(null);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [state, setState] = useState<EngineState>(INITIAL_STATE);
  const [tools, setToolsState] = useState<ToolSettings>(DEFAULT_TOOLS);
  const [finger, setFinger] = useState<FingerMode>("auto");
  const [status, setStatus] = useState<SyncStatus>("saved");
  const [missing, setMissing] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [tick, setTick] = useState(0);
  const [kitOpen, setKitOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [hint, setHint] = useState(false);
  const [importing, setImporting] = useState(false);
  const { resolvedTheme } = useTheme();

  // Thumbnails redraw a moment after the ink settles, not on every stroke.
  const tickTimer = useRef<number | null>(null);
  const bumpTick = useCallback(() => {
    if (tickTimer.current != null) return;
    tickTimer.current = window.setTimeout(() => {
      tickTimer.current = null;
      setTick((n) => n + 1);
    }, 700);
  }, []);

  // ---- Background handwriting indexing ---------------------------------------------
  // Pages whose ink changed are read (handwriting recognition, no credits)
  // once the student pauses, so search finds what they wrote. One page at a
  // time; stops for the session when the server has no model or the daily
  // cap is reached. The study kit dialog reads any page still left over.
  const indexQueue = useRef(new Set<string>());
  const indexTimer = useRef<number | null>(null);
  const indexOff = useRef(false);
  const indexing = useRef(false);
  const runIndex = useCallback(async () => {
    const eng = engineRef.current;
    const sync = syncRef.current;
    if (!eng || !sync || indexing.current || indexOff.current) return;
    if (document.visibilityState !== "visible") return;
    indexing.current = true;
    try {
      await sync.whenSaved();
      for (const pageId of [...indexQueue.current]) {
        const inkVersion = sync.confirmedInkVersion(pageId);
        if (inkVersion == null) continue; // still changing: the next pause picks it up
        indexQueue.current.delete(pageId);
        const blob = await eng.renderInkImage(pageId);
        if (!blob) continue;
        try {
          await api(
            `/api/notebooks/${encodeURIComponent(notebookId)}/recognize`,
            jsonInit("POST", { pageId, inkVersion, image: await blobToBase64(blob), mime: "image/jpeg" }),
          );
        } catch (err) {
          if (err instanceof ApiError && (err.status === 503 || err.status === 429 || err.status === 401)) {
            indexOff.current = true;
            return;
          }
        }
      }
    } finally {
      indexing.current = false;
    }
  }, [notebookId]);
  const scheduleIndex = useCallback(() => {
    if (indexTimer.current != null) clearTimeout(indexTimer.current);
    indexTimer.current = window.setTimeout(() => {
      indexTimer.current = null;
      void runIndex();
    }, 20_000);
  }, [runIndex]);

  // ---- Engine + sync lifecycle ----------------------------------------------------
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let sync: NotebookSync | null = null;
    const engine = new InkEngine(stage, {
      onOps: (ops) => {
        sync?.push(ops);
        for (const op of ops) if (op.t === "ink.put" || op.t === "ink.del") indexQueue.current.add(op.page);
        scheduleIndex();
        if (ops.some((op) => op.t.startsWith("page."))) setPages(engine.getPages());
        bumpTick();
      },
      onState: setState,
      onNeedInk: (ids) => void sync?.loadInk(ids),
    });
    sync = new NotebookSync(notebookId, {
      onPages: (d, metas) => {
        setDetail(d);
        setPages(metas);
        engine.setPages(metas);
        if (!jumpedRef.current && initialPageId) {
          jumpedRef.current = true;
          const i = metas.findIndex((p) => p.id === initialPageId);
          if (i >= 0) engine.scrollToPage(i);
        }
      },
      onInk: (id, strokes) => {
        engine.setPageInk(id, strokes);
        bumpTick();
      },
      onStatus: (s) => setStatus(s),
      onProblem: (problem) => {
        if (problem === "gone") setMissing(true);
        toast.error(E.problems[problem]);
      },
      getLocalStrokes: (id) => engine.getPageStrokes(id),
    });
    engineRef.current = engine;
    syncRef.current = sync;
    setEngine(engine);
    setSync(sync);

    const savedTools = readLocal(TOOLS_KEY, DEFAULT_TOOLS);
    const savedFinger = readLocal<{ mode: FingerMode }>(FINGER_KEY, { mode: "auto" }).mode;
    setToolsState(savedTools);
    setFinger(savedFinger);
    engine.setTools(savedTools);
    engine.setFingerMode(savedFinger);
    setShowPanel(readLocal<{ open: boolean }>(PANEL_KEY, { open: window.innerWidth >= 1100 }).open);
    setHint(isIpad() && !readLocal<{ seen: boolean }>(HINT_KEY, { seen: false }).seen);

    sync.open(null).catch(() => setMissing(true));

    return () => {
      sync?.destroy();
      engine.destroy();
      closeAllPdfs();
      engineRef.current = null;
      syncRef.current = null;
      if (tickTimer.current != null) clearTimeout(tickTimer.current);
      if (indexTimer.current != null) clearTimeout(indexTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  useEffect(() => {
    engineRef.current?.refreshTheme();
  }, [resolvedTheme]);

  // The page sidebar changes the stage's width: the engine re-measures itself.
  useEffect(() => {
    writeLocal(PANEL_KEY, { open: showPanel });
  }, [showPanel]);

  const setTools = useCallback((next: ToolSettings) => {
    setToolsState(next);
    engineRef.current?.setTools(next);
    writeLocal(TOOLS_KEY, next);
  }, []);

  const setFingerMode = (mode: FingerMode) => {
    setFinger(mode);
    engineRef.current?.setFingerMode(mode);
    writeLocal(FINGER_KEY, { mode });
  };

  // ---- Keyboard shortcuts ---------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (document.querySelector("[role=dialog]")) return;
      const eng = engineRef.current;
      if (!eng) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) eng.redo();
        else eng.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        eng.redo();
      } else if (mod && key === "c") eng.copySelection();
      else if (mod && key === "x") eng.copySelection(true);
      else if (mod && key === "v") {
        if (tools.tool !== "lasso") setTools({ ...tools, tool: "lasso" });
        eng.paste();
      } else if (mod && key === "d") {
        e.preventDefault();
        eng.duplicateSelection();
      } else if ((key === "delete" || key === "backspace") && state.selection) {
        e.preventDefault();
        eng.deleteSelection();
      } else if (key === "escape") eng.clearSelection();
      else if (!mod && key === "p") setTools({ ...tools, tool: "pen" });
      else if (!mod && key === "h") setTools({ ...tools, tool: "highlighter" });
      else if (!mod && key === "e") setTools({ ...tools, tool: "eraser" });
      else if (!mod && key === "l") setTools({ ...tools, tool: "lasso" });
      else if (key === "+" || key === "=") eng.zoomBy(1.2);
      else if (key === "-") eng.zoomBy(1 / 1.2);
      else if (key === "0") eng.fitWidth();
      else if (key === "pagedown") eng.scrollToPage(state.pageIndex + 1, true);
      else if (key === "pageup") eng.scrollToPage(state.pageIndex - 1, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tools, setTools, state.selection, state.pageIndex]);

  // ---- Page actions ------------------------------------------------------------------
  const paper = detail?.paper;
  const addPage = (after: number) => {
    const eng = engineRef.current;
    if (!eng || !paper) return;
    const ref = pages[after] ?? pages[pages.length - 1];
    // A new page follows the page before it (size and paper), or the notebook default.
    const size = ref && !ref.pdf ? { width: ref.width, height: ref.height } : pageSize(paper);
    const template = ref && !ref.pdf ? ref.template : paper.template;
    eng.addPage(after, size, template);
  };
  const deletePage = (id: string) => {
    if (!window.confirm(E.deletePageConfirm)) return;
    engineRef.current?.deletePage(id);
  };
  const movePage = (id: string, to: number) => engineRef.current?.movePage(id, to);
  const setTemplate = (id: string, template: PageTemplate) => engineRef.current?.setPageTemplate(id, template);

  const insertPdf = (afterPageId: string | null) => {
    pdfAfterRef.current = afterPageId;
    pdfInputRef.current?.click();
  };
  const onPdfChosen = async (file: File | undefined) => {
    if (!file) return;
    const L = dict.notebooks.library;
    setImporting(true);
    try {
      await syncRef.current?.whenSaved();
      const form = new FormData();
      form.set("file", file);
      if (pdfAfterRef.current) form.set("afterPageId", pdfAfterRef.current);
      await uploadPdf(`/api/notebooks/${encodeURIComponent(notebookId)}/pdf`, form);
      await syncRef.current?.pull(true);
    } catch (err) {
      toast.error(pdfErrorMessage(err, L));
    } finally {
      setImporting(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  const rename = async () => {
    const title = renameValue.trim();
    if (!title || !detail) return setRenameOpen(false);
    setRenameOpen(false);
    setDetail({ ...detail, title });
    try {
      await patchNotebook(notebookId, { title });
    } catch {
      toast.error(dict.notebooks.library.saveFailed);
    }
  };

  const eng = engine;
  const title = detail?.title ?? "";

  return (
    <div className="fixed inset-0 flex flex-col bg-paper text-ink" dir={dir}>
      <Toaster dir={dir} position="bottom-center" />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void onPdfChosen(e.target.files?.[0])}
      />

      {/* ---- Top bar ---- */}
      <header
        className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line bg-surface/95 px-2 py-1.5 backdrop-blur-md sm:px-3"
        style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
      >
        <div className="flex min-w-0 items-center gap-1">
          <Link
            href="/app/notebooks"
            className="inline-flex h-9 items-center gap-1 rounded-md pe-2 ps-1 text-sm font-semibold text-ink-soft transition hover:bg-hover hover:text-ink"
          >
            <ChevronLeft className="h-5 w-5 rtl:-scale-x-100" aria-hidden />
            <span className="hidden lg:inline">{E.back}</span>
          </Link>
          <ToolButton label={showPanel ? E.hidePages : E.showPages} onClick={() => setShowPanel((v) => !v)} active={showPanel}>
            {showPanel ? <PanelLeftClose className="h-[18px] w-[18px] rtl:-scale-x-100" aria-hidden /> : <PanelLeft className="h-[18px] w-[18px] rtl:-scale-x-100" aria-hidden />}
          </ToolButton>
          <button
            type="button"
            onClick={() => {
              setRenameValue(title);
              setRenameOpen(true);
            }}
            className="max-w-[28vw] truncate rounded-md px-2 py-1.5 text-start text-sm font-semibold hover:bg-hover"
            title={E.renameTitle}
          >
            {title || "…"}
          </button>
          <SyncBadge status={status} />
        </div>

        <div className="order-3 flex min-w-0 flex-1 basis-full justify-center md:order-none md:basis-auto">
          <Toolbar
            tools={tools}
            onTools={setTools}
            canUndo={state.canUndo}
            canRedo={state.canRedo}
            onUndo={() => eng?.undo()}
            onRedo={() => eng?.redo()}
          />
        </div>

        <div className="ms-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setKitOpen(true)} disabled={!detail} className="h-9">
            <GraduationCap className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{dict.notebooks.studyKit.button}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-hover hover:text-ink"
              aria-label={E.settings}
            >
              <Settings2 className="h-[18px] w-[18px]" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>{E.fingerMode}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={finger} onValueChange={(v) => setFingerMode(v as FingerMode)}>
                <DropdownMenuRadioItem value="auto">{E.fingerAuto}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="draw">{E.fingerDraw}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="scroll">{E.fingerScroll}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => insertPdf(pages[state.pageIndex]?.id ?? null)}>{E.insertPdf}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{E.tips}</DropdownMenuLabel>
              <p className="px-2 pb-1.5 text-xs leading-relaxed text-ink-soft">{E.gestureTips}</p>
              <p className="px-2 pb-1.5 text-xs leading-relaxed text-ink-soft">{E.keyboardTips}</p>
              <p className="px-2 pb-2 text-xs leading-relaxed text-ink-soft">{E.hint120}</p>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {hint && (
        <div className="flex items-start gap-3 border-b border-line bg-lime-faint px-4 py-2 text-xs leading-relaxed text-ink">
          <p className="flex-1">
            {E.hint120}
            {!window.matchMedia?.("(display-mode: standalone)").matches && <> {E.hintInstall}</>}
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold hover:bg-hover"
            onClick={() => {
              setHint(false);
              writeLocal(HINT_KEY, { seen: true });
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden /> {E.dismiss}
          </button>
        </div>
      )}

      {/* ---- Body: pages sidebar + writing stage ---- */}
      <div className="flex min-h-0 flex-1">
        {showPanel && (
          <PagePanel
            engine={engine}
            pages={pages}
            current={state.pageIndex}
            tick={tick}
            onJump={(i) => eng?.scrollToPage(i, true)}
            onAdd={addPage}
            onDelete={deletePage}
            onMove={movePage}
            onTemplate={setTemplate}
            onInsertPdf={insertPdf}
          />
        )}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div ref={stageRef} className="notebook-stage absolute inset-0" />

          {state.selection && (
            <SelectionBar
              selection={state.selection}
              hasClipboard={state.hasClipboard}
              onDelete={() => eng?.deleteSelection()}
              onDuplicate={() => eng?.duplicateSelection()}
              onCopy={() => eng?.copySelection()}
              onCut={() => eng?.copySelection(true)}
              onPaste={() => eng?.paste()}
              onRecolor={(c) => eng?.recolorSelection(c)}
              onDone={() => eng?.clearSelection()}
            />
          )}

          {(missing || !detail) && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex items-center gap-2 rounded-md bg-surface px-4 py-3 text-sm text-ink-soft shadow-pop">
                {missing ? (
                  <>
                    {E.notFound}
                    <Link href="/app/notebooks" className="font-semibold text-ink underline">
                      {E.back}
                    </Link>
                  </>
                ) : (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {E.loading}
                  </>
                )}
              </div>
            </div>
          )}

          {importing && (
            <div className="absolute inset-x-0 top-3 flex justify-center">
              <div className="flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-xs text-ink-soft shadow-pop">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t(dict.notebooks.library.importing, { name: "PDF" })}
              </div>
            </div>
          )}

          {/* Page indicator and zoom */}
          <div
            className="pointer-events-none absolute inset-x-0 flex items-center justify-between px-3"
            style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <span className="pointer-events-auto rounded-full bg-surface/90 px-3 py-1.5 font-mono text-[11px] text-ink-soft shadow-card backdrop-blur">
              {state.pageCount ? t(E.pageOf, { page: state.pageIndex + 1, count: state.pageCount }) : ""}
            </span>
            <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-surface/90 p-0.5 shadow-card backdrop-blur">
              <ToolButton label={E.zoomOut} onClick={() => eng?.zoomBy(1 / 1.25)}>
                <ZoomOut className="h-4 w-4" aria-hidden />
              </ToolButton>
              <span className="w-11 text-center font-mono text-[11px] text-ink-soft">{Math.round(state.zoom * 100)}%</span>
              <ToolButton label={E.zoomIn} onClick={() => eng?.zoomBy(1.25)}>
                <ZoomIn className="h-4 w-4" aria-hidden />
              </ToolButton>
              <ToolButton label={E.fitWidth} onClick={() => eng?.fitWidth()}>
                <MoveHorizontal className="h-4 w-4" aria-hidden />
              </ToolButton>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{E.renameTitle}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <Input value={renameValue} maxLength={120} autoFocus onChange={(e) => setRenameValue(e.target.value)} />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                {dict.notebooks.library.cancel}
              </Button>
              <Button type="submit">{dict.notebooks.library.save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {detail && (
        <StudyKitDialog
          open={kitOpen}
          onOpenChange={setKitOpen}
          notebookId={notebookId}
          title={title}
          linkedCourseId={detail.workspaceId}
          courses={courses}
          engine={engine}
          sync={sync}
        />
      )}
    </div>
  );
}

function SyncBadge({ status }: { status: SyncStatus }) {
  const { dict } = useI18n();
  const S = dict.notebooks.editor.status;
  const label = S[status];
  return (
    <span
      className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-ink-faint"
      role="status"
      aria-live="polite"
      title={label}
    >
      {status === "saved" ? (
        <Cloud className="h-3.5 w-3.5" aria-hidden />
      ) : status === "saving" ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <CloudOff className="h-3.5 w-3.5 text-amber-500" aria-hidden />
      )}
      <span className="hidden xl:inline">{label}</span>
    </span>
  );
}
