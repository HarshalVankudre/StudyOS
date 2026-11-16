"use client";

import { useFormStatus } from "react-dom";

/**
 * The "Load demo" submit button. Disabled while the demo is being created:
 * every submit runs the action, so a double click made two demo workspaces.
 */
export function LoadDemoButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-full border border-ink/25 px-6 py-3 text-sm font-semibold text-ink transition hover:bg-hover"
    >
      {label}
    </button>
  );
}
