"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type {
  ComponentProgress,
  GenerationComponent,
  GenerationComponentKind,
  GenerationPhase,
  WorkspaceGenerationPlan,
} from "@/lib/ai/generation-progress";

/**
 * "Watch your workspace build itself."
 *
 * Instead of a bare progress bar, this renders a faux editor window that
 * assembles live as the generation stream arrives: pages pop into the sidebar,
 * and the section currently being written fills in row by row / card by card,
 * driven by each component's real streamed `progress`. The point is to make the
 * wait feel like visible work on the user's own workspace.
 */
export function GenerationActivity({
  plan,
  componentProgress,
  phase,
  phaseMessage,
  overallProgress,
  onCancel,
}: {
  plan: WorkspaceGenerationPlan | null;
  componentProgress: Record<string, ComponentProgress>;
  phase: GenerationPhase;
  phaseMessage: string;
  overallProgress: number;
  onCancel: () => void;
}) {
  const { dict, t } = useI18n();
  const components = plan?.components ?? [];
  const progressFor = (id: string): ComponentProgress =>
    componentProgress[id] ?? { status: "queued", progress: 4 };

  const builtCount = components.filter(
    (c) => progressFor(c.id).status === "complete",
  ).length;

  // The section to feature in the canvas: whatever's being written now, else
  // the next one queued, else the last finished one.
  const active =
    components.find((c) => progressFor(c.id).status === "generating") ??
    components.find((c) => progressFor(c.id).status === "queued") ??
    components[components.length - 1];

  const typedName = useTypewriter(plan?.workspaceName ?? "");
  const nearlyDone = overallProgress >= 99 || phase === "saving";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper antialiased">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-8 sm:py-12">
        {/* Status */}
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-ink-soft">
              <span
                className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-ink/15 border-t-ink"
                aria-hidden
              />
              {nearlyDone ? dict.genActivity.finishingUp : dict.genActivity.building}
            </p>
            <h2 className="mt-2 truncate font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              {plan ? typedName || " " : dict.genActivity.designing}
              {plan && typedName.length < (plan.workspaceName?.length ?? 0) && (
                <span className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[2px] animate-pulse bg-ink" />
              )}
            </h2>
            <p
              className="ai-fade mt-2 text-sm text-ink-soft"
              role="status"
              aria-live="polite"
              key={phaseMessage}
            >
              {phaseMessage}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="shrink-0 rounded-lg border border-ink/15 bg-white px-3.5 py-2 text-sm text-ink-soft transition hover:border-ink/40 hover:text-ink"
          >
            {dict.common.cancel}
          </button>
        </div>

        {/* The workspace, building itself */}
        <div className="mt-7 flex-1 overflow-hidden rounded-2xl border border-ink/12 bg-white shadow-[0_30px_70px_-42px_rgba(26,23,18,0.45)]">
          {/* Title bar */}
          <div className="flex items-center gap-2 border-b border-ink/10 bg-paper/60 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-ink/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-ink/10" />
            <span className="ml-2 truncate font-display text-sm font-bold text-ink">
              {plan
                ? typedName || dict.genActivity.yourWorkspace
                : dict.genActivity.yourWorkspace}
            </span>
          </div>

          <div className="grid min-h-[360px] grid-cols-[150px_1fr] sm:grid-cols-[190px_1fr]">
            {/* Sidebar — pages appear as they're planned */}
            <div className="border-r border-ink/10 bg-paper/40 p-3">
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-soft/60">
                {dict.genActivity.pagesLabel}
              </p>
              <div className="space-y-0.5">
                {plan
                  ? components.map((c, i) => {
                      const p = progressFor(c.id);
                      const isActive = active?.id === c.id && p.status !== "complete";
                      return (
                        <div
                          key={c.id}
                          className={`reveal flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                            isActive
                              ? "bg-ink/[0.06] text-ink"
                              : p.status === "complete"
                                ? "text-ink"
                                : "text-ink-soft/45"
                          }`}
                          style={{ animationDelay: `${i * 70}ms` }}
                        >
                          <span className="w-4 shrink-0 text-center text-xs">
                            {c.icon}
                          </span>
                          <span className="flex-1 truncate text-[13px]">
                            {c.label}
                          </span>
                          {p.status === "complete" ? (
                            <Check
                              className="h-3.5 w-3.5 shrink-0 text-ink/45"
                              strokeWidth={3}
                            />
                          ) : isActive ? (
                            <LiveDot />
                          ) : null}
                        </div>
                      );
                    })
                  : Array.from({ length: 4 }, (_, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-2 py-1.5"
                        style={{ opacity: 1 - i * 0.18 }}
                      >
                        <span className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-ink/10" />
                        <span className="h-2.5 flex-1 animate-pulse rounded-full bg-ink/10" />
                      </div>
                    ))}
              </div>
            </div>

            {/* Canvas — the active section writes itself in */}
            <div className="p-5 sm:p-6">
              {plan && active ? (
                <SectionCanvas component={active} cp={progressFor(active.id)} />
              ) : (
                <PlanningCanvas />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between text-sm">
          <span className="font-medium text-ink-soft">
            {plan
              ? t(dict.genActivity.sectionsBuilt, {
                  built: builtCount,
                  total: components.length,
                })
              : dict.genActivity.choosingPieces}
          </span>
          <span className="hidden text-ink-soft/70 sm:block">
            {dict.genActivity.stillEditable}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas: one section assembling itself                               */
/* ------------------------------------------------------------------ */

type Layout = "table" | "board" | "calendar" | "dashboard" | "list";

function layoutFor(kind: GenerationComponentKind): Layout {
  if (kind === "planner") return "calendar";
  if (kind === "assignments" || kind === "projects" || kind === "exams")
    return "board";
  if (kind === "dashboard") return "dashboard";
  if (kind === "courses" || kind === "grades") return "table";
  return "list";
}

/** How many of `total` items should be filled in at this progress. */
function fillCount(cp: ComponentProgress, total: number): number {
  if (cp.status === "complete") return total;
  if (cp.status === "queued") return 0;
  return Math.max(1, Math.min(total, Math.round((cp.progress / 100) * total)));
}

function SectionCanvas({
  component,
  cp,
}: {
  component: GenerationComponent;
  cp: ComponentProgress;
}) {
  const { dict } = useI18n();
  const layout = layoutFor(component.kind);
  const done = cp.status === "complete";
  return (
    // key on id => cross-fades when the active section changes
    <div key={component.id} className="ai-fade">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ink/10 bg-paper text-lg">
          {component.icon}
        </span>
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-bold leading-tight text-ink">
            {component.label}
          </h3>
          <p className="text-xs text-ink-soft">
            {done
              ? cp.detail ?? dict.genActivity.statusReady
              : dict.genActivity.writingItIn}
          </p>
        </div>
      </div>

      {layout === "table" && <TableBuild cp={cp} />}
      {layout === "board" && <BoardBuild cp={cp} />}
      {layout === "calendar" && <CalendarBuild cp={cp} />}
      {layout === "dashboard" && <DashboardBuild cp={cp} />}
      {layout === "list" && <ListBuild cp={cp} />}
    </div>
  );
}

function Bar({
  on,
  shade = "bg-ink/70",
  className = "",
}: {
  on: boolean;
  shade?: string;
  className?: string;
}) {
  return (
    <span
      className={`block h-2.5 rounded-full transition-colors duration-500 ${
        on ? shade : "bg-ink/[0.07]"
      } ${className}`}
    />
  );
}

function TableBuild({ cp }: { cp: ComponentProgress }) {
  const rows = 5;
  const shown = fillCount(cp, rows);
  return (
    <div className="overflow-hidden rounded-lg border border-ink/10">
      <div className="flex items-center gap-3 border-b border-ink/10 bg-paper/50 px-3 py-2">
        <span className="h-2 flex-[1.6] rounded-full bg-ink/20" />
        <span className="h-2 flex-1 rounded-full bg-ink/20" />
        <span className="h-2 flex-[0.7] rounded-full bg-ink/20" />
      </div>
      <div className="divide-y divide-ink/[0.06]">
        {Array.from({ length: rows }, (_, i) => {
          const on = i < shown;
          const writing = cp.status === "generating" && i === shown - 1;
          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-3 py-2.5 transition-opacity duration-500 ${
                on ? "opacity-100" : "opacity-45"
              } ${writing ? "bg-lime/[0.06]" : ""}`}
            >
              <Bar on={on} shade="bg-ink/70" className="flex-[1.6]" />
              <Bar on={on} shade="bg-ink/35" className="flex-1" />
              <Bar on={on} shade="bg-ink/25" className="flex-[0.7]" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListBuild({ cp }: { cp: ComponentProgress }) {
  const rows = 5;
  const shown = fillCount(cp, rows);
  const widths = ["86%", "72%", "90%", "64%", "80%"];
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }, (_, i) => {
        const on = i < shown;
        const writing = cp.status === "generating" && i === shown - 1;
        return (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all duration-500 ${
              on ? "border-ink/10 bg-white opacity-100" : "border-transparent opacity-45"
            } ${writing ? "ring-1 ring-lime/40" : ""}`}
          >
            <span
              className={`h-4 w-4 shrink-0 rounded transition-colors duration-500 ${
                on ? "bg-ink/15" : "bg-ink/[0.07]"
              }`}
            />
            <span
              className={`h-2 rounded-full transition-colors duration-500 ${
                on ? "bg-ink/45" : "bg-ink/[0.07]"
              }`}
              style={{ width: widths[i] }}
            />
          </div>
        );
      })}
    </div>
  );
}

function BoardBuild({ cp }: { cp: ComponentProgress }) {
  const { dict } = useI18n();
  const columns = [
    { label: dict.genActivity.board.todo, slots: 2 },
    { label: dict.genActivity.board.doing, slots: 2 },
    { label: dict.genActivity.board.done, slots: 1 },
  ];
  const total = columns.reduce((s, c) => s + c.slots, 0);
  const shown = fillCount(cp, total);
  let seen = 0;
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {columns.map((col) => (
        <div key={col.label} className="space-y-2">
          <span className="block w-fit rounded-md bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium text-ink-soft">
            {col.label}
          </span>
          {Array.from({ length: col.slots }, (_, i) => {
            const idx = seen++;
            const on = idx < shown;
            return (
              <div
                key={i}
                className={`rounded-lg border p-2.5 transition-all duration-500 ${
                  on
                    ? "translate-y-0 border-ink/10 bg-white opacity-100 shadow-sm"
                    : "translate-y-1 border-dashed border-ink/10 bg-paper/40 opacity-50"
                }`}
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <Bar on={on} shade="bg-ink/55" className="!h-2" />
                <span
                  className={`mt-2 block h-1.5 w-1/2 rounded-full transition-colors duration-500 ${
                    on ? "bg-ink/20" : "bg-ink/[0.06]"
                  }`}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function CalendarBuild({ cp }: { cp: ComponentProgress }) {
  const cells = 35;
  const shown = fillCount(cp, cells);
  return (
    <div>
      <div className="mb-1.5 grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="mx-auto h-1.5 w-4 rounded-full bg-ink/15" />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: cells }, (_, i) => {
          const on = i < shown;
          const event = on && [4, 9, 15, 20, 27, 31].includes(i);
          return (
            <div
              key={i}
              className={`relative aspect-square rounded-md border transition-all duration-500 ${
                on ? "border-ink/10 bg-white" : "border-transparent bg-ink/[0.04]"
              }`}
              style={{ transitionDelay: `${(i % 7) * 25}ms` }}
            >
              {event && (
                <span className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-ink/55" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardBuild({ cp }: { cp: ComponentProgress }) {
  const stats = 3;
  const listRows = 3;
  const total = stats + listRows;
  const shown = fillCount(cp, total);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: stats }, (_, i) => {
          const on = i < shown;
          return (
            <div
              key={i}
              className={`rounded-lg border p-3 transition-all duration-500 ${
                on ? "border-ink/10 bg-white opacity-100" : "border-ink/[0.06] opacity-45"
              }`}
            >
              <span
                className={`block h-1.5 w-2/3 rounded-full transition-colors duration-500 ${
                  on ? "bg-ink/20" : "bg-ink/[0.07]"
                }`}
              />
              <span
                className={`mt-2.5 block h-4 w-1/2 rounded transition-colors duration-500 ${
                  on ? "bg-ink/70" : "bg-ink/[0.07]"
                }`}
              />
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        {Array.from({ length: listRows }, (_, i) => {
          const on = stats + i < shown;
          return (
            <div
              key={i}
              className={`flex items-center gap-3 transition-opacity duration-500 ${
                on ? "opacity-100" : "opacity-45"
              }`}
            >
              <span
                className={`h-3.5 w-3.5 shrink-0 rounded transition-colors duration-500 ${
                  on ? "bg-ink/15" : "bg-ink/[0.07]"
                }`}
              />
              <Bar on={on} shade="bg-ink/40" className="!h-2 flex-1" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanningCanvas() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-ink/5" />
        <div className="flex-1 space-y-2">
          <span className="block h-3 w-1/3 animate-pulse rounded bg-ink/5" />
          <span className="block h-2 w-1/2 animate-pulse rounded bg-ink/5" />
        </div>
      </div>
      <div className="space-y-2 pt-2">
        {Array.from({ length: 4 }, (_, i) => (
          <span
            key={i}
            className="block h-9 animate-pulse rounded-lg bg-ink/5"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
    </span>
  );
}

/** Reveals `text` one character at a time — a small "typing" flourish. */
function useTypewriter(text: string, speed = 42): string {
  const [count, setCount] = useState(0);
  const ref = useRef(text);
  ref.current = text;
  useEffect(() => {
    setCount(0);
    if (!text) return;
    const id = setInterval(() => {
      setCount((c) => {
        if (c >= ref.current.length) {
          clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return text.slice(0, count);
}
