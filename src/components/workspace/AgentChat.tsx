"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { useI18n } from "@/lib/i18n/client";
import type {
  AgentArea,
  AgentChatHistoryItem,
  AgentChoice,
  AgentMessage,
  AgentResponse,
  AgentStreamEvent,
  AgentUndoState,
} from "@/lib/ai/agent-shared";
import {
  createInitialAgentActivity,
  reduceAgentActivity,
} from "@/lib/ai/progress";
import { emitCreditsBalance, useLiveBalance } from "@/lib/credits-bus";
import type { Workspace } from "@/lib/workspace/types";
import { AgentProgressCard } from "./AgentProgressCard";
import { AgentUndoButton } from "./AgentUndoButton";
import { useWorkspace, type WorkspaceCtx } from "./WorkspaceContext";
import { agentEditsSetAside, keptCopyIds } from "./agentSetAside";

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelContent?: string;
  changed?: boolean;
  choices?: AgentChoice[];
  affectedAreas?: AgentArea[];
  changeId?: string;
  /** Whether the server can still undo `changeId` (see /api/agent/history). */
  undo?: AgentUndoState;
  creditsCost?: number;
  stopReason?: "budget" | "time";
  /**
   * Edits of this turn the editor's merge set aside: the student was typing
   * in the same words, so their text stayed and the agent's version is in a
   * marked copy below it (found on this device, after the reply was written).
   */
  setAside?: number;
}

/** How long after a turn its result is watched for edits the merge set aside. */
const SET_ASIDE_WATCH_MS = 60_000;

/** Most recent turns sent as a fallback history (the server keeps its own). */
const FALLBACK_HISTORY = 12;

function fromHistory(item: AgentChatHistoryItem): ChatItem {
  return {
    id: item.id,
    role: item.role,
    content: item.content,
    modelContent: item.modelContent,
    changed: item.changed,
    choices: item.choices,
    affectedAreas: item.affectedAreas,
    changeId: item.changeId,
    undo: item.undo,
    creditsCost: item.creditsCost,
    stopReason: item.stopReason,
  };
}

/** Only the last message's choices can still be answered. */
function withAnswerableChoices(items: ChatItem[]): ChatItem[] {
  return items.map((item, index) =>
    item.choices && index !== items.length - 1 ? { ...item, choices: undefined } : item,
  );
}

/** The browser's IANA time zone, so "next Friday" is the student's Friday. */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** The editor's workspace context, or null when the chat is rendered alone. */
function useOptionalWorkspace(): WorkspaceCtx | null {
  try {
    // Always called (no condition), so the hook order is stable.
    return useWorkspace();
  } catch {
    return null;
  }
}

const SAVE_SETTLE_TIMEOUT_MS = 5_000;

export function AgentChat({
  workspaceId,
  onApplied,
  onClose,
  onBusyChange,
  syncKey,
  messageQuote,
  initialCredits,
}: {
  workspaceId: string;
  onApplied: (ws: Workspace) => void;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
  /**
   * Changes whenever the editor's workspace or save state changes; the chat
   * then re-checks which of its Undo buttons the server can still honour.
   */
  syncKey?: string | number;
  /**
   * One message's price on the student's model, and the per-message
   * ceiling a long request can reach (server-priced, lib/price-list.ts).
   */
  messageQuote?: { price: number; max: number };
  /** The balance when the page was rendered; the live one after that. */
  initialCredits?: number;
}) {
  const inputHintId = useId();
  const errorId = useId();
  const clearPromptId = useId();
  const { dict, plural, t } = useI18n();
  const balance = useLiveBalance(initialCredits);
  // A message's price, its ceiling and the balance, said before sending.
  const showCost = messageQuote !== undefined && typeof balance === "number";
  const costHintId = useId();
  const initialActivity = createInitialAgentActivity(
    dict.agentChat.initialMessage,
  );
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // True while the editor's pending saves are being written before a task.
  // The editor is told the agent is busy (which pauses autosave) only after
  // that, or the pause would stop the very saves the agent waits for.
  const [settling, setSettling] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState(initialActivity);
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
  const [otherReplies, setOtherReplies] = useState<Record<string, string>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const taskIdRef = useRef<string | null>(null);
  // Mirrors `stopping` for synchronous reads inside the stream loop/catch, which
  // run outside React's render cycle and can't see the latest state value.
  const stoppingRef = useRef(false);

  // The editor's save state, read synchronously while waiting for saves.
  const workspaceCtx = useOptionalWorkspace();
  const saveStatusRef = useRef(workspaceCtx?.status);
  const liveWorkspace = workspaceCtx?.workspace;
  const liveWorkspaceRef = useRef(liveWorkspace);
  useEffect(() => {
    saveStatusRef.current = workspaceCtx?.status;
    liveWorkspaceRef.current = workspaceCtx?.workspace;
  });

  // ---- Edits the editor's merge set aside ----------------------------------
  // The agent's reply is written before this device merges the result with
  // what the student typed meanwhile. When that merge keeps the student's
  // text and moves the agent's version into a marked copy, say so under the
  // turn (the reply alone would claim the change was made).
  /** Marked copies that existed when the turn was sent (not this turn's). */
  const keptBeforeTurnRef = useRef<Set<string> | null>(null);
  const setAsideWatchRef = useRef<{
    itemId: string;
    agent: Workspace;
    before: Set<string>;
    /** When watching stops (set on the first check after the result). */
    until: number | null;
  } | null>(null);
  useEffect(() => {
    const watch = setAsideWatchRef.current;
    if (!watch || !liveWorkspace) return;
    watch.until ??= Date.now() + SET_ASIDE_WATCH_MS;
    if (Date.now() > watch.until) {
      setAsideWatchRef.current = null;
      return;
    }
    const count = agentEditsSetAside(watch.before, watch.agent, liveWorkspace);
    if (count === 0) return;
    setItems((current) =>
      current.map((item) =>
        item.id === watch.itemId && item.setAside !== count ? { ...item, setAside: count } : item,
      ),
    );
  }, [liveWorkspace]);

  // Propagate busy state to the editor so it can suppress autosave while the
  // agent is processing (edits made meanwhile are replayed on top of the
  // agent's result when it finishes). Not while pending saves settle first.
  const editorBusy = busy && !settling;
  useEffect(() => {
    onBusyChange?.(editorBusy);
  }, [editorBusy, onBusyChange]);

  // If the chat unmounts (e.g. navigating away) never leave the editor stuck
  // with autosave paused: report "not busy" on the way out.
  const onBusyChangeRef = useRef(onBusyChange);
  useEffect(() => {
    onBusyChangeRef.current = onBusyChange;
  }, [onBusyChange]);
  useEffect(() => () => onBusyChangeRef.current?.(false), []);

  // ---- Restore the stored conversation when the panel opens ---------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/agent/history?workspaceId=${encodeURIComponent(workspaceId)}`,
        );
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as
          | { messages?: AgentChatHistoryItem[] }
          | null;
        if (cancelled || !Array.isArray(body?.messages)) return;
        const restored = withAnswerableChoices(body.messages.map(fromHistory));
        // Never clobber a conversation the student already started here.
        setItems((current) => (current.length ? current : restored));
      } catch {
        // The chat still works without its history.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // ---- Keep Undo honest ----------------------------------------------------
  // An Undo stays usable exactly while the server can honour it: once the
  // student's own edits are saved on top of an agent change, it can't be.
  const hasUndoable = items.some((item) => item.undo === "available");
  useEffect(() => {
    if (!hasUndoable || busy || syncKey === undefined) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/agent/history?workspaceId=${encodeURIComponent(workspaceId)}&undo=1`,
        );
        const body = res.ok
          ? ((await res.json().catch(() => null)) as { undo?: Record<string, AgentUndoState> } | null)
          : null;
        const states = body?.undo;
        if (cancelled || !states) return;
        setItems((current) =>
          current.map((item) =>
            item.changeId && states[item.changeId] && states[item.changeId] !== item.undo
              ? { ...item, undo: states[item.changeId] }
              : item,
          ),
        );
      } catch {
        // Keep the current state; a refused Undo explains itself.
      }
    }, 1_200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [syncKey, hasUndoable, busy, workspaceId]);

  // Render a completed agent result: append the assistant turn and reflect the
  // applied workspace live. Used by both the live stream and a reconnect.
  const applyResult = (response: AgentResponse) => {
    const itemId = crypto.randomUUID();
    // Watch the merge that follows (onApplied re-reads the saved result and
    // replays the student's edits on top of it).
    setAsideWatchRef.current =
      response.changed && response.workspace
        ? {
            itemId,
            agent: response.workspace,
            before: keptBeforeTurnRef.current ?? keptCopyIds(liveWorkspaceRef.current),
            until: null,
          }
        : null;
    setItems((previous) => [
      // Only the newest agent change can be undone (it must be the latest version).
      ...(response.changeId
        ? previous.map((item) =>
            item.undo === "available" ? { ...item, undo: "unavailable" as const } : item,
          )
        : previous),
      {
        id: itemId,
        role: "assistant",
        content: response.reply,
        changed: response.changed,
        changeId: response.changeId,
        undo: response.changeId ? "available" : undefined,
        choices: response.choices,
        affectedAreas: response.affectedAreas,
        creditsCost: response.creditsCost,
        stopReason: response.stopReason,
      },
    ]);
    if (response.changed && response.workspace) onApplied(response.workspace);
    // Broadcast the new balance so the header meter updates live.
    if (typeof response.creditsBalance === "number") {
      emitCreditsBalance(response.creditsBalance);
    }
  };

  // After a dropped stream, the task may have finished server-side. Poll the
  // durable record briefly and, if it completed, render its result.
  const recoverTask = async (taskId: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const res = await fetch(`/api/agent/task/${taskId}`);
        const body = res.ok ? await res.json().catch(() => null) : null;
        if (Array.isArray(body?.events) && body.events.length) {
          // Replay persisted progress before applying the result.
          setActivity((current) =>
            (body.events as AgentStreamEvent[]).reduce((s, e) => reduceAgentActivity(s, e), current),
          );
        }
        if (body?.status === "done" && body.response) {
          applyResult(body.response as AgentResponse);
          return true;
        }
        // `finalizing` is still active work — keep polling.
        if (
          body?.status &&
          body.status !== "running" &&
          body.status !== "finalizing"
        ) {
          return false;
        }
      } catch {
        // ignore and retry
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return false;
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [items, busy, activity]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  /**
   * PENDING-SAVES CALL SITE (the only one). Before a request, wait until the
   * editor's autosave has nothing in flight, so the agent starts from the
   * version the student actually sees and its result is not refused at the
   * end as "workspace changed". Returns the version the client then holds;
   * the server refuses a stale one up front, before any model runs.
   */
  const settlePendingSaves = useCallback(async (): Promise<number | undefined> => {
    if (!workspaceCtx) return undefined;
    if (workspaceCtx.settle) {
      const settled = await workspaceCtx.settle().catch(() => null);
      const version = settled?.version ?? workspaceCtx.getVersion?.() ?? null;
      return typeof version === "number" ? version : undefined;
    }
    // Older context without `settle`: wait for the save in flight to finish.
    const started = Date.now();
    while (saveStatusRef.current === "saving" && Date.now() - started < SAVE_SETTLE_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return undefined;
  }, [workspaceCtx]);

  const send = async (
    raw: string,
    displayText = raw,
    resolveItemId?: string,
  ) => {
    const message = raw.trim();
    if (!message || busy) return;
    setError(null);
    setText("");
    setConfirmClear(false);

    // Fallback only: the server reads its own stored history.
    const history: AgentMessage[] = items.slice(-FALLBACK_HISTORY).map((item) => ({
      role: item.role,
      content: (item.modelContent ?? item.content).slice(0, 3000),
    }));
    setItems((previous) => [
      ...previous.map((item) =>
        item.id === resolveItemId ? { ...item, choices: undefined } : item,
      ),
      {
        id: crypto.randomUUID(),
        role: "user",
        content: displayText.trim(),
        modelContent: message,
      },
    ]);
    if (resolveItemId) {
      setOtherOpen((previous) => ({ ...previous, [resolveItemId]: false }));
      setOtherReplies((previous) => ({ ...previous, [resolveItemId]: "" }));
    }
    keptBeforeTurnRef.current = keptCopyIds(liveWorkspaceRef.current);
    setSettling(true);
    setBusy(true);
    setActivity(initialActivity);

    const controller = new AbortController();
    controllerRef.current = controller;
    taskIdRef.current = null;
    setTaskId(null);
    stoppingRef.current = false;
    setStopping(false);
    let receivedResult = false;
    let refusal: string | null = null;

    try {
      let baseVersion: number | undefined;
      try {
        baseVersion = await settlePendingSaves();
      } finally {
        // Saves are written: from here autosave pauses until the task ends.
        setSettling(false);
      }
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          history,
          message,
          ...(displayText.trim() !== message ? { displayText: displayText.trim() } : {}),
          timeZone: browserTimeZone(),
          ...(typeof baseVersion === "number" ? { baseVersion } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? dict.agentChat.errorRequestFailed);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AgentStreamEvent;

          if (event.type === "task") {
            taskIdRef.current = event.taskId;
            setTaskId(event.taskId);
          } else if (
            event.type === "phase" ||
            event.type === "discovery" ||
            event.type === "plan" ||
            event.type === "area" ||
            event.type === "thinking"
          ) {
            setActivity((current) => reduceAgentActivity(current, event));
          } else if (event.type === "result") {
            receivedResult = true;
            setActivity((current) => reduceAgentActivity(current, event));
            applyResult(event.response);
          } else if (event.type === "error") {
            // A refusal before any work (credits, stale workspace, rate
            // limit) is the answer itself, not a failed attempt.
            if (event.code && event.code !== "failed") refusal = event.message;
            throw new Error(event.message);
          }
        }

        if (done) break;
      }

      if (!receivedResult)
        throw new Error(dict.agentChat.errorEndedUnexpectedly);
    } catch (cause) {
      // An acknowledged Stop owns the terminal transition (it aborts this very
      // stream on purpose); don't treat that as a failure or try to recover.
      if (stoppingRef.current) return;
      if (!controller.signal.aborted) {
        const recovered =
          !refusal && taskIdRef.current && !receivedResult
            ? await recoverTask(taskIdRef.current)
            : false;
        if (!recovered) {
          const message =
            cause instanceof Error
              ? cause.message
              : dict.agentChat.errorSnag;
          setError(refusal ? null : message);
          setItems((previous) => [
            ...previous,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: refusal ?? dict.agentChat.errorCouldntComplete,
            },
          ]);
        }
      }
    } finally {
      controllerRef.current = null;
      // Leave busy on while Stop is finishing its acknowledged transition; it
      // clears busy itself once the server confirms cancellation.
      if (!stoppingRef.current) setBusy(false);
    }
  };

  // Stop is a durable, acknowledged handshake — not a cosmetic local abort. We
  // ask the server to cancel, wait for confirmation, and only then close the
  // local stream and report "Task stopped." If the endpoint fails we never
  // falsely claim success; if the task had already finished we recover its
  // result instead of pretending it stopped.
  const stopTask = async () => {
    const id = taskIdRef.current;
    if (!id || stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    setError(null);

    try {
      const response = await fetch(`/api/agent/task/${id}/cancel`, {
        method: "POST",
      });
      const body = response.ok ? await response.json().catch(() => null) : null;
      if (!response.ok) throw new Error(dict.agentChat.stopFailed);

      if (body?.status === "already_finished") {
        stoppingRef.current = false;
        setStopping(false);
        if (!controllerRef.current) {
          const recovered = await recoverTask(id);
          setBusy(false);
          if (!recovered) setError(dict.agentChat.stopFailed);
        }
        return;
      }
      if (body?.status !== "cancelled") {
        throw new Error(dict.agentChat.stopFailed);
      }

      controllerRef.current?.abort();
      controllerRef.current = null;
      taskIdRef.current = null;
      setTaskId(null);
      setItems((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: dict.agentChat.taskStopped,
        },
      ]);
      setBusy(false);
      stoppingRef.current = false;
      setStopping(false);
    } catch (cause) {
      stoppingRef.current = false;
      setStopping(false);
      setError(
        cause instanceof Error ? cause.message : dict.agentChat.stopFailed,
      );
      if (!controllerRef.current) {
        await recoverTask(id);
        setBusy(false);
      }
    }
  };

  // Forget the conversation (asked to confirm first; the workspace itself is
  // never touched, and agent changes stay undoable from the editor).
  const clearConversation = async () => {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agent/history?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("clear failed");
      setItems([]);
      setOtherOpen({});
      setOtherReplies({});
      setConfirmClear(false);
    } catch {
      setError(dict.agentChat.clearFailed);
    } finally {
      setClearing(false);
    }
  };

  const markUndo = (id: string, undo: AgentUndoState) =>
    setItems((previous) =>
      previous.map((candidate) => (candidate.id === id ? { ...candidate, undo } : candidate)),
    );

  return (
    <aside
      aria-label={dict.agentChat.title}
      className="fixed inset-0 z-50 flex w-full shrink-0 flex-col border-s border-line bg-paper shadow-pop sm:inset-y-0 sm:start-auto sm:end-0 sm:max-w-[390px] lg:static lg:z-auto lg:w-[390px] lg:shadow-none"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-lime">
            {busy && (
              <span className="ai-ring absolute inset-0 rounded-full bg-lime/30" />
            )}
            <span
              className={`relative h-2 w-2 rounded-full bg-lime-on ${
                busy ? "ai-orb" : ""
              }`}
              aria-hidden
            />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="font-display text-sm font-bold text-ink">{dict.agentChat.title}</p>
            <p className="truncate text-[11px] text-ink-soft">
              {busy
                ? dict.agentChat.phase[activity.phase]
                : dict.agentChat.subtitleIdle}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          {items.length > 0 && (
            <button
              onClick={() => setConfirmClear((open) => !open)}
              disabled={busy || clearing}
              aria-label={dict.agentChat.clearChat}
              title={dict.agentChat.clearChat}
              aria-expanded={confirmClear}
              aria-controls={confirmClear ? clearPromptId : undefined}
              className="grid h-11 w-11 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
          <button
            onClick={onClose}
            aria-label={dict.agentChat.closeChat}
            className="grid h-11 w-11 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
      </div>

      {confirmClear && (
        <div
          id={clearPromptId}
          role="alertdialog"
          aria-label={dict.agentChat.clearChat}
          className="border-b border-line bg-card px-4 py-3"
        >
          <p className="text-sm text-ink">{dict.agentChat.clearConfirm}</p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              onClick={() => setConfirmClear(false)}
              disabled={clearing}
              className="min-h-11 rounded-md border border-line-strong px-3 text-sm text-ink transition hover:bg-hover disabled:opacity-50"
            >
              {dict.agentChat.clearCancel}
            </button>
            <button
              onClick={clearConversation}
              disabled={clearing}
              className="min-h-11 rounded-md bg-rose-600 px-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              {dict.agentChat.clearConfirmYes}
            </button>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={busy}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {items.length === 0 && !busy && (
          <div className="mt-2">
            <p className="text-sm leading-relaxed text-ink-soft">
              {dict.agentChat.intro}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {dict.agentChat.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => send(suggestion)}
                  className="min-h-11 rounded-md border border-line-strong bg-card px-3 py-2 text-start text-sm text-ink-soft transition hover:border-ink/40 hover:text-ink"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {items.map((item) =>
          item.role === "user" ? (
            <div key={item.id} className="flex justify-end">
              <div className="max-w-[85%] break-words [unicode-bidi:plaintext] rounded-2xl rounded-ee-sm bg-lime px-3.5 py-2 text-sm text-lime-on">
                {item.content}
              </div>
            </div>
          ) : (
            <div key={item.id} className="flex flex-col items-start gap-1.5">
              <div className="max-w-[94%] break-words rounded-2xl rounded-es-sm border border-line bg-card px-3.5 py-2 text-sm text-ink">
                <MessageResponse>{item.content}</MessageResponse>
              </div>

              {(item.stopReason ||
                (typeof item.creditsCost === "number" && item.creditsCost > 0)) && (
                <div className="ms-1 flex flex-wrap items-center gap-1.5">
                  {item.stopReason && (
                    <span className="rounded-full bg-hover px-2 py-0.5 text-[10px] text-ink-soft">
                      {dict.agentChat.stoppedAtLimit}
                    </span>
                  )}
                  {typeof item.creditsCost === "number" && item.creditsCost > 0 && (
                    <span
                      className="font-mono text-[10px] text-ink-soft/70"
                      title={dict.credits.turnCostTitle}
                    >
                      {plural(dict.counts.credits, item.creditsCost)}
                    </span>
                  )}
                </div>
              )}

              {item.choices && item.choices.length > 0 && (
                <div className="grid w-[94%] gap-1.5 pt-1">
                  {item.choices.map((choice) => (
                    <button
                      key={choice.id}
                      onClick={() =>
                        send(choice.value, choice.label, item.id)
                      }
                      disabled={busy}
                      className="group flex min-h-11 items-center justify-between rounded-md border border-line-strong bg-card px-3 py-2 text-start text-sm text-ink transition hover:border-lime hover:bg-lime/10 disabled:opacity-50"
                    >
                      <span dir="auto">{choice.label}</span>
                      <span aria-hidden className="text-ink-soft transition group-hover:text-ink rtl:-scale-x-100">
                        →
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() =>
                      setOtherOpen((previous) => ({
                        ...previous,
                        [item.id]: !previous[item.id],
                      }))
                    }
                    disabled={busy}
                    aria-expanded={Boolean(otherOpen[item.id])}
                    className={`group flex min-h-11 items-center justify-between rounded-md border px-3 py-2 text-start text-sm transition disabled:opacity-50 ${
                      otherOpen[item.id]
                        ? "border-lime bg-lime text-lime-on"
                        : "border-line-strong bg-card text-ink hover:border-lime hover:bg-lime/10"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden>✍️</span>
                      {dict.agentChat.other}
                    </span>
                    <span
                      aria-hidden
                      className={`transition rtl:-scale-x-100 ${
                        otherOpen[item.id]
                          ? "rotate-90 text-paper/60"
                          : "text-ink-soft group-hover:text-ink"
                      }`}
                    >
                      →
                    </span>
                  </button>
                  {otherOpen[item.id] && (
                    <div className="flex items-center gap-2 rounded-md border border-line-strong bg-card p-2 focus-within:border-ink/50">
                      <input
                        autoFocus
                        value={otherReplies[item.id] ?? ""}
                        onChange={(event) =>
                          setOtherReplies((previous) => ({
                            ...previous,
                            [item.id]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const reply = otherReplies[item.id]?.trim();
                            if (reply) send(reply, reply, item.id);
                          }
                        }}
                        disabled={busy}
                        maxLength={500}
                        placeholder={dict.agentChat.otherPlaceholder}
                        aria-label={dict.agentChat.otherLabel}
                        className="min-w-0 flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-soft/50"
                      />
                      <button
                        onClick={() => {
                          const reply = otherReplies[item.id]?.trim();
                          if (reply) send(reply, reply, item.id);
                        }}
                        disabled={busy || !otherReplies[item.id]?.trim()}
                        className="min-h-9 rounded-md bg-lime px-2.5 py-1.5 text-xs font-semibold text-lime-on transition enabled:hover:bg-lime-deep disabled:opacity-40"
                      >
                        {dict.agentChat.send}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {item.changed && (
                <div className="ms-1 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-lime/35 px-2 py-0.5 text-[10px] font-semibold text-lime ring-1 ring-inset ring-lime/40">
                    ✓ {dict.agentChat.workspaceUpdated}
                  </span>
                  {item.affectedAreas?.slice(0, 3).map((area) => (
                    <span
                      key={area.id}
                      className="rounded-full bg-hover px-2 py-0.5 text-[10px] text-ink-soft"
                    >
                      {area.icon} {area.label}
                    </span>
                  ))}
                  {item.changeId && item.undo === "available" && (
                    <AgentUndoButton
                      changeId={item.changeId}
                      onUndone={(restored) => {
                        onApplied(restored);
                        markUndo(item.id, "undone");
                      }}
                      onUnavailable={() => markUndo(item.id, "unavailable")}
                    />
                  )}
                  {item.undo === "undone" && (
                    <span className="rounded-full bg-hover px-2 py-0.5 text-[10px] text-ink-soft">
                      <span aria-hidden>↶</span> {dict.agentChat.undone}
                    </span>
                  )}
                </div>
              )}

              {/* The merge on this device kept the student's typing over this turn's edit. */}
              {item.changed && (item.setAside ?? 0) > 0 && item.undo !== "undone" && (
                <p
                  role="status"
                  data-testid="agent-set-aside"
                  className="ms-1 max-w-[94%] rounded-md border border-amber-500/40 bg-amber-400/10 px-2.5 py-1.5 text-xs leading-relaxed text-ink"
                >
                  {dict.spend.keptYours}
                  {item.undo !== "available" && <> {dict.spend.keptYoursNoUndo}</>}
                </p>
              )}
            </div>
          ),
        )}

        {busy && (
          <AgentProgressCard
            activity={activity}
            onStop={stopTask}
            stopping={stopping}
            canStop={Boolean(taskId)}
          />
        )}
      </div>

      <div className="border-t border-line p-3">
        {error && (
          <p id={errorId} role="alert" className="mb-2 px-1 text-xs text-rose-500">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2 rounded-md border border-line-strong bg-card px-3 py-2 transition focus-within:border-ink/40">
          <textarea
            dir="auto"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(text);
              }
            }}
            rows={1}
            disabled={busy}
            aria-label={dict.agentChat.placeholderIdle}
            aria-describedby={`${inputHintId}${showCost ? ` ${costHintId}` : ""}${error ? ` ${errorId}` : ""}`}
            placeholder={
              busy
                ? dict.agentChat.placeholderBusy
                : dict.agentChat.placeholderIdle
            }
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-ink placeholder:text-ink-soft/50 outline-none disabled:opacity-60"
          />
          <button
            onClick={() => send(text)}
            disabled={busy || !text.trim()}
            aria-label={dict.agentChat.send}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-lime text-lime-on transition enabled:hover:bg-lime-deep disabled:opacity-40 sm:h-9 sm:w-9"
          >
            ↑
          </button>
        </div>
        <p id={inputHintId} className="mt-1.5 px-1 text-[10px] text-ink-soft/70">
          {dict.agentChat.inputHint}
        </p>
        {showCost && (
          <p id={costHintId} className="mt-0.5 px-1 text-[10px] text-ink-soft" data-testid="agent-cost-hint">
            {t(dict.spend.agentTurn, {
              cost: plural(dict.counts.credits, messageQuote?.price ?? 0),
              max: plural(dict.counts.credits, messageQuote?.max ?? 0),
              balance: plural(dict.counts.credits, balance ?? 0),
            })}
          </p>
        )}
      </div>
    </aside>
  );
}
