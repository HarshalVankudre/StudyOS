"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { OPEN_NOTION_IMPORT_EVENT } from "@/components/command/events";

// Loaded when a student opens it: most sessions never import.
const NotionImportDialog = lazy(() => import("./NotionImportDialog").then((m) => ({ default: m.NotionImportDialog })));

/**
 * The one "Import from Notion" dialog of the /app pages (mounted by AppShell).
 * The home page button and the command palette open it with
 * OPEN_NOTION_IMPORT_EVENT.
 */
export function NotionImportHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_NOTION_IMPORT_EVENT, show);
    return () => window.removeEventListener(OPEN_NOTION_IMPORT_EVENT, show);
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <NotionImportDialog open onOpenChange={setOpen} />
    </Suspense>
  );
}
