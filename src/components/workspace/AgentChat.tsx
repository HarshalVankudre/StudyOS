"use client";

import { useEffect, useRef, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { useI18n } from "@/lib/i18n/client";
import type {
  AgentArea,
  AgentAreaStatus,
  AgentChoice,
  AgentMessage,
  AgentPhase,
  AgentStreamEvent,
} from "@/lib/ai/agent-shared";
import type { Workspace } from "@/lib/workspace/types";

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelContent?: string;
  changed?: boolean;
  choices?: AgentChoice[];
  affectedAreas?: AgentArea[];
}

interface AreaProgress {
  status: AgentAreaStatus;
  progress: number;
}

interface AgentActivityState {
  phase: AgentPhase;
  message: string;
  progress: number;
  summary?: string;
  areas: AgentArea[];
  areaProgress: Record<string, AreaProgress>;
}

const INITIAL_ACTIVITY: AgentActivityState = {
  phase: "inspecting",
  message: "",
  progress: 4,
  areas: [],
  areaProgress: {},
};

export function AgentChat({
  workspaceId,
  onApplied,
  onClose,
}: {
  workspaceId: string;
  onApplied: (ws: Workspace) => void;
  onClose: () => void;
}) {
  const { dict } = useI18n();
  const initialActivity: AgentActivityState = {
    ...INITIAL_ACTIVITY,
    message: dict.agentChat.initialMessage,
  };
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] =
    useState<AgentActivityState>(initialActivity);
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
  const [otherReplies, setOtherReplies] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

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

          if (event.type === "phase") {
            setActivity((current) => ({
              ...current,
              phase: event.phase,
              message: event.message,
              progress: Math.max(current.progress, event.progress),
            }));
          } else if (event.type === "plan") {
            setActivity((current) => ({
              ...current,
              summary: event.summary,
              areas: event.areas,
              areaProgress: Object.fromEntries(
                event.areas.map((area) => [
                  area.id,
                  { status: "queued", progress: 6 },
                ]),
              ),
            }));
          } else if (event.type === "area") {
            setActivity((current) => {
              const areaProgress = {
                ...current.areaProgress,
                [event.areaId]: {
                  status: event.status,
                  progress: event.progress,
                },
              };
              const values = Object.values(areaProgress);
              const average =
                values.length > 0
                  ? values.reduce((sum, item) => sum + item.progress, 0) /
                    values.length
                  : 0;
              return {
                ...current,
                areaProgress,
                progress: Math.max(
                  current.progress,
                  Math.min(87, 30 + average * 0.57),
                ),
              };
            });
          } else if (event.type === "result") {
            receivedResult = true;
            setActivity((current) => ({ ...current, progress: 100 }));
            setItems((previous) => [
              ...previous,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: event.response.reply,
                changed: event.response.changed,
                choices: event.response.choices,
                affectedAreas: event.response.affectedAreas,
              },
            ]);
            if (event.response.changed && event.response.workspace) {
              onApplied(event.response.workspace);
            }
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
    } finally {
      controllerRef.current = null;
      setBusy(false);
    }
  };

  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
  };

  return (
    <aside className="flex w-[390px] shrink-0 flex-col border-l border-line bg-paper">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink">
            {busy && (
              <span className="ai-ring absolute inset-0 rounded-full bg-lime/30" />
            )}
            <span
              className={`relative h-2 w-2 rounded-full bg-lime ${
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
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-sm text-paper">
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
                      className="group flex items-center justify-between rounded-md border border-line-strong bg-card px-3 py-2 text-left text-sm text-ink transition hover:border-ink hover:bg-lime/20 disabled:opacity-50"
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
                        ? "border-ink bg-ink text-paper"
                        : "border-line-strong bg-card text-ink hover:border-ink hover:bg-lime/20"
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
                        className="rounded-md bg-ink px-2.5 py-1.5 text-xs font-semibold text-paper transition enabled:hover:bg-ink/85 disabled:opacity-40"
                      >
                        {dict.agentChat.send}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {item.changed && (
                <div className="ml-1 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full bg-lime/35 px-2 py-0.5 text-[10px] font-semibold text-ink ring-1 ring-inset ring-lime-deep/40">
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
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-ink text-paper transition enabled:hover:bg-ink/90 disabled:opacity-40"
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

function AgentProgressCard({
  activity,
  onCancel,
}: {
  activity: AgentActivityState;
  onCancel: () => void;
}) {
  const { dict } = useI18n();
  return (
    <div
      className="ai-pop overflow-hidden rounded-md border border-line-strong bg-card shadow-[0_16px_40px_-28px_rgba(26,23,18,0.55)]"
      role="status"
      aria-live="polite"
    >
      <div className="relative overflow-hidden border-b border-line bg-ink px-4 py-3 text-paper">
        <div
          className="paper-grid pointer-events-none absolute inset-0 opacity-[0.07]"
          aria-hidden
        />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="ai-orb grid h-6 w-6 place-items-center rounded-full bg-lime text-xs text-ink">
                ✦
              </span>
              <span className="font-display text-sm font-bold">
                {dict.agentChat.buildingUpdate}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-paper/60">{activity.message}</p>
          </div>
          <button
            onClick={onCancel}
            className="font-mono text-[9px] uppercase tracking-wider text-paper/50 transition hover:text-paper"
          >
            {dict.common.cancel}
          </button>
        </div>

        <div className="relative mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper/15">
            <div
              className="h-full rounded-full bg-lime transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(4, activity.progress)}%` }}
            />
          </div>
          <span className="font-mono text-[10px] font-semibold text-lime">
            {Math.round(activity.progress)}%
          </span>
        </div>
      </div>

      <div className="p-3">
        {activity.summary && (
          <p className="mb-3 text-xs leading-relaxed text-ink-soft">
            {activity.summary}
          </p>
        )}

        {activity.areas.length > 0 ? (
          <div className="space-y-2">
            {activity.areas.map((area) => {
              const state = activity.areaProgress[area.id] ?? {
                status: "queued" as const,
                progress: 6,
              };
              return (
                <div key={area.id} className="flex items-center gap-2.5">
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border text-xs ${
                      state.status === "complete"
                        ? "border-lime-deep bg-lime/40"
                        : state.status === "working"
                          ? "border-line-strong bg-paper"
                          : "border-line bg-card"
                    }`}
                  >
                    {state.status === "complete" ? "✓" : (area.icon ?? "•")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-ink">
                        {area.label}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-ink-soft">
                        {dict.agentChat.areaStatus[state.status]}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink/[0.07]">
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ${
                          state.status === "complete"
                            ? "bg-ink"
                            : "bg-lime-deep"
                        }`}
                        style={{ width: `${Math.max(4, state.progress)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {[
              [dict.agentChat.steps.inspect, activity.progress >= 16],
              [dict.agentChat.steps.decide, activity.progress >= 25],
              [dict.agentChat.steps.prepare, activity.progress >= 34],
            ].map(([label, done]) => (
              <div
                key={String(label)}
                className="flex items-center gap-2 text-xs text-ink-soft"
              >
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
                    done ? "bg-lime text-ink" : "bg-hover"
                  }`}
                >
                  {done ? "✓" : "·"}
                </span>
                {label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
