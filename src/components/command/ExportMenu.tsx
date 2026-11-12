"use client";

import { Archive, Download, FileText, Printer, Sheet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { databaseToCsv } from "@/lib/export/csv";
import { pageToMarkdown } from "@/lib/export/markdown";
import { safeFileName } from "@/lib/export/zip";
import { useI18n } from "@/lib/i18n/client";
import type { Page, Workspace } from "@/lib/workspace/types";
import { OPEN_EXPORT_EVENT } from "./events";

/** Hand a file to the browser's downloads. */
export function downloadFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

interface ExportAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  group: "page" | "databases" | "workspace";
  disabled?: boolean;
  run: () => void;
}

/**
 * Export and print for the workspace header: the current page as Markdown,
 * any database as CSV, the whole workspace as a .zip, or print / save as
 * PDF. Files are built in the browser from the workspace being edited, so
 * they include edits that are not saved yet. On phones the header has no
 * room, so the same choices open as a sheet from the palette.
 */
export function ExportMenu({ workspace, page }: { workspace: Workspace; page: Page | undefined }) {
  const { dict, t, locale } = useI18n();
  const E = dict.exportMenu;
  const mdOptions = () => ({ labels: E.labels, origin: origin(), locale, ukLabels: dict.grades.uk });
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const open = () => setSheetOpen(true);
    window.addEventListener(OPEN_EXPORT_EVENT, open);
    return () => window.removeEventListener(OPEN_EXPORT_EVENT, open);
  }, []);

  const guard = (fn: () => void | Promise<void>) => () => {
    Promise.resolve()
      .then(fn)
      .catch(() => toast.error(E.failed));
  };
  const origin = () => window.location.origin;

  // Databases shown on this page first, then the rest.
  const onPage = new Set((page?.blocks ?? []).flatMap((b) => (b.type === "database_view" ? [b.databaseId] : [])));
  const databases = [...workspace.databases].sort((a, b) => Number(onPage.has(b.id)) - Number(onPage.has(a.id)));

  const actions: ExportAction[] = [
    {
      key: "page",
      group: "page",
      label: E.pageMarkdown,
      icon: <FileText className="h-4 w-4" aria-hidden />,
      disabled: !page,
      run: guard(() => {
        if (!page) return;
        const md = pageToMarkdown(page, workspace, mdOptions());
        downloadFile(`${safeFileName(page.title)}.md`, md, "text/markdown;charset=utf-8");
      }),
    },
    ...databases.map<ExportAction>((db) => ({
      key: `db-${db.id}`,
      group: "databases",
      label: t(E.databaseCsv, { name: `${db.icon ? `${db.icon} ` : ""}${db.name}` }),
      icon: <Sheet className="h-4 w-4" aria-hidden />,
      run: guard(() => {
        downloadFile(`${safeFileName(db.name)}.csv`, databaseToCsv(db, workspace), "text/csv;charset=utf-8");
      }),
    })),
    {
      key: "zip",
      group: "workspace",
      label: E.workspaceZip,
      icon: <Archive className="h-4 w-4" aria-hidden />,
      run: guard(async () => {
        const { workspaceToZip } = await import("@/lib/export/zip");
        const zip = workspaceToZip(workspace, mdOptions());
        downloadFile(`${safeFileName(workspace.name, "StudyOS")}.zip`, zip as Uint8Array<ArrayBuffer>, "application/zip");
      }),
    },
    {
      key: "print",
      group: "workspace",
      label: E.print,
      icon: <Printer className="h-4 w-4" aria-hidden />,
      // Let menus close before the print dialog snapshots the page.
      run: () => setTimeout(() => window.print(), 80),
    },
  ];

  const ITEM = "min-h-11 gap-2.5 px-2.5 text-ink sm:min-h-9";
  const group = (g: ExportAction["group"]) => actions.filter((a) => a.group === g);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={E.menuLabel}
          title={E.menuLabel}
          className="hidden h-9 w-9 shrink-0 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink data-[state=open]:bg-hover sm:grid"
        >
          <Download className="h-4 w-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 border-line-strong bg-card text-ink">
          <DropdownMenuLabel className="px-2.5 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
            {E.menuLabel}
          </DropdownMenuLabel>
          {group("page").map((a) => (
            <DropdownMenuItem key={a.key} className={ITEM} disabled={a.disabled} onSelect={a.run}>
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          ))}
          {databases.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="px-2.5 text-xs font-normal text-ink-faint">{E.databasesLabel}</DropdownMenuLabel>
              {group("databases").map((a) => (
                <DropdownMenuItem key={a.key} className={ITEM} onSelect={a.run}>
                  {a.icon}
                  <span className="truncate">{a.label}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          {group("workspace").map((a) => (
            <DropdownMenuItem key={a.key} className={ITEM} onSelect={a.run}>
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[86dvh] gap-0 overflow-y-auto border-line-strong bg-card p-0 text-ink sm:max-w-sm"
        >
          <div className="flex items-center gap-2 border-b border-line ps-4 pe-1.5 py-1.5">
            <DialogTitle className="flex-1 font-display text-base font-bold">{E.menuLabel}</DialogTitle>
            <DialogClose
              aria-label={dict.command.close}
              className="grid h-11 w-11 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden />
            </DialogClose>
          </div>
          <ul className="p-1.5">
            {actions.map((a, i) => (
              <li key={a.key} className={i > 0 && actions[i - 1].group !== a.group ? "mt-1.5 border-t border-line pt-1.5" : ""}>
                <button
                  type="button"
                  disabled={a.disabled}
                  onClick={() => {
                    setSheetOpen(false);
                    a.run();
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-start text-sm text-ink transition hover:bg-hover disabled:opacity-50"
                >
                  <span className="text-ink-faint">{a.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
