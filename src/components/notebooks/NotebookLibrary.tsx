"use client";

/**
 * The notebook library: folders, notebook covers, the trash, creating a
 * notebook and importing a PDF to write on.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  EllipsisVertical,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  Inbox,
  LoaderCircle,
  NotebookPen,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  COVER_COLORS,
  MAX_PDF_BYTES,
  newId,
  type CoverColor,
  type NotebookDetail,
  type NotebookFolder,
  type NotebookSummary,
} from "@/lib/notebooks/model";
import { api, ApiError, COVER_HEX, jsonInit, patchNotebook, pdfErrorMessage, uploadPdf } from "./api";
import { NewNotebookDialog, type NewNotebookInput } from "./NewNotebookDialog";
import type { CourseOption } from "./StudyKitDialog";

type View = { kind: "all" } | { kind: "unfiled" } | { kind: "folder"; id: string } | { kind: "trash" };

export function NotebookLibrary({ courses }: { courses: CourseOption[] }) {
  const { dict, t, plural, locale, dir } = useI18n();
  const L = dict.notebooks.library;
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<NotebookSummary[] | null>(null);
  const [folders, setFolders] = useState<NotebookFolder[]>([]);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>({ kind: "all" });
  const [createOpen, setCreateOpen] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<
    { kind: "newFolder" } | { kind: "renameFolder"; id: string } | { kind: "renameNotebook"; id: string } | null
  >(null);
  const [nameValue, setNameValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    api<{ notebooks: NotebookSummary[]; folders: NotebookFolder[] }>("/api/notebooks").then(
      (res) => {
        if (!alive) return;
        setNotebooks(res.notebooks);
        setFolders(res.folders);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [reloadKey]);
  const load = () => {
    setFailed(false);
    setReloadKey((k) => k + 1);
  };

  const folderId = view.kind === "folder" ? view.id : null;
  const shown = useMemo(() => {
    const list = notebooks ?? [];
    const live = list.filter((n) => !n.deletedAt);
    const sorted = (xs: NotebookSummary[]) => [...xs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    switch (view.kind) {
      case "all":
        return sorted(live);
      case "unfiled":
        return sorted(live.filter((n) => !n.folderId));
      case "folder":
        return sorted(live.filter((n) => n.folderId === view.id));
      case "trash":
        return sorted(list.filter((n) => n.deletedAt));
    }
  }, [notebooks, view]);

  const errorMessage = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : "";
    if (code === "limit") return L.limitReached;
    if (code === "rate_limited") return L.rateLimited;
    return L.saveFailed;
  };

  // ---- Notebooks ----------------------------------------------------------------
  async function create(input: NewNotebookInput) {
    try {
      const { notebook } = await api<{ notebook: NotebookDetail }>(
        "/api/notebooks",
        jsonInit("POST", {
          id: newId(),
          title: input.title,
          cover: input.cover,
          paper: input.paper,
          folderId,
          workspaceId: input.workspaceId,
        }),
      );
      router.push(`/app/notebooks/${encodeURIComponent(notebook.id)}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function importPdf(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PDF_BYTES) return void toast.error(L.tooLarge);
    if (file.type && file.type !== "application/pdf") return void toast.error(L.notPdf);
    setImporting(file.name);
    try {
      const form = new FormData();
      form.set("file", file);
      if (folderId) form.set("folderId", folderId);
      const notebook = await uploadPdf("/api/notebooks/import-pdf", form);
      router.push(`/app/notebooks/${encodeURIComponent(notebook.id)}`);
    } catch (err) {
      toast.error(pdfErrorMessage(err, L));
      setImporting(null);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      const { notebook } = await patchNotebook(id, body);
      setNotebooks((list) => (list ?? []).map((n) => (n.id === id ? { ...n, ...notebook } : n)));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function deleteForever(n: NotebookSummary) {
    if (!window.confirm(t(L.deleteForeverConfirm, { name: n.title }))) return;
    try {
      await api(`/api/notebooks/${encodeURIComponent(n.id)}`, { method: "DELETE" });
      setNotebooks((list) => (list ?? []).filter((x) => x.id !== n.id));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // ---- Folders ------------------------------------------------------------------
  async function saveName() {
    const name = nameValue.trim();
    const d = nameDialog;
    setNameDialog(null);
    if (!name || !d) return;
    try {
      if (d.kind === "newFolder") {
        const { folder } = await api<{ folder: NotebookFolder }>("/api/notebooks/folders", jsonInit("POST", { name }));
        setFolders((f) => [...f, folder]);
        setView({ kind: "folder", id: folder.id });
      } else if (d.kind === "renameFolder") {
        await api(`/api/notebooks/folders/${encodeURIComponent(d.id)}`, jsonInit("PATCH", { name }));
        setFolders((f) => f.map((x) => (x.id === d.id ? { ...x, name } : x)));
      } else {
        await patch(d.id, { title: name });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function deleteFolder(f: NotebookFolder) {
    if (!window.confirm(t(L.deleteFolderConfirm, { name: f.name }))) return;
    try {
      await api(`/api/notebooks/folders/${encodeURIComponent(f.id)}`, { method: "DELETE" });
      setFolders((list) => list.filter((x) => x.id !== f.id));
      setNotebooks((list) => (list ?? []).map((n) => (n.folderId === f.id ? { ...n, folderId: null } : n)));
      setView({ kind: "all" });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);
  const navItem = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm transition",
      active ? "bg-hover font-semibold text-ink" : "text-ink-soft hover:bg-hover hover:text-ink",
    );

  return (
    <main className="min-h-screen bg-paper text-ink antialiased" dir={dir}>
      <Toaster dir={dir} position="bottom-center" />
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void importPdf(e.target.files?.[0])} />

      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-7">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/app" className="inline-flex h-9 items-center rounded-md pe-2 ps-1 text-ink-soft hover:bg-hover hover:text-ink" aria-label="StudyOS">
              <ChevronLeft className="h-5 w-5 rtl:-scale-x-100" aria-hidden />
              <span className="font-display text-base font-extrabold tracking-tight text-ink">StudyOS</span>
            </Link>
            <span className="text-ink-faint" aria-hidden>
              /
            </span>
            <h1 className="truncate font-display text-lg font-bold tracking-tight">{L.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={!!importing}>
              <FileUp className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{L.importPdf}</span>
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {L.newNotebook}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-7 md:flex-row">
        {/* Folders */}
        <nav className="shrink-0 md:w-56" aria-label={L.title}>
          <div className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
            <button type="button" className={navItem(view.kind === "all")} onClick={() => setView({ kind: "all" })}>
              <NotebookPen className="h-4 w-4 shrink-0" aria-hidden /> <span className="whitespace-nowrap">{L.all}</span>
            </button>
            <button type="button" className={navItem(view.kind === "unfiled")} onClick={() => setView({ kind: "unfiled" })}>
              <Inbox className="h-4 w-4 shrink-0" aria-hidden /> <span className="whitespace-nowrap">{L.unfiled}</span>
            </button>
            {folders.map((f) => {
              const active = view.kind === "folder" && view.id === f.id;
              return (
                <div key={f.id} className="group flex items-center">
                  <button type="button" className={navItem(active)} onClick={() => setView({ kind: "folder", id: f.id })}>
                    {active ? <FolderOpen className="h-4 w-4 shrink-0" aria-hidden /> : <Folder className="h-4 w-4 shrink-0" aria-hidden />}
                    <span className="truncate whitespace-nowrap">{f.name}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-hover hover:text-ink" aria-label={L.folderActions}>
                      <EllipsisVertical className="h-4 w-4" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onSelect={() => {
                          setNameValue(f.name);
                          setNameDialog({ kind: "renameFolder", id: f.id });
                        }}
                      >
                        {L.renameFolder}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => void deleteFolder(f)}>
                        {L.deleteFolder}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
            <button
              type="button"
              className={navItem(false)}
              onClick={() => {
                setNameValue(L.newFolderName);
                setNameDialog({ kind: "newFolder" });
              }}
            >
              <FolderPlus className="h-4 w-4 shrink-0" aria-hidden /> <span className="whitespace-nowrap">{L.newFolder}</span>
            </button>
            <div className="hidden h-px bg-line md:my-2 md:block" aria-hidden />
            <button type="button" className={navItem(view.kind === "trash")} onClick={() => setView({ kind: "trash" })}>
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden /> <span className="whitespace-nowrap">{L.trash}</span>
            </button>
          </div>
        </nav>

        {/* Notebooks */}
        <section className="min-w-0 flex-1">
          {importing && (
            <p className="mb-4 flex items-center gap-2 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-soft" role="status">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {t(L.importing, { name: importing })}
            </p>
          )}
          {view.kind === "trash" && <p className="mb-4 text-sm text-ink-faint">{L.trashHint}</p>}
          {failed ? (
            <div className="rounded-md border border-line bg-surface px-5 py-8 text-center text-sm text-ink-soft">
              <p>{L.loadFailed}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={load}>
                {L.retry}
              </Button>
            </div>
          ) : notebooks === null ? (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="aspect-[3/4] animate-pulse rounded-lg bg-hover" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-md border border-dashed border-line-strong px-5 py-12 text-center text-sm text-ink-soft">
              <p>{view.kind === "trash" ? L.emptyTrash : view.kind === "folder" ? L.emptyFolder : L.empty}</p>
              {view.kind !== "trash" && (
                <div className="mt-4 flex justify-center gap-2">
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" aria-hidden /> {L.newNotebook}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <FileUp className="h-4 w-4" aria-hidden /> {L.importPdf}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((n) => (
                <li key={n.id} className="group relative">
                  <NotebookCover notebook={n} trashed={view.kind === "trash"} />
                  <div className="mt-2 flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{n.title}</p>
                      <p className="text-xs text-ink-faint">
                        {plural(dict.counts.pages, n.pageCount)} · {t(L.edited, { date: dateFmt.format(new Date(n.updatedAt)) })}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-hover hover:text-ink" aria-label={L.actions}>
                        <EllipsisVertical className="h-4 w-4" aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {view.kind === "trash" ? (
                          <>
                            <DropdownMenuItem onSelect={() => void patch(n.id, { trashed: false })}>
                              <RotateCcw className="h-4 w-4" aria-hidden /> {L.restore}
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => void deleteForever(n)}>
                              <Trash2 className="h-4 w-4" aria-hidden /> {L.deleteForever}
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem
                              onSelect={() => {
                                setNameValue(n.title);
                                setNameDialog({ kind: "renameNotebook", id: n.id });
                              }}
                            >
                              {L.rename}
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>{L.moveTo}</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="w-48">
                                <DropdownMenuRadioGroup value={n.folderId ?? ""} onValueChange={(v) => void patch(n.id, { folderId: v || null })}>
                                  <DropdownMenuRadioItem value="">{L.noFolder}</DropdownMenuRadioItem>
                                  {folders.map((f) => (
                                    <DropdownMenuRadioItem key={f.id} value={f.id}>
                                      {f.name}
                                    </DropdownMenuRadioItem>
                                  ))}
                                </DropdownMenuRadioGroup>
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>{L.cover}</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="w-44 p-2">
                                <DropdownMenuLabel className="sr-only">{L.cover}</DropdownMenuLabel>
                                <div className="grid grid-cols-4 gap-2">
                                  {COVER_COLORS.map((c, i) => (
                                    <button
                                      key={c}
                                      type="button"
                                      aria-label={`${L.cover} ${i + 1}`}
                                      onClick={() => void patch(n.id, { cover: c satisfies CoverColor })}
                                      className={cn("h-7 w-7 rounded-md", n.cover === c && "ring-2 ring-lime ring-offset-2 ring-offset-popover")}
                                      style={{ background: COVER_HEX[c] }}
                                    />
                                  ))}
                                </div>
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => void patch(n.id, { trashed: true })}>
                              <Trash2 className="h-4 w-4" aria-hidden /> {L.moveToTrash}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <NewNotebookDialog open={createOpen} onOpenChange={setCreateOpen} courses={courses} onCreate={create} />

      <Dialog open={nameDialog != null} onOpenChange={(v) => !v && setNameDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {nameDialog?.kind === "newFolder" ? L.newFolder : nameDialog?.kind === "renameFolder" ? L.renameFolder : L.rename}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <Input value={nameValue} maxLength={nameDialog?.kind === "renameNotebook" ? 120 : 80} autoFocus onChange={(e) => setNameValue(e.target.value)} aria-label={L.folderName} />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setNameDialog(null)}>
                {L.cancel}
              </Button>
              <Button type="submit">{L.save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** A notebook cover: coloured board with a spine and the title, like a paper notebook. */
function NotebookCover({ notebook, trashed }: { notebook: NotebookSummary; trashed: boolean }) {
  const color = COVER_HEX[notebook.cover] ?? COVER_HEX.slate;
  const inner = (
    <div
      className={cn(
        "relative aspect-[3/4] overflow-hidden rounded-e-lg rounded-s-md shadow-card transition",
        !trashed && "group-hover:-translate-y-0.5 group-hover:shadow-pop",
        trashed && "opacity-60 grayscale",
      )}
      style={{ background: `linear-gradient(160deg, ${color}, color-mix(in srgb, ${color} 70%, black))` }}
    >
      <span className="absolute inset-y-0 start-0 w-3 bg-black/20" aria-hidden />
      <span className="absolute inset-y-0 start-3 w-px bg-white/15" aria-hidden />
      <div className="absolute inset-x-5 top-6 rounded-sm bg-white/90 px-2.5 py-2 shadow-sm">
        <p className="line-clamp-3 text-[13px] font-semibold leading-snug text-zinc-900">{notebook.title}</p>
      </div>
    </div>
  );
  if (trashed) return inner;
  return (
    <Link href={`/app/notebooks/${encodeURIComponent(notebook.id)}`} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime">
      {inner}
    </Link>
  );
}
