"use client";

import Link from "next/link";
import { Timer } from "lucide-react";
import { useFocusLauncher } from "@/components/focus/launcher";

/**
 * Opens the focus timer (it lives in the /app layout, so it is here too).
 * Where there is no timer it links to Today, which has one.
 */
export function StartFocusButton({ label, className }: { label: string; className?: string }) {
  const launcher = useFocusLauncher();
  const content = (
    <>
      <Timer className="h-4 w-4" aria-hidden />
      {label}
    </>
  );
  if (!launcher) {
    return (
      <Link href="/app" className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => launcher.open()} className={className}>
      {content}
    </button>
  );
}
