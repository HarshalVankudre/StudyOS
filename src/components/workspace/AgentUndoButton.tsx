"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { Workspace } from "@/lib/workspace/types";

export function AgentUndoButton({
  changeId,
  onUndone,
  onUnavailable,
}: {
  changeId: string;
  onUndone: (workspace: Workspace) => void;
  /** The server can no longer honour this Undo (edits were saved on top). */
  onUnavailable?: () => void;
}) {
  const { dict } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<null | "edits" | "other">(null);

  const undo = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch("/api/agent/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeId }),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 409 && body?.reason === "newer_edits") {
        setFailure("edits");
        onUnavailable?.();
        return;
      }
      if (!response.ok || !body?.workspace) throw new Error("Undo failed");
      onUndone(body.workspace as Workspace);
    } catch {
      setFailure("other");
    } finally {
      setBusy(false);
    }
  };

  if (failure === "edits") {
    return (
      <p role="status" className="text-[10px] leading-snug text-ink-soft">
        {dict.agentChat.undoBlockedByEdits}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={undo}
        disabled={busy}
        className="min-h-8 rounded-full border border-line-strong bg-card px-2.5 py-1 text-[10px] font-semibold text-ink transition hover:bg-hover disabled:opacity-50"
      >
        <span aria-hidden>↶</span> {busy ? dict.agentChat.undoing : dict.agentChat.undo}
      </button>
      {failure === "other" && (
        <span role="status" className="text-[10px] text-rose-500">
          {dict.agentChat.undoFailed}
        </span>
      )}
    </div>
  );
}
