"use client";

import { useEffect, useState } from "react";
import { STUDY_KIT_EVENT, type StudyKitIntent } from "./events";
import { StudyKitDialog } from "./StudyKitDialog";
import type { PriceQuote } from "@/lib/price-list";

/**
 * Mounted once by the workspace editor: opens the study-kit dialog when the
 * insert menu or the study hub asks for it (openStudyKit), and shows the new
 * page once the kit has been added.
 */
export function StudyKitHost({
  activePageId,
  onOpenPage,
  partQuote,
  billing,
}: {
  activePageId?: string;
  onOpenPage: (pageId: string) => void;
  /** One part's price on the student's model (see StudyKitDialog). */
  partQuote?: PriceQuote;
  /** Payments are switched on (the dialog may link to buying credits). */
  billing?: boolean;
}) {
  const [intent, setIntent] = useState<StudyKitIntent | null>(null);
  const [afterPageId, setAfterPageId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<StudyKitIntent>).detail;
      if (!detail || (detail.mode !== "material" && detail.mode !== "page")) return;
      setIntent(detail);
      setAfterPageId(detail.mode === "page" ? detail.pageId : activePageId);
    };
    window.addEventListener(STUDY_KIT_EVENT, onOpen);
    return () => window.removeEventListener(STUDY_KIT_EVENT, onOpen);
  }, [activePageId]);

  if (!intent) return null;
  return (
    <StudyKitDialog
      intent={intent}
      afterPageId={afterPageId}
      onClose={() => setIntent(null)}
      onCreated={onOpenPage}
      partQuote={partQuote}
      billing={billing}
    />
  );
}
