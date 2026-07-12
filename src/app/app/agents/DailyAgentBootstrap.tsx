"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ensureDailyStudyPlanAction } from "./actions";

interface DailyAgentBootstrapProps {
  enabled: boolean;
  planLocalDate: string | null;
  planningLabel: string;
}
/** Runs the enabled agent once on the student's first app visit each local day. */
export function DailyAgentBootstrap({
  enabled,
  planLocalDate,
  planningLabel,
}: DailyAgentBootstrapProps) {
  const router = useRouter();
  const started = useRef(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const now = new Date();
    const localDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    if (!enabled || planLocalDate === localDate || started.current) return;

    started.current = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    startTransition(async () => {
      await ensureDailyStudyPlanAction(timeZone);
      router.refresh();
    });
  }, [enabled, planLocalDate, router]);

  if (!pending) return null;
  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-ink px-4 py-2 text-xs font-semibold text-paper shadow-pop"
      role="status"
      aria-live="polite"
    >
      <span
        className="h-3 w-3 animate-spin rounded-full border-2 border-paper border-r-transparent"
        aria-hidden
      />
      {planningLabel}
    </div>
  );
}
