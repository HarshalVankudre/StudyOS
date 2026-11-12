"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CircleStop, Coins, LoaderCircle, RotateCcw, TriangleAlert, Upload } from "lucide-react";
import { AiActivity } from "@/components/AiActivity";
import { GenerationActivity } from "@/components/GenerationActivity";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type {
  ComponentProgress,
  GenerationEvent,
  GenerationPhase,
  WorkspaceGenerationPlan,
} from "@/lib/ai/generation-progress";
import type { GenQuestion, QuestionAnswer } from "@/lib/ai/onboarding";
import { TIME_ZONE_COOKIE, validTimeZone } from "@/lib/ai/student-clock";
import {
  MAX_SOURCE_INPUT,
  MAX_SOURCE_TEXT,
  MAX_UPLOAD_BYTES,
} from "@/lib/import/syllabus";
import { useI18n } from "@/lib/i18n/client";
import { refreshCreditsBalance, useLiveBalance } from "@/lib/credits-bus";
import { planQuestionsAction } from "./actions";

/**
 * What a build costs on the student's model, setup questions included
 * (priced by the server page from lib/price-list.ts): `build` is charged;
 * `buildMax` above it means the model's real cost can be higher, up to it.
 */
export interface GeneratorCosts {
  build: number;
  buildMax: number;
}

type Stage = "describe" | "questions";

/** The browser's IANA time zone, or undefined when it can't tell. */
function browserTimeZone(): string | undefined {
  try {
    return validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * After Cancel, how long the page keeps listening for the server's
 * "cancelled" event (which says what the stop cost) before it disconnects.
 */
const CANCEL_LISTEN_MS = 6_000;

/** What a stopped build cost; `credits: null` when the server could not say. */
type CancelNotice = { credits: number | null };

function newGenerationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function GeneratorClient({
  initialPrompt = "",
  outOfCredits: initiallyOutOfCredits = false,
  minCredits,
  costs,
  balance: serverBalance = null,
  signupCredits,
  billing = true,
}: {
  initialPrompt?: string;
  /** Known before the student types anything, so they never invest effort first. */
  outOfCredits?: boolean;
  /**
   * Credits needed to start a build, from the server page: about one typical
   * build on the model the student's plan runs (a client bundle cannot read
   * the configured model).
   */
  minCredits: number;
  /** Typical costs of the questions and the build, shown before each is spent. */
  costs?: GeneratorCosts;
  /** The balance when the page was rendered (null = unknown); then the live one. */
  balance?: number | null;
  /** The one-time trial a new account starts with (the fine print says so). */
  signupCredits?: number;
  /** Payments are switched on: the out-of-credits panel may offer to buy. */
  billing?: boolean;
}) {
  const router = useRouter();
  const { dict } = useI18n();
  const liveBalance = useLiveBalance(serverBalance ?? undefined);
  const spend = costs && typeof liveBalance === "number" ? { ...costs, balance: liveBalance } : null;
  const [prompt, setPrompt] = useState(initialPrompt);
  const [sourceText, setSourceText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A generation that failed (never charged): offer a one-tap retry.
  const [failure, setFailure] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(initiallyOutOfCredits);

  const [stage, setStage] = useState<Stage>("describe");
  const [planning, setPlanning] = useState(false);
  const [questions, setQuestions] = useState<GenQuestion[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
  const [building, setBuilding] = useState(false);
  const [generationPlan, setGenerationPlan] =
    useState<WorkspaceGenerationPlan | null>(null);
  const [componentProgress, setComponentProgress] = useState<
    Record<string, ComponentProgress>
  >({});
  const [generationPhase, setGenerationPhase] =
    useState<GenerationPhase>("analyzing");
  const [phaseMessage, setPhaseMessage] = useState(
    dict.ai.generate.phase.analyzing,
  );
  const [overallProgress, setOverallProgress] = useState(4);
  // A build the student stopped: what it cost (shown after the overlay closes).
  const [cancelNotice, setCancelNotice] = useState<CancelNotice | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const generationController = useRef<AbortController | null>(null);
  const generationIdRef = useRef<string | null>(null);
  const cancelRequested = useRef(false);

  useEffect(() => {
    // Remember the browser's time zone so every AI request (including the
    // workspace agent's) knows the student's local date.
    const zone = browserTimeZone();
    if (zone) {
      document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
    }
    return () => {
      generationController.current?.abort();
    };
  }, []);

  // Step 1 → 2: turn the description into tailored questions.
  const askQuestions = async (text: string) => {
    const value = text.trim();
    if (!value || planning || building || outOfCredits) return;
    setPrompt(value);
    setError(null);
    setFailure(null);
    setPlanning(true);
    try {
      const result = await planQuestionsAction(value, sourceText);
      if (!result.ok) {
        if (result.code === "out_of_credits") setOutOfCredits(true);
        else setError(result.message);
        return;
      }
      setQuestions(result.questions);
      // The questions were charged: the build step shows the balance after them.
      void refreshCreditsBalance({ force: true });
      setSelected({});
      setCustomAnswers({});
      setOtherOpen({});
      setStage("questions");
    } catch {
      setError(dict.generate.errorGeneric);
    } finally {
      setPlanning(false);
    }
  };

  const toggle = (q: GenQuestion, optionId: string) => {
    if (q.type === "single") {
      setCustomAnswers((previous) => ({ ...previous, [q.id]: "" }));
      setOtherOpen((previous) => ({ ...previous, [q.id]: false }));
    }
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
  };

  const toggleOther = (question: GenQuestion) => {
    const nextOpen = !otherOpen[question.id];
    setOtherOpen((previous) => ({ ...previous, [question.id]: nextOpen }));
    if (nextOpen && question.type === "single") {
      setSelected((previous) => ({ ...previous, [question.id]: [] }));
    }
    if (!nextOpen) {
      setCustomAnswers((previous) => ({ ...previous, [question.id]: "" }));
    }
  };

  const setCustomAnswer = (question: GenQuestion, value: string) => {
    setCustomAnswers((previous) => ({ ...previous, [question.id]: value }));
    if (question.type === "single") {
      setSelected((previous) => ({ ...previous, [question.id]: [] }));
    }
  };

  // Step 2 → done: generate with the chosen answers (skips are fine — empty).
  const build = async () => {
    if (building) return;
    const answers: QuestionAnswer[] = questions
      .map((q) => {
        const typed = customAnswers[q.id]?.trim();
        return {
          question: q.question,
          answers: [
            ...(selected[q.id] ?? []).map(
              (oid) => q.options.find((o) => o.id === oid)?.label ?? oid,
            ),
            ...(typed ? [typed] : []),
          ],
        };
      })
      .filter((a) => a.answers.length > 0);

    setError(null);
    setFailure(null);
    setCancelNotice(null);
    setCancelling(false);
    cancelRequested.current = false;
    setBuilding(true);
    setGenerationPlan(null);
    setComponentProgress({});
    setGenerationPhase("analyzing");
    setPhaseMessage(dict.ai.generate.phase.analyzing);
    setOverallProgress(4);

    const controller = new AbortController();
    generationController.current = controller;
    const generationId = newGenerationId();
    generationIdRef.current = generationId;
    let completed = false;
    let stopped = false;

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          answers,
          sourceText,
          timeZone: browserTimeZone(),
          generationId,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? dict.generate.errorBuild);
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
          } else if (event.type === "cancelled") {
            // The server stopped the build and says what that cost.
            stopped = true;
            setCancelNotice({ credits: event.credits });
          } else if (event.type === "error") {
            if (event.code === "out_of_credits") {
              setOutOfCredits(true);
              return;
            }
            if (event.code === "generation_failed") {
              setFailure(event.message);
              return;
            }
            throw new Error(event.message);
          }
        }

        if (done) break;
      }

      if (!completed && !stopped && !cancelRequested.current) setFailure(dict.generate.errorBuild);
      if (!completed && !stopped && cancelRequested.current) setCancelNotice({ credits: null });
    } catch (cause) {
      if (cancelRequested.current || controller.signal.aborted) {
        // Disconnected before the server said what the stop cost.
        if (cancelRequested.current && !stopped) setCancelNotice({ credits: null });
      } else {
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : dict.generate.errorBuild,
        );
      }
    } finally {
      if (generationController.current === controller) generationController.current = null;
      if (generationIdRef.current === generationId) generationIdRef.current = null;
      setCancelling(false);
      if (!completed) {
        setBuilding(false);
        if (cancelRequested.current) {
          setGenerationPlan(null);
          setComponentProgress({});
          setOverallProgress(4);
        }
      }
    }
  };

  // Stop the build. The server stops the model, saves nothing, charges only
  // the tokens already used and says how many credits that was; the page
  // waits a moment for that answer, then disconnects either way.
  const cancelBuild = async () => {
    const controller = generationController.current;
    const generationId = generationIdRef.current;
    if (!controller || cancelRequested.current) return;
    cancelRequested.current = true;
    setCancelling(true);
    let listening = false;
    if (generationId) {
      try {
        const response = await fetch("/api/generate/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationId }),
          keepalive: true,
        });
        const body = (await response.json().catch(() => null)) as { cancelled?: boolean } | null;
        listening = body?.cancelled === true;
      } catch {
        listening = false;
      }
    }
    // When the server could not find the run here, disconnecting is what
    // stops it; otherwise give its "cancelled" event a moment to arrive.
    if (!listening) controller.abort();
    else window.setTimeout(() => controller.abort(), CANCEL_LISTEN_MS);
  };

  const answeredCount = questions.filter(
    (q) =>
      (selected[q.id] ?? []).length > 0 ||
      Boolean(customAnswers[q.id]?.trim()),
  ).length;

  return (
    <main className="relative min-h-screen bg-paper text-ink antialiased">
      {planning && (
        <AiActivity
          fullscreen
          title={dict.generate.planningTitle}
          steps={dict.generate.planSteps.map((label) => ({ label }))}
        />
      )}
      {building && (
        <GenerationActivity
          plan={generationPlan}
          componentProgress={componentProgress}
          phase={generationPhase}
          phaseMessage={phaseMessage}
          overallProgress={overallProgress}
          onCancel={() => void cancelBuild()}
          cancelling={cancelling}
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
          <div className="flex items-center gap-3">
            <Link
              href="/app"
              className="text-sm text-ink-soft transition hover:text-ink"
            >
              {dict.generate.backToWorkspaces}
            </Link>
            <LanguageSwitcher compact />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col px-6 pb-24 pt-14 sm:pt-20">
        {outOfCredits && (
          <OutOfCreditsPanel minCredits={minCredits} billing={billing} />
        )}

        {stage === "describe" ? (
          <DescribeStage
            spend={spend}
            signupCredits={signupCredits}
            prompt={prompt}
            setPrompt={setPrompt}
            sourceText={sourceText}
            setSourceText={setSourceText}
            busy={planning}
            blocked={outOfCredits}
            onContinue={() => askQuestions(prompt)}
            onExample={askQuestions}
          />
        ) : (
          <QuestionsStage
            spend={spend}
            prompt={prompt}
            questions={questions}
            selected={selected}
            customAnswers={customAnswers}
            otherOpen={otherOpen}
            answeredCount={answeredCount}
            toggle={toggle}
            toggleOther={toggleOther}
            setCustomAnswer={setCustomAnswer}
            building={building}
            blocked={outOfCredits}
            onBack={() => setStage("describe")}
            onBuild={build}
          />
        )}

        {cancelNotice && !building && <CancelledPanel credits={cancelNotice.credits} />}
        {failure && !building && (
          <FailurePanel message={failure} onRetry={build} />
        )}
        {error && (
          <p role="alert" className="mt-7 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Out of credits / failed generation
// ---------------------------------------------------------------------------

function OutOfCreditsPanel({
  minCredits,
  billing,
}: {
  minCredits: number;
  billing: boolean;
}) {
  const { dict, t } = useI18n();
  const C = dict.generate.outOfCredits;
  if (!billing) {
    // Nothing can be bought here: say what still works, no buttons.
    return (
      <section role="alert" className="mb-10 rounded-xl border border-line-strong bg-card p-5 shadow-card">
        <div className="flex items-start gap-3">
          <Coins className="mt-0.5 h-5 w-5 shrink-0 text-lime-deep" aria-hidden />
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-ink">{C.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">
              {t(dict.spend.belowMinimum, { min: minCredits })}
            </p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section
      role="alert"
      className="mb-10 rounded-xl border border-line-strong bg-card p-5 shadow-card"
    >
      <div className="flex items-start gap-3">
        <Coins className="mt-0.5 h-5 w-5 shrink-0 text-lime-deep" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-ink">{C.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            {t(C.body, { min: minCredits })}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/app/credits"
              className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-paper transition hover:opacity-90"
            >
              {C.buy}
            </Link>
            <Link
              href="/pricing"
              className="inline-flex min-h-11 items-center rounded-lg border border-line-strong px-4 text-sm font-semibold text-ink transition hover:bg-hover"
            >
              {C.plans}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * After the student stops a build: nothing was saved, and what (if anything)
 * the AI work done before the stop cost. Charging for used tokens is the
 * policy; saying so is the point of this panel.
 */
function CancelledPanel({ credits }: { credits: number | null }) {
  const { dict, t } = useI18n();
  const C = dict.generate.cancelled;
  const message =
    credits === null
      ? C.unknown
      : credits <= 0
        ? C.free
        : credits === 1
          ? C.chargedOne
          : t(C.charged, { credits });
  return (
    <section
      role="status"
      aria-live="polite"
      className="mt-7 rounded-xl border border-line-strong bg-card p-5 shadow-card"
    >
      <div className="flex items-start gap-3">
        <CircleStop className="mt-0.5 h-5 w-5 shrink-0 text-ink-soft" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-ink">{C.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{message}</p>
          {credits !== 0 && (
            <Link
              href="/app/credits"
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-ink underline-offset-4 hover:underline"
            >
              {C.history}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function FailurePanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { dict } = useI18n();
  return (
    <section
      role="alert"
      className="mt-7 rounded-xl border border-rose-500/30 bg-card p-5 shadow-card"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-ink">
            {dict.generate.failed.title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-paper transition hover:opacity-90"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {dict.generate.failed.retry}
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stage 1 — describe your studies
// ---------------------------------------------------------------------------

type Spend = (GeneratorCosts & { balance: number }) | null;

/**
 * The cost line shown before the questions and before the build: the build's
 * price, setup questions included, and when the model's real cost can be
 * higher, how high (lib/price-list.ts).
 */
function useBuildCostHint() {
  const { dict, plural, t } = useI18n();
  const credits = (n: number) => plural(dict.counts.credits, n);
  return (spend: GeneratorCosts & { balance: number }) =>
    spend.buildMax > spend.build
      ? t(dict.spend.generatorPriceRange, {
          build: credits(spend.build),
          max: credits(spend.buildMax),
          balance: credits(spend.balance),
        })
      : t(dict.spend.generatorPrice, { build: credits(spend.build), balance: credits(spend.balance) });
}

function DescribeStage({
  spend,
  signupCredits,
  prompt,
  setPrompt,
  sourceText,
  setSourceText,
  busy,
  blocked,
  onContinue,
  onExample,
}: {
  /** Costs and balance, said before Continue spends anything (null = unknown). */
  spend: Spend;
  signupCredits?: number;
  prompt: string;
  setPrompt: (v: string) => void;
  sourceText: string;
  setSourceText: (v: string) => void;
  busy: boolean;
  /** Out of credits: the student can still read and type, but not start. */
  blocked: boolean;
  onContinue: () => void;
  onExample: (text: string) => void;
}) {
  const { dict, t, locale } = useI18n();
  const buildCostHint = useBuildCostHint();
  return (
    <>
      <p className="text-sm font-medium text-ink-soft">{dict.generate.describe.step}</p>
      <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
        {dict.generate.describe.title}
      </h1>
      <p className="mt-4 max-w-md text-lg leading-relaxed text-ink-soft">
        {dict.generate.describe.subtitle}
      </p>

      <div className="mt-8 rounded-xl border border-line bg-card shadow-card transition focus-within:border-lime/50">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onContinue();
          }}
          placeholder={dict.generate.describe.placeholder}
          aria-label={dict.generate.describe.title}
          rows={3}
          disabled={busy}
          className="w-full resize-none bg-transparent px-4 py-4 text-[15px] leading-relaxed text-ink placeholder:text-ink-soft/55 focus:outline-none disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3 border-t border-ink/10 px-4 py-3">
          <span className="hidden text-xs text-ink-soft sm:inline">
            {dict.generate.describe.shortcut}
          </span>
          <button
            onClick={onContinue}
            disabled={busy || blocked || !prompt.trim()}
            className="ms-auto flex min-h-11 items-center gap-2 rounded-lg bg-ink px-5 text-sm font-semibold text-paper transition enabled:hover:bg-ink/90 disabled:opacity-40"
          >
            {dict.generate.describe.continue} <span aria-hidden className="inline-block rtl:rotate-180">→</span>
          </button>
        </div>
      </div>
      {spend && (
        <p className="mt-2 px-1 text-xs text-ink-soft" data-testid="cost-hint">
          {buildCostHint(spend)}
        </p>
      )}

      <SyllabusImport
        sourceText={sourceText}
        setSourceText={setSourceText}
        busy={busy}
      />

      <div className="mt-8">
        <p className="mb-3 text-sm text-ink-soft">{dict.generate.describe.examplesLabel}</p>
        <div className="flex flex-wrap gap-2">
          {dict.generate.examples.map((ex) => (
            <button
              key={ex.text}
              onClick={() => onExample(ex.text)}
              disabled={busy || blocked}
              className="group flex items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2 text-start text-sm transition hover:border-lime/40 hover:text-ink disabled:opacity-50"
            >
              <span>{ex.emoji}</span>
              <span className="text-ink-soft transition group-hover:text-ink">
                {ex.text}
              </span>
            </button>
          ))}
        </div>
      </div>

      {signupCredits !== undefined && (
        <p className="mt-10 text-sm text-ink-soft/70">
          {t(dict.generate.describe.finePrint, { credits: signupCredits.toLocaleString(locale) })}
        </p>
      )}
    </>
  );
}

type UploadErrorCode =
  | "too_large"
  | "unsupported"
  | "no_text"
  | "unreadable"
  | "timeout"
  | "busy"
  | "rate_limited"
  | "failed";

// Optional syllabus grounding: paste text or upload a PDF / Word / text file
// so the generator builds from the student's REAL courses, deadlines and
// grading weights. Files are read on the server (/api/import/syllabus).
export function SyllabusImport({
  sourceText,
  setSourceText,
  busy,
}: {
  sourceText: string;
  setSourceText: (v: string) => void;
  busy: boolean;
}) {
  const { dict, t, locale } = useI18n();
  const S = dict.generate.syllabus;
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pagesRead, setPagesRead] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const errorText = (code: UploadErrorCode, kind?: string) => {
    switch (code) {
      case "too_large":
        return S.errors.tooLarge;
      case "unsupported":
        return S.errors.unsupported;
      case "no_text":
        return kind === "pdf" ? S.errors.scanned : S.errors.empty;
      case "unreadable":
        return S.errors.unreadable;
      case "timeout":
        return S.errors.timeout;
      case "busy":
        return S.errors.busy;
      case "rate_limited":
        return S.errors.rateLimited;
      default:
        return S.errors.failed;
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setPagesRead(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(errorText("too_large"));
      return;
    }
    setReading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/import/syllabus", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as {
        text?: string;
        code?: UploadErrorCode;
        kind?: string;
        pagesRead?: number;
        pagesTruncated?: boolean;
      } | null;
      if (!response.ok || typeof body?.text !== "string") {
        setUploadError(errorText(body?.code ?? "failed", body?.kind));
        return;
      }
      setSourceText(body.text.slice(0, MAX_SOURCE_INPUT));
      if (body.pagesTruncated && body.pagesRead) setPagesRead(body.pagesRead);
    } catch {
      setUploadError(errorText("failed"));
    } finally {
      setReading(false);
      // Let the student pick the same file again after fixing it.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const length = sourceText.trim().length;
  const has = length > 0;
  const overLimit = length > MAX_SOURCE_TEXT;
  const disabled = busy || reading;

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2 text-sm text-ink-soft transition hover:border-lime/40 hover:text-ink"
      >
        <span>{S.toggle}</span>
        <span className="text-xs text-ink-soft/60">· {S.optional}</span>
        {has && !open && (
          <span className="rounded-full bg-lime-faint px-2 py-0.5 text-[10px] font-semibold text-lime-deep">
            {t(S.attached, { chars: length.toLocaleString(locale) })}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 rounded-xl border border-line bg-card p-4 shadow-card">
          <p className="mb-3 text-sm text-ink-soft">{S.hint}</p>
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value.slice(0, MAX_SOURCE_INPUT))}
            placeholder={S.placeholder}
            aria-label={S.toggle}
            rows={5}
            disabled={disabled}
            className="w-full resize-y rounded-lg border border-line bg-paper px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-soft/50 outline-none focus:border-lime/50 disabled:opacity-60"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => void onFile(e.target.files?.[0] ?? undefined)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-3.5 text-sm font-medium text-ink transition hover:bg-hover disabled:opacity-50"
            >
              {reading ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              {reading ? S.reading : S.upload}
            </button>
            <span className="text-xs text-ink-soft/80">{S.formats}</span>
            {has && (
              <>
                <span className="text-xs text-ink-soft">
                  {t(S.attached, { chars: length.toLocaleString(locale) })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSourceText("");
                    setPagesRead(null);
                    setUploadError(null);
                  }}
                  disabled={disabled}
                  className="min-h-11 px-1 text-xs text-ink-soft transition hover:text-rose-600 disabled:opacity-50"
                >
                  {S.clear}
                </button>
              </>
            )}
          </div>
          <div aria-live="polite">
            {uploadError && (
              <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
                {uploadError}
              </p>
            )}
            {overLimit && (
              <p className="mt-3 text-sm text-ink-soft">
                {t(S.truncated, {
                  total: length.toLocaleString(locale),
                  limit: MAX_SOURCE_TEXT.toLocaleString(locale),
                })}
              </p>
            )}
            {pagesRead !== null && (
              <p className="mt-2 text-sm text-ink-soft">
                {t(S.pagesTruncated, { pages: pagesRead })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage 2 — answer a few questions
// ---------------------------------------------------------------------------

function QuestionsStage({
  spend,
  prompt,
  questions,
  selected,
  customAnswers,
  otherOpen,
  answeredCount,
  toggle,
  toggleOther,
  setCustomAnswer,
  building,
  blocked,
  onBack,
  onBuild,
}: {
  /** Cost of the build and the balance, said before Build spends anything. */
  spend: Spend;
  prompt: string;
  questions: GenQuestion[];
  selected: Record<string, string[]>;
  customAnswers: Record<string, string>;
  otherOpen: Record<string, boolean>;
  answeredCount: number;
  toggle: (q: GenQuestion, optionId: string) => void;
  toggleOther: (q: GenQuestion) => void;
  setCustomAnswer: (q: GenQuestion, value: string) => void;
  building: boolean;
  blocked: boolean;
  onBack: () => void;
  onBuild: () => void;
}) {
  const { dict, t } = useI18n();
  const buildCostHint = useBuildCostHint();
  return (
    <>
      <button
        onClick={onBack}
        disabled={building}
        className="mb-5 self-start text-sm text-ink-soft transition hover:text-ink disabled:opacity-50"
      >
        {dict.generate.questions.back}
      </button>

      <p className="text-sm font-medium text-ink-soft">{dict.generate.questions.step}</p>
      <h1 className="mt-4 font-display text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl">
        {dict.generate.questions.title}
      </h1>
      <p className="mt-3 line-clamp-2 max-w-xl text-sm text-ink-soft">
        {dict.generate.questions.designingFor} <span className="text-ink">“{prompt}”</span>
      </p>

      <div className="mt-8 space-y-4">
        {questions.map((q, qi) => {
          const chosen = selected[q.id] ?? [];
          const customOpen = Boolean(otherOpen[q.id]);
          const customValue = customAnswers[q.id] ?? "";
          return (
            <div
              key={q.id}
              className="reveal rounded-xl border border-line bg-card p-5 shadow-card"
              style={{ animationDelay: `${qi * 70}ms` }}
            >
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-ink">
                  {q.question}
                </h2>
                <span className="shrink-0 text-xs text-ink-soft/70">
                  {q.type === "multi"
                    ? dict.generate.questions.pickAny
                    : dict.generate.questions.pickOne}
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
                          ? "border-lime bg-lime font-medium text-lime-on"
                          : "border-line bg-card text-ink-soft hover:border-lime/40 hover:text-ink"
                      }`}
                    >
                      {o.emoji && <span>{o.emoji}</span>}
                      {o.label}
                    </button>
                  );
                })}
                <button
                  onClick={() => toggleOther(q)}
                  disabled={building}
                  aria-pressed={customOpen}
                  className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm transition disabled:opacity-60 ${
                    customOpen
                      ? "border-lime bg-lime font-medium text-lime-on"
                      : "border-line bg-card text-ink-soft hover:border-lime/40 hover:text-ink"
                  }`}
                >
                  <span>✍️</span>
                  {dict.generate.questions.other}
                </button>
              </div>
              {customOpen && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2 focus-within:border-lime/50">
                  <span className="text-sm" aria-hidden>
                    ✎
                  </span>
                  <input
                    autoFocus
                    value={customValue}
                    onChange={(event) =>
                      setCustomAnswer(q, event.target.value)
                    }
                    disabled={building}
                    maxLength={240}
                    placeholder={dict.generate.questions.otherPlaceholder}
                    aria-label={t(dict.generate.questions.otherAria, {
                      question: q.question,
                    })}
                    className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-soft/50"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          onClick={onBuild}
          disabled={building || blocked}
          className="flex min-h-11 items-center gap-2 rounded-lg bg-ink px-6 text-sm font-semibold text-paper transition enabled:hover:bg-ink/90 disabled:opacity-40"
        >
          {dict.generate.questions.build} <span aria-hidden className="inline-block rtl:rotate-180">→</span>
        </button>
        <span className="text-sm text-ink-soft">
          {answeredCount === 0
            ? dict.generate.questions.answeredNone
            : t(dict.generate.questions.answeredCount, {
                n: answeredCount,
                total: questions.length,
              })}
        </span>
      </div>
      {spend && (
        <p className="mt-3 text-xs text-ink-soft" data-testid="cost-hint">
          {buildCostHint(spend)}
        </p>
      )}
    </>
  );
}
