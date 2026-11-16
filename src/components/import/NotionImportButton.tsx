"use client";

import { FileArchive } from "lucide-react";
import { emit, OPEN_NOTION_IMPORT_EVENT } from "@/components/command/events";
import { cn } from "@/lib/utils";

/**
 * The small, secondary "Import from Notion" entry next to "generate a
 * workspace" on the home page. Opens the dialog NotionImportHost renders.
 */
export function NotionImportButton({ label, className }: { label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => emit(OPEN_NOTION_IMPORT_EVENT)}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full border border-ink/25 px-5 text-sm font-semibold text-ink transition hover:bg-hover",
        className,
      )}
    >
      <FileArchive className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
