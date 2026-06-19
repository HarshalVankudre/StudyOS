"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { Workspace } from "@/lib/workspace/types";

export function AgentUndoButton({
  changeId,
  onUndone,
}: {
  changeId: string;
  onUndone: (workspace: Workspace) => void;
}) {
  const { dict } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const undo = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/agent/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.workspace) throw new Error("Undo failed");
      onUndone(body.workspace as Workspace);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={undo}
        disabled={busy}
        className="rounded-full border border-line-strong bg-card px-2.5 py-1 text-[10px] font-semibold text-ink transition hover:bg-hover disabled:opacity-50"
      >
        <span aria-hidden>↶</span> {busy ? dict.agentChat.undoing : dict.agentChat.undo}
      </button>
      {failed && (
        <span className="text-[10px] text-rose-500">
          {dict.agentChat.undoFailed}
        </span>
      )}
    </div>
  );
}
