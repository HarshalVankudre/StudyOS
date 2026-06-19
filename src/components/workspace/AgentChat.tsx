"use client";

import { useEffect, useRef, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { useI18n } from "@/lib/i18n/client";
import type {
  AgentArea,
  AgentChoice,
  AgentMessage,
  AgentResponse,
  AgentStreamEvent,
} from "@/lib/ai/agent-shared";
import {
  createInitialAgentActivity,
  reduceAgentActivity,
} from "@/lib/ai/progress";
import type { Workspace } from "@/lib/workspace/types";
import { AgentProgressCard } from "./AgentProgressCard";
import { AgentUndoButton } from "./AgentUndoButton";

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelContent?: string;
  changed?: boolean;
  choices?: AgentChoice[];
  affectedAreas?: AgentArea[];
  changeId?: string;
  undone?: boolean;
}

export function AgentChat({
  workspaceId,
  onApplied,
  onClose,
  onBusyChange,
}: {
  workspaceId: string;
  onApplied: (ws: Workspace) => void;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { dict } = useI18n();
  const initialActivity = createInitialAgentActivity(
    dict.agentChat.initialMessage,
  );
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState(initialActivity);
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
  const [otherReplies, setOtherReplies] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const taskIdRef = useRef<string | null>(null);

  // Propagate busy state to the editor so it can suppress autosave while the
  // agent is processing (avoids a workspace version conflict on commit).
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // Render a completed agent result: append the assistant turn and reflect the
  // applied workspace live. Used by both the live stream and a reconnect.
  const applyResult = (response: AgentResponse) => {
    setItems((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.reply,
        changed: response.changed,
        changeId: response.changeId,
        choices: response.choices,
        affectedAreas: response.affectedAreas,
      },
    ]);
    if (response.changed && response.workspace) onApplied(response.workspace);
  };

  // After a dropped stream, the task may have finished server-side. Poll the
  // durable record briefly and, if it completed, render its result.
  const recoverTask = async (taskId: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const res = await fetch(`/api/agent/task/${taskId}`);
        const body = res.ok ? await res.json().catch(() => null) : null;
        if (body?.status === "done" && body.response) {
          applyResult(body.response as AgentResponse);
          return true;
        }
        if (body?.status && body.status !== "running") return false;
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

  const send = async (
    raw: string,
    displayText = raw,
    resolveItemId?: string,
  ) => {
    const message = raw.trim();
    if (!message || busy) return;
    setError(null);
    setText("");

    const history: AgentMessage[] = items.map((item) => ({
      role: item.role,
      content: item.modelContent ?? item.content,
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
    setBusy(true);
    setActivity(initialActivity);

    const controller = new AbortController();
    controllerRef.current = controller;
    taskIdRef.current = null;
    let receivedResult = false;

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, history, message }),
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
          } else if (event.type === "phase" || event.type === "discovery") {
            setActivity((current) => reduceAgentActivity(current, event));
          } else if (event.type === "result") {
            receivedResult = true;
            setActivity((current) => reduceAgentActivity(current, event));
            applyResult(event.response);
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }

        if (done) break;
      }

      if (!receivedResult)
        throw new Error(dict.agentChat.errorEndedUnexpectedly);
    } catch (cause) {
      if (!controller.signal.aborted) {
        const recovered =
          taskIdRef.current && !receivedResult
            ? await recoverTask(taskIdRef.current)
            : false;
        if (!recovered) {
          const message =
            cause instanceof Error
              ? cause.message
              : dict.agentChat.errorSnag;
          setError(message);
          setItems((previous) => [
            ...previous,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: dict.agentChat.errorCouldntComplete,
            },
          ]);
        }
      }
    } finally {
      controllerRef.current = null;
      setBusy(false);
    }
  };

  const cancel = () => {
    // Cancel server-side too, so a task already past the stream still won't be
    // applied; then abort the local stream.
    const id = taskIdRef.current;
    if (id) {
      void fetch(`/api/agent/task/${id}/cancel`, { method: "POST" }).catch(
        () => {},
      );
    }
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
  };

  return (
    <aside className="flex w-[390px] shrink-0 flex-col border-l border-line bg-paper">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
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
          <div className="leading-tight">
            <p className="font-display text-sm font-bold text-ink">{dict.agentChat.title}</p>
            <p className="text-[11px] text-ink-soft">
              {busy
                ? dict.agentChat.phase[activity.phase]
                : dict.agentChat.subtitleIdle}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label={dict.agentChat.closeChat}
          className="rounded p-1 text-ink-soft/60 transition hover:bg-hover hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
                  className="rounded-md border border-line-strong bg-card px-3 py-2 text-left text-sm text-ink-soft transition hover:border-ink/40 hover:text-ink"
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
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-lime px-3.5 py-2 text-sm text-lime-on">
                {item.content}
              </div>
            </div>
          ) : (
            <div key={item.id} className="flex flex-col items-start gap-1.5">
              <div className="max-w-[94%] rounded-2xl rounded-bl-sm border border-line bg-card px-3.5 py-2 text-sm text-ink">
                <MessageResponse>{item.content}</MessageResponse>
              </div>

              {item.choices && item.choices.length > 0 && (
                <div className="grid w-[94%] gap-1.5 pt-1">
                  {item.choices.map((choice) => (
                    <button
                      key={choice.id}
                      onClick={() =>
                        send(choice.value, choice.label, item.id)
                      }
                      disabled={busy}
                      className="group flex items-center justify-between rounded-md border border-line-strong bg-card px-3 py-2 text-left text-sm text-ink transition hover:border-lime hover:bg-lime/10 disabled:opacity-50"
                    >
                      <span>{choice.label}</span>
                      <span className="text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-ink">
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
                    className={`group flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition disabled:opacity-50 ${
                      otherOpen[item.id]
                        ? "border-lime bg-lime text-lime-on"
                        : "border-line-strong bg-card text-ink hover:border-lime hover:bg-lime/10"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>✍️</span>
                      Other
                    </span>
                    <span
                      className={`transition ${
                        otherOpen[item.id]
                          ? "rotate-90 text-paper/60"
                          : "text-ink-soft group-hover:translate-x-0.5 group-hover:text-ink"
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
                        placeholder="Type your own answer…"
                        aria-label="Type another answer"
                        className="min-w-0 flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-soft/50"
                      />
                      <button
                        onClick={() => {
                          const reply = otherReplies[item.id]?.trim();
                          if (reply) send(reply, reply, item.id);
                        }}
                        disabled={busy || !otherReplies[item.id]?.trim()}
                        className="rounded-md bg-lime px-2.5 py-1.5 text-xs font-semibold text-lime-on transition enabled:hover:bg-lime-deep disabled:opacity-40"
                      >
                        {dict.agentChat.send}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {item.changed && (
                <div className="ml-1 flex flex-wrap items-center gap-1.5">
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
                  {item.changeId && !item.undone && (
                    <AgentUndoButton
                      changeId={item.changeId}
                      onUndone={(restored) => {
                        onApplied(restored);
                        setItems((previous) =>
                          previous.map((candidate) =>
                            candidate.id === item.id
                              ? { ...candidate, undone: true }
                              : candidate,
                          ),
                        );
                      }}
                    />
                  )}
                  {item.undone && (
                    <span className="rounded-full bg-hover px-2 py-0.5 text-[10px] text-ink-soft">
                      <span aria-hidden>↶</span> {dict.agentChat.undone}
                    </span>
                  )}
                </div>
              )}
            </div>
          ),
        )}

        {busy && <AgentProgressCard activity={activity} onCancel={cancel} />}
      </div>

      <div className="border-t border-line p-3">
        {error && <p className="mb-2 px-1 text-xs text-rose-500">{error}</p>}
        <div className="flex items-end gap-2 rounded-md border border-line-strong bg-card px-3 py-2 transition focus-within:border-ink/40">
          <textarea
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
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-lime text-lime-on transition enabled:hover:bg-lime-deep disabled:opacity-40"
          >
            ↑
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-ink-soft/70">
          {dict.agentChat.inputHint}
        </p>
      </div>
    </aside>
  );
}
