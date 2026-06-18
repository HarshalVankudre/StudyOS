"use client";

import type {
  ComponentProgress,
  GenerationComponent,
  GenerationPhase,
  WorkspaceGenerationPlan,
} from "@/lib/ai/generation-progress";

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
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper antialiased">
      <div className="relative mx-auto min-h-screen max-w-5xl px-6 py-10 sm:py-14">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-ink-soft">
              Building your workspace
            </p>
            <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              {plan ? plan.workspaceName : "Designing your workspace"}
            </h2>
            <p
              className="mt-3 flex items-center gap-2.5 text-sm text-ink-soft"
              role="status"
              aria-live="polite"
            >
              <span
                className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-ink/15 border-t-ink"
                aria-hidden
              />
              {phaseMessage}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg border border-ink/15 bg-white px-3.5 py-2 text-sm text-ink-soft transition hover:border-ink/40 hover:text-ink"
          >
            Cancel
          </button>
        </div>

        <div className="mt-8 rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-ink-soft">
              {phaseLabel(phase)}
            </span>
            <span className="text-xs font-semibold text-ink">
              {Math.round(overallProgress)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink/10">
            <div
              className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(3, overallProgress)}%` }}
            />
          </div>
        </div>

        <div className="mt-9 flex items-end justify-between gap-4">
          <div>
            <h3 className="font-display text-xl font-bold">
              {plan ? "Components chosen for you" : "Planning components"}
            </h3>
            <p className="mt-1 text-sm text-ink-soft">
              Only the pages and trackers relevant to your answers.
            </p>
          </div>
          {plan && (
            <span className="text-sm text-ink-soft">
              {plan.components.length} components
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {plan
            ? plan.components.map((component) => (
                <ComponentSkeleton
                  key={component.id}
                  component={component}
                  progress={
                    componentProgress[component.id] ?? {
                      status: "queued",
                      progress: 4,
                    }
                  }
                />
              ))
            : Array.from({ length: 4 }, (_, index) => (
                <PlanningSkeleton key={index} index={index} />
              ))}
        </div>

        <p className="mt-8 text-center text-sm text-ink-soft/70">
          Everything generated stays editable — pages, fields, views, rows, and
          content.
        </p>
      </div>
    </div>
  );
}

function ComponentSkeleton({
  component,
  progress,
}: {
  component: GenerationComponent;
  progress: ComponentProgress;
}) {
  const complete = progress.status === "complete";
  const generating = progress.status === "generating";
  return (
    <article className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-ink/10 bg-paper text-lg">
            {component.icon}
          </span>
          <div className="min-w-0">
            <h4 className="truncate font-display font-bold text-ink">
              {component.label}
            </h4>
            <p
              className={`mt-0.5 text-xs ${complete ? "text-ink" : "text-ink-soft"}`}
            >
              {complete
                ? progress.detail ?? "Ready"
                : generating
                  ? "Generating…"
                  : "Queued"}
            </p>
          </div>
        </div>
        <span className="text-xs font-semibold text-ink-soft">
          {Math.round(progress.progress)}%
        </span>
      </div>

      <SkeletonPreview component={component} complete={complete} />

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            complete ? "bg-ink" : "bg-ink/40"
          }`}
          style={{ width: `${Math.max(4, progress.progress)}%` }}
        />
      </div>
    </article>
  );
}

function SkeletonPreview({
  component,
  complete,
}: {
  component: GenerationComponent;
  complete: boolean;
}) {
  if (component.kind === "planner") {
    return (
      <div className="mt-4 grid grid-cols-7 gap-1" aria-hidden>
        {Array.from({ length: 21 }, (_, index) => (
          <span
            key={index}
            className={`h-4 rounded-sm ${
              complete && [9, 12, 18].includes(index) ? "bg-ink/20" : "bg-ink/5"
            }`}
          />
        ))}
      </div>
    );
  }

  if (
    component.kind === "assignments" ||
    component.kind === "projects" ||
    component.kind === "exams"
  ) {
    return (
      <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden>
        {[2, 3, 2].map((count, column) => (
          <div key={column} className="space-y-1.5">
            <span className="block h-2 w-10 rounded-sm bg-ink/15" />
            {Array.from({ length: count }, (_, index) => (
              <span
                key={index}
                className={`block h-7 rounded-md ${
                  complete && column === 1 && index === 0
                    ? "bg-ink/15"
                    : "bg-ink/5"
                }`}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2" aria-hidden>
      {[82, 66, 91].map((width, index) => (
        <div key={width} className="flex items-center gap-2">
          <span
            className={`h-3 w-3 rounded-sm ${
              complete && index === 0 ? "bg-ink/20" : "bg-ink/[0.08]"
            }`}
          />
          <span
            className="h-2 rounded-sm bg-ink/10"
            style={{ width: `${width}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function PlanningSkeleton({ index }: { index: number }) {
  return (
    <div
      className="rounded-xl border border-ink/10 bg-white p-4"
      style={{ opacity: 1 - index * 0.12 }}
    >
      <div className="flex items-center gap-3">
        <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-ink/5" />
        <div className="flex-1 space-y-2">
          <span className="block h-3 w-2/5 animate-pulse rounded bg-ink/5" />
          <span className="block h-2 w-3/5 animate-pulse rounded bg-ink/5" />
        </div>
      </div>
      <div className="mt-5 space-y-2">
        <span className="block h-5 animate-pulse rounded bg-ink/5" />
        <span className="block h-5 animate-pulse rounded bg-ink/5" />
      </div>
    </div>
  );
}

function phaseLabel(phase: GenerationPhase) {
  switch (phase) {
    case "analyzing":
      return "Analyzing your answers";
    case "planning":
      return "Selecting components";
    case "generating":
      return "Generating workspace";
    case "validating":
      return "Validating data";
    case "saving":
      return "Saving";
  }
}
