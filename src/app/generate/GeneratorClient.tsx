"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AiActivity } from "@/components/AiActivity";
import { GenerationActivity } from "@/components/GenerationActivity";
import type {
  ComponentProgress,
  GenerationEvent,
  GenerationPhase,
  WorkspaceGenerationPlan,
} from "@/lib/ai/generation-progress";
import type { GenQuestion, QuestionAnswer } from "@/lib/ai/onboarding";
import { planQuestionsAction } from "./actions";

const EXAMPLES = [
  { emoji: "💻", text: "I'm a 1st-year CS student taking 5 courses" },
  { emoji: "⚕️", text: "Pre-med sophomore: Anatomy, Biochemistry, Physiology, Organic Chem" },
  { emoji: "🎓", text: "High school junior studying 6 subjects for finals" },
  { emoji: "📈", text: "MBA student taking Microeconomics, Accounting and Marketing" },
];

const PLAN_STEPS = [
  { label: "Reading your description" },
  { label: "Thinking of good questions" },
  { label: "Tailoring your setup" },
];

type Stage = "describe" | "questions";

export function GeneratorClient() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>("describe");
  const [planning, setPlanning] = useState(false);
  const [questions, setQuestions] = useState<GenQuestion[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [building, setBuilding] = useState(false);
  const [generationPlan, setGenerationPlan] =
    useState<WorkspaceGenerationPlan | null>(null);
  const [componentProgress, setComponentProgress] = useState<
    Record<string, ComponentProgress>
  >({});
  const [generationPhase, setGenerationPhase] =
    useState<GenerationPhase>("analyzing");
  const [phaseMessage, setPhaseMessage] = useState(
    "Reading your courses, goals, and preferences",
  );
  const [overallProgress, setOverallProgress] = useState(4);
  const generationController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      generationController.current?.abort();
    },
    [],
  );

  // Step 1 → 2: turn the description into tailored questions.
  const askQuestions = async (text: string) => {
    const value = text.trim();
    if (!value || planning || building) return;
    setPrompt(value);
    setError(null);
    setPlanning(true);
    try {
      const qs = await planQuestionsAction(value);
      setQuestions(qs);
      setSelected({});
      setStage("questions");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPlanning(false);
    }
  };

  const toggle = (q: GenQuestion, optionId: string) =>
    setSelected((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.type === "single") {
        return { ...prev, [q.id]: cur[0] === optionId ? [] : [optionId] };
      }
      return {
        ...prev,
        [q.id]: cur.includes(optionId)
          ? cur.filter((x) => x !== optionId)
          : [...cur, optionId],
      };
    });

  // Step 2 → done: generate with the chosen answers (skips are fine — empty).
  const build = async () => {
    if (building) return;
    const answers: QuestionAnswer[] = questions
      .map((q) => ({
        question: q.question,
        answers: (selected[q.id] ?? []).map(
          (oid) => q.options.find((o) => o.id === oid)?.label ?? oid,
        ),
      }))
      .filter((a) => a.answers.length > 0);

    setError(null);
    setBuilding(true);
    setGenerationPlan(null);
    setComponentProgress({});
    setGenerationPhase("analyzing");
    setPhaseMessage("Reading your courses, goals, and preferences");
    setOverallProgress(4);

    const controller = new AbortController();
    generationController.current = controller;
    let completed = false;

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, answers }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Generation request failed");
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
          const event = JSON.parse(line) as GenerationEvent;
          if (event.type === "phase") {
            setGenerationPhase(event.phase);
            setPhaseMessage(event.message);
            setOverallProgress((current) =>
              Math.max(current, event.progress),
            );
          } else if (event.type === "plan") {
            setGenerationPlan(event.plan);
            setComponentProgress(
              Object.fromEntries(
                event.plan.components.map((component) => [
                  component.id,
                  { status: "queued", progress: 4 },
                ]),
              ),
            );
          } else if (event.type === "component") {
            setComponentProgress((current) => {
              const next = {
                ...current,
                [event.componentId]: {
                  status: event.status,
                  progress: event.progress,
                  detail: event.detail,
                },
              };
              const values = Object.values(next);
              if (values.length > 0) {
                const average =
                  values.reduce((sum, item) => sum + item.progress, 0) /
                  values.length;
                setOverallProgress((value) =>
                  Math.max(value, Math.min(86, 28 + average * 0.58)),
                );
              }
              return next;
            });
          } else if (event.type === "complete") {
            completed = true;
            setOverallProgress(100);
            router.push(`/app/${event.workspaceId}`);
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }

        if (done) break;
      }

      if (!completed) throw new Error("Generation ended before saving");
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Something went wrong generating your workspace. Try again.",
        );
      }
    } finally {
      generationController.current = null;
      if (!completed) setBuilding(false);
    }
  };

  const cancelBuild = () => {
    generationController.current?.abort();
    generationController.current = null;
    setBuilding(false);
    setGenerationPlan(null);
    setComponentProgress({});
    setOverallProgress(4);
  };

  const answeredCount = questions.filter(
    (q) => (selected[q.id] ?? []).length > 0,
  ).length;

  return (
    <main className="relative min-h-screen bg-paper text-ink antialiased">
      {planning && (
        <AiActivity fullscreen title="Getting to know you" steps={PLAN_STEPS} />
      )}
      {building && (
        <GenerationActivity
          plan={generationPlan}
          componentProgress={componentProgress}
          phase={generationPhase}
          phaseMessage={phaseMessage}
          overallProgress={overallProgress}
          onCancel={cancelBuild}
        />
      )}

      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <Link
            href="/app"
            className="text-sm text-ink-soft transition hover:text-ink"
          >
            Your workspaces →
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col px-6 pb-24 pt-14 sm:pt-20">
        {stage === "describe" ? (
          <DescribeStage
            prompt={prompt}
            setPrompt={setPrompt}
            busy={planning}
            onContinue={() => askQuestions(prompt)}
            onExample={askQuestions}
          />
        ) : (
          <QuestionsStage
            prompt={prompt}
            questions={questions}
            selected={selected}
            answeredCount={answeredCount}
            toggle={toggle}
            building={building}
            onBack={() => setStage("describe")}
            onBuild={build}
          />
        )}

        {error && <p className="mt-7 text-sm text-rose-600">{error}</p>}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Stage 1 — describe your studies
// ---------------------------------------------------------------------------

function DescribeStage({
  prompt,
  setPrompt,
  busy,
  onContinue,
  onExample,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  busy: boolean;
  onContinue: () => void;
  onExample: (text: string) => void;
}) {
  return (
    <>
      <p className="text-sm font-medium text-ink-soft">Step 1 of 2</p>
      <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
        What are you studying?
      </h1>
      <p className="mt-4 max-w-md text-lg leading-relaxed text-ink-soft">
        Describe your courses and goals in plain English. StudyOS asks a couple
        of quick questions, then designs the whole workspace around your answers.
      </p>

      <div className="mt-8 rounded-xl border border-ink/15 bg-white shadow-sm transition focus-within:border-ink/40">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onContinue();
          }}
          placeholder="e.g. I'm a 1st-year CS student taking Data Structures, Discrete Math, Calculus II and Academic Writing this semester."
          rows={3}
          disabled={busy}
          className="w-full resize-none bg-transparent px-4 py-4 text-[15px] leading-relaxed text-ink placeholder:text-ink-soft/55 focus:outline-none disabled:opacity-60"
        />
        <div className="flex items-center justify-between border-t border-ink/10 px-4 py-3">
          <span className="text-xs text-ink-soft">⌘ / Ctrl + Enter</span>
          <button
            onClick={onContinue}
            disabled={busy || !prompt.trim()}
            className="flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition enabled:hover:bg-ink/90 disabled:opacity-40"
          >
            Continue <span aria-hidden>→</span>
          </button>
        </div>
      </div>

      <div className="mt-8">
        <p className="mb-3 text-sm text-ink-soft">Not sure? Start from an example</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.text}
              onClick={() => onExample(ex.text)}
              disabled={busy}
              className="group flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-3.5 py-2 text-left text-sm transition hover:border-ink/40 disabled:opacity-50"
            >
              <span>{ex.emoji}</span>
              <span className="text-ink-soft transition group-hover:text-ink">
                {ex.text}
              </span>
            </button>
          ))}
        </div>
      </div>

      <p className="mt-10 text-sm text-ink-soft/70">
        Free · no credit card · ready in seconds
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Stage 2 — answer a few questions
// ---------------------------------------------------------------------------

function QuestionsStage({
  prompt,
  questions,
  selected,
  answeredCount,
  toggle,
  building,
  onBack,
  onBuild,
}: {
  prompt: string;
  questions: GenQuestion[];
  selected: Record<string, string[]>;
  answeredCount: number;
  toggle: (q: GenQuestion, optionId: string) => void;
  building: boolean;
  onBack: () => void;
  onBuild: () => void;
}) {
  return (
    <>
      <button
        onClick={onBack}
        disabled={building}
        className="mb-5 self-start text-sm text-ink-soft transition hover:text-ink disabled:opacity-50"
      >
        ← Edit description
      </button>

      <p className="text-sm font-medium text-ink-soft">Step 2 of 2</p>
      <h1 className="mt-4 font-display text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl">
        Let&rsquo;s tailor it
      </h1>
      <p className="mt-3 line-clamp-2 max-w-xl text-sm text-ink-soft">
        Designing for: <span className="text-ink">“{prompt}”</span>
      </p>

      <div className="mt-8 space-y-4">
        {questions.map((q, qi) => {
          const chosen = selected[q.id] ?? [];
          return (
            <div
              key={q.id}
              className="reveal rounded-xl border border-ink/10 bg-white p-5 shadow-sm"
              style={{ animationDelay: `${qi * 70}ms` }}
            >
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-ink">
                  {q.question}
                </h2>
                <span className="shrink-0 text-xs text-ink-soft/70">
                  {q.type === "multi" ? "pick any" : "pick one"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {q.options.map((o) => {
                  const on = chosen.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      onClick={() => toggle(q, o.id)}
                      disabled={building}
                      aria-pressed={on}
                      className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm transition disabled:opacity-60 ${
                        on
                          ? "border-ink bg-ink font-medium text-paper"
                          : "border-ink/15 bg-white text-ink-soft hover:border-ink/40 hover:text-ink"
                      }`}
                    >
                      {o.emoji && <span>{o.emoji}</span>}
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          onClick={onBuild}
          disabled={building}
          className="flex items-center gap-2 rounded-lg bg-ink px-6 py-3 text-sm font-semibold text-paper transition enabled:hover:bg-ink/90 disabled:opacity-40"
        >
          Build my workspace <span aria-hidden>→</span>
        </button>
        <span className="text-sm text-ink-soft">
          {answeredCount === 0
            ? "Answer some, or just build — your call"
            : `${answeredCount} / ${questions.length} answered`}
        </span>
      </div>
    </>
  );
}
