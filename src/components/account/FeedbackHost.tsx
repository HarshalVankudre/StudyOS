"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { OPEN_FEEDBACK_EVENT } from "@/components/command/events";

// Loaded only when a student opens it: most sessions never send feedback.
const FeedbackDialog = lazy(() => import("./FeedbackDialog").then((m) => ({ default: m.FeedbackDialog })));

/**
 * The one "Send feedback" dialog of the /app pages (mounted by AppShell). The
 * account menu and the command palette open it with OPEN_FEEDBACK_EVENT.
 */
export function FeedbackHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_FEEDBACK_EVENT, show);
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, show);
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <FeedbackDialog open onOpenChange={setOpen} />
    </Suspense>
  );
}
