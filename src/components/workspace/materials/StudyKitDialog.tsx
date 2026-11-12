"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { emitCreditsBalance } from "@/lib/credits-bus";
import { studyKitCost } from "@/lib/credits-info";
import { localeMeta } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { buildKitPage } from "@/lib/materials/kit";
import { KIT_AMOUNTS, kitTargets, planRun, type KitAmount, type KitOutputs } from "@/lib/materials/limits";
import { pageMaterialText, paginateText } from "@/lib/materials/pages";
import type { KitErrorCode, KitEvent, KitResult, MaterialSummary } from "@/lib/materials/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../WorkspaceContext";
import { cancelStudyKit, fetchMaterials, pasteMaterial, streamStudyKit } from "./api";
import type { StudyKitIntent } from "./events";
import { MaterialPicker } from "./MaterialPicker";
import { materialErrorMessage } from "./messages";

type SectionStatus = "waiting" | "working" | "retrying" | "done" | "failed";

interface RunState {
  sections: { from: number; to: number; status: SectionStatus; made?: number }[];
  checking: boolean;
}

type Phase =
  | { kind: "setup" }
  | { kind: "preparing" }
  | { kind: "running" }
  | { kind: "done"; result: KitResult; credits: number; pageId: string }
  | { kind: "error"; code: KitErrorCode | "network"; message: string };

function newGenerationId(): string {
  return crypto.randomUUID();
}

/**
 * Make a study kit from the student's own material: choose or add material,
 * choose what to make and roughly how much, see the cost and the pages a run
 * covers, watch progress, cancel. The result lands as a new page through the
 * workspace's normal edit path (undoable, autosaved).
 */
export function StudyKitDialog({
  intent,
  afterPageId,
  onClose,
  onCreated,
}: {
  intent: StudyKitIntent;
  /** Insert the new page after this one (else at the end). */
  afterPageId?: string;
  onClose: () => void;
  onCreated: (pageId: string) => void;
}) {
  const { workspace, update } = useWorkspace();
  const { dict, t, locale } = useI18n();
  const M = dict.materials;

  const sourcePage =
    intent.mode === "page" ? workspace.pages.find((p) => p.id === intent.pageId) : undefined;
  const pageText = useMemo(() => (sourcePage ? pageMaterialText(sourcePage) : ""), [sourcePage]);
  const pagePlanChars = useMemo(() => paginateText(pageText).map((p) => p.length), [pageText]);

  const [materials, setMaterials] = useState<MaterialSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<KitOutputs>(() =>
    intent.mode === "page"
      ? { notes: false, flashcards: intent.make === "flashcards", quiz: intent.make === "quiz" }
      : { notes: true, flashcards: true, quiz: true },
  );
  const [amount, setAmount] = useState<KitAmount>("standard");
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [inInterfaceLanguage, setInInterfaceLanguage] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [run, setRun] = useState<RunState>({ sections: [], checking: false });
  const [loadTick, setLoadTick] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef<string | null>(null);

  // Load the workspace's materials (material mode only).
  useEffect(() => {
    if (intent.mode !== "material") return;
    let active = true;
    fetchMaterials(workspace.id)
      .then((list) => {
        if (!active) return;
        setMaterials(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((cause) => active && setLoadError(materialErrorMessage(cause, dict)));
    return () => {
      active = false;
    };
  }, [intent.mode, workspace.id, dict, loadTick]);

  // Stop a run if the dialog goes away mid-way.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      if (generationRef.current) cancelStudyKit(generationRef.current);
    },
    [],
  );

  const selected = materials?.find((m) => m.id === selectedId) ?? null;
  const selectedChars = selected?.pageChars;
  const pageChars = useMemo(
    () => (intent.mode === "page" ? pagePlanChars : (selectedChars ?? [])),
    [intent.mode, pagePlanChars, selectedChars],
  );
  const pageCount = pageChars.length;
  const effectiveRange = useMemo(() => range ?? { from: 1, to: pageCount }, [range, pageCount]);
  const plan = useMemo(() => planRun(pageChars, effectiveRange), [pageChars, effectiveRange]);
  const cost = studyKitCost(plan.sections.length);
  const targets = kitTargets(amount, outputs, plan.chars);
  const anyOutput = outputs.notes || outputs.flashcards || outputs.quiz;
  const languageName = localeMeta(locale).nativeName;
  const pageTooShort = intent.mode === "page" && pageText.replace(/\s+/g, "").length < 20;
  const canStart =
    phase.kind === "setup" && anyOutput && plan.sections.length > 0 && !pageTooShort &&
    (intent.mode === "page" || selected !== null);

  const selectMaterial = (id: string) => {
    setSelectedId(id);
    setRange(null);
  };

  const insertKit = (result: KitResult): string => {
    const page = buildKitPage(result, {
      pageTitle: M.kitPageTitle,
      summary: M.kitSummary,
      summaryNotesOnly: M.kitSummaryNotesOnly,
      pagesRange: M.kitPages,
      notesHeading: M.kitNotes,
      flashcardsHeading: M.kitFlashcards,
      quizHeading: M.kitQuiz,
    });
    update((draft) => {
      const at = afterPageId ? draft.pages.findIndex((p) => p.id === afterPageId) : -1;
      if (at >= 0) draft.pages.splice(at + 1, 0, page);
      else draft.pages.push(page);
    });
    return page.id;
  };

  const start = async () => {
    if (!canStart) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    let materialId = selected?.id ?? null;

    if (intent.mode === "page" && sourcePage) {
      setPhase({ kind: "preparing" });
      try {
        const material = await pasteMaterial({
          workspaceId: workspace.id,
          title: sourcePage.title.trim() || dict.editor.untitled,
          text: pageText,
          sourcePageId: sourcePage.id,
        });
        materialId = material.id;
      } catch (cause) {
        if (controller.signal.aborted) return;
        setPhase({ kind: "error", code: "network", message: materialErrorMessage(cause, dict) });
        return;
      }
    }
    if (!materialId || controller.signal.aborted) return;

    const generationId = newGenerationId();
    generationRef.current = generationId;
    setRun({
      sections: plan.sections.map((s) => ({ from: s.from, to: s.to, status: "waiting" })),
      checking: false,
    });
    setPhase({ kind: "running" });
    let finished = false;

    const onEvent = (event: KitEvent) => {
      switch (event.type) {
        case "start":
          setRun({
            sections: event.sections.map((s) => ({ ...s, status: "waiting" })),
            checking: false,
          });
          break;
        case "section":
          setRun((current) => ({
            ...current,
            sections: current.sections.map((s, i) =>
              i === event.index ? { ...s, status: event.status, made: event.made } : s,
            ),
          }));
          break;
        case "checking":
          setRun((current) => ({ ...current, checking: true }));
          break;
        case "complete": {
          finished = true;
          const pageId = insertKit(event.result);
          emitCreditsBalance(event.balance);
          setPhase({ kind: "done", result: event.result, credits: event.credits, pageId });
          onCreated(pageId);
          break;
        }
        case "error":
          finished = true;
          setPhase({ kind: "error", code: event.code, message: event.message });
          break;
      }
    };

    try {
      await streamStudyKit(
        {
          workspaceId: workspace.id,
          materialId,
          outputs,
          amount,
          range: { from: plan.from, to: plan.to },
          language: inInterfaceLanguage ? "interface" : "material",
          generationId,
        },
        onEvent,
        controller.signal,
      );
      if (!finished && !controller.signal.aborted) {
        setPhase({ kind: "error", code: "generation_failed", message: M.errors.failedNoCharge });
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setPhase({ kind: "error", code: "network", message: materialErrorMessage(cause, dict) });
      }
    } finally {
      controllerRef.current = null;
      generationRef.current = null;
    }
  };

  const cancelRun = () => {
    controllerRef.current?.abort();
    if (generationRef.current) cancelStudyKit(generationRef.current);
    controllerRef.current = null;
    generationRef.current = null;
    setPhase({ kind: "setup" });
  };

  const busy = phase.kind === "running" || phase.kind === "preparing";
  const doneSections = run.sections.filter((s) => s.status === "done" || s.status === "failed").length;
  const progress = run.checking
    ? 95
    : run.sections.length > 0
      ? Math.max(4, Math.round((doneSections / run.sections.length) * 90))
      : 4;

  const title = intent.mode === "page" ? M.titleFromPage : M.title;
  const description =
    intent.mode === "page"
      ? t(M.descriptionFromPage, { title: sourcePage?.title || dict.editor.untitled })
      : M.description;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        if (busy) cancelRun();
        onClose();
      }}
    >
      <DialogContent className="flex max-h-[92dvh] flex-col gap-3 overflow-hidden p-4 sm:max-w-xl sm:p-6">
        <DialogTitle className="pe-8 font-display text-lg font-bold text-ink">{title}</DialogTitle>
        <DialogDescription className="-mt-1 text-sm text-ink-soft">{description}</DialogDescription>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-1">
          {phase.kind === "setup" && (
            <>
              {intent.mode === "material" &&
                (loadError ? (
                  <div role="alert" className="flex flex-col items-start gap-2 text-sm text-ink">
                    <p>{loadError}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setLoadError(null);
                        setLoadTick((n) => n + 1);
                      }}
                      className="min-h-11 rounded-lg border border-line-strong bg-card px-3 text-sm font-semibold text-ink transition hover:bg-hover"
                    >
                      {M.retry}
                    </button>
                  </div>
                ) : materials === null ? (
                  <p className="flex items-center gap-2 text-sm text-ink-soft">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {M.loading}
                  </p>
                ) : (
                  <MaterialPicker
                    workspaceId={workspace.id}
                    materials={materials}
                    selectedId={selectedId}
                    onSelect={selectMaterial}
                    onAdded={(material) => {
                      setMaterials((list) => [material, ...(list ?? []).filter((m) => m.id !== material.id)]);
                      selectMaterial(material.id);
                    }}
                    onDeleted={(id) => {
                      setMaterials((list) => (list ?? []).filter((m) => m.id !== id));
                      if (selectedId === id) {
                        setSelectedId(materials.find((m) => m.id !== id)?.id ?? null);
                        setRange(null);
                      }
                    }}
                  />
                ))}

              {intent.mode === "page" && pageTooShort && (
                <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                  {M.errors.pageTooShort}
                </p>
              )}

              {(intent.mode === "page" || selected) && (
                <KitOptions
                  outputs={outputs}
                  onOutputs={setOutputs}
                  amount={amount}
                  onAmount={setAmount}
                  targets={targets}
                  pageCount={pageCount}
                  range={effectiveRange}
                  onRange={setRange}
                  showRange={intent.mode === "material" && pageCount > 1}
                  plan={plan}
                  languageName={languageName}
                  inInterfaceLanguage={inInterfaceLanguage}
                  onLanguage={setInInterfaceLanguage}
                  cost={cost}
                />
              )}
            </>
          )}

          {(phase.kind === "preparing" || phase.kind === "running") && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {phase.kind === "preparing" ? M.preparing : run.checking ? M.checking : M.working}
              </p>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-label={M.working}
                className="h-2 w-full overflow-hidden rounded-full bg-hover"
              >
                <div
                  className="h-full rounded-full bg-lime transition-[width] duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {run.sections.map((section, index) => (
                  <li key={index} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-ink">{t(M.sectionLabel, { from: section.from, to: section.to })}</span>
                    <span
                      className={cn(
                        "shrink-0 text-xs",
                        section.status === "done" && "font-semibold text-emerald-700 dark:text-emerald-400",
                        section.status === "failed" && "font-semibold text-amber-700 dark:text-amber-400",
                        (section.status === "waiting" || section.status === "working" || section.status === "retrying") &&
                          "text-ink-soft",
                      )}
                    >
                      {section.status === "done" && section.made !== undefined
                        ? t(M.sectionMade, { count: section.made })
                        : M.sectionStatus[section.status]}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink-soft">{M.costNote}</p>
            </div>
          )}

          {phase.kind === "done" && <KitDone result={phase.result} credits={phase.credits} />}

          {phase.kind === "error" && (
            <div role="alert" className="flex flex-col gap-2 text-sm text-ink">
              <p>{phase.message}</p>
              {phase.code === "out_of_credits" && (
                <Link href="/app/credits" className="font-semibold text-ink underline underline-offset-2">
                  {M.getCredits}
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          {phase.kind === "setup" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded-lg border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover"
              >
                {dict.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => void start()}
                disabled={!canStart}
                className="min-h-11 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep disabled:cursor-not-allowed disabled:opacity-40"
              >
                {M.start}
              </button>
            </>
          )}
          {busy && (
            <button
              type="button"
              onClick={cancelRun}
              className="min-h-11 rounded-lg border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover"
            >
              {M.cancel}
            </button>
          )}
          {phase.kind === "error" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded-lg border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover"
              >
                {M.close}
              </button>
              {phase.code !== "out_of_credits" && (
                <button
                  type="button"
                  onClick={() => setPhase({ kind: "setup" })}
                  className="min-h-11 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
                >
                  {M.retry}
                </button>
              )}
            </>
          )}
          {phase.kind === "done" && (
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-lg bg-lime px-4 text-sm font-semibold text-lime-on transition hover:bg-lime-deep"
            >
              {M.openPage}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KitOptions({
  outputs,
  onOutputs,
  amount,
  onAmount,
  targets,
  pageCount,
  range,
  onRange,
  showRange,
  plan,
  languageName,
  inInterfaceLanguage,
  onLanguage,
  cost,
}: {
  outputs: KitOutputs;
  onOutputs: (outputs: KitOutputs) => void;
  amount: KitAmount;
  onAmount: (amount: KitAmount) => void;
  targets: { cards: number; questions: number };
  pageCount: number;
  range: { from: number; to: number };
  onRange: (range: { from: number; to: number }) => void;
  showRange: boolean;
  plan: ReturnType<typeof planRun>;
  languageName: string;
  inInterfaceLanguage: boolean;
  onLanguage: (value: boolean) => void;
  cost: { estimate: number; max: number };
}) {
  const { dict, t } = useI18n();
  const M = dict.materials;
  const anyOutput = outputs.notes || outputs.flashcards || outputs.quiz;
  const setPage = (key: "from" | "to", raw: string) => {
    const value = Math.floor(Number(raw));
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(pageCount, Math.max(1, value));
    onRange(
      key === "from"
        ? { from: clamped, to: Math.max(clamped, range.to) }
        : { from: Math.min(range.from, clamped), to: clamped },
    );
  };
  const toggles: { key: keyof KitOutputs; label: string }[] = [
    { key: "notes", label: M.outputNotes },
    { key: "flashcards", label: M.outputFlashcards },
    { key: "quiz", label: M.outputQuiz },
  ];

  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-ink">{M.makeWhat}</legend>
        <div className="flex flex-wrap gap-2">
          {toggles.map(({ key, label }) => (
            <label
              key={key}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm text-ink transition",
                outputs[key] ? "border-lime bg-lime-faint" : "border-line-strong bg-card hover:bg-hover",
              )}
            >
              <input
                type="checkbox"
                checked={outputs[key]}
                onChange={(e) => onOutputs({ ...outputs, [key]: e.target.checked })}
                className="size-4 accent-[var(--lime)]"
              />
              {label}
            </label>
          ))}
        </div>
        {!anyOutput && <p className="text-xs text-rose-600 dark:text-rose-400">{M.nothingSelected}</p>}
      </fieldset>

      {(outputs.flashcards || outputs.quiz) && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-ink">{M.howMuch}</legend>
          <div role="radiogroup" className="grid grid-cols-3 gap-1 rounded-lg border border-line-strong bg-card p-1">
            {KIT_AMOUNTS.map((value) => (
              <label
                key={value}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center justify-center rounded-md px-2 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink/30",
                  amount === value ? "bg-lime text-lime-on" : "text-ink-soft hover:bg-hover",
                )}
              >
                <input
                  type="radio"
                  name="kit-amount"
                  value={value}
                  checked={amount === value}
                  onChange={() => onAmount(value)}
                  className="sr-only"
                />
                {M.amount[value]}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-soft">
            {outputs.flashcards && outputs.quiz
              ? t(M.amountBoth, { cards: targets.cards, questions: targets.questions })
              : outputs.flashcards
                ? t(M.amountCards, { cards: targets.cards })
                : t(M.amountQuestions, { questions: targets.questions })}
          </p>
        </fieldset>
      )}

      {showRange && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-ink">{M.pages}</legend>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              {M.pageFrom}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={pageCount}
                value={range.from}
                onChange={(e) => setPage("from", e.target.value)}
                className="min-h-11 w-20 rounded-lg border border-line-strong bg-card px-2 text-base text-ink sm:text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              {M.pageTo}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={pageCount}
                value={range.to}
                onChange={(e) => setPage("to", e.target.value)}
                className="min-h-11 w-20 rounded-lg border border-line-strong bg-card px-2 text-base text-ink sm:text-sm"
              />
            </label>
          </div>
        </fieldset>
      )}

      <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm">
        {plan.sections.length === 0 ? (
          <p className="text-ink">{M.errors.nothingToRead}</p>
        ) : (
          <>
            <p className="text-ink">
              {plan.sections.length === 1
                ? t(M.coverageOne, { from: plan.from, to: plan.to })
                : t(M.coverage, { from: plan.from, to: plan.to, sections: plan.sections.length })}
            </p>
            {plan.cutShort && <p className="text-xs text-ink-soft">{t(M.cutShort, { next: plan.to + 1 })}</p>}
            <p className="font-semibold text-ink">{t(M.cost, { estimate: cost.estimate, max: cost.max })}</p>
            <p className="text-xs text-ink-soft">{M.costNote}</p>
          </>
        )}
      </div>

      <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={inInterfaceLanguage}
          onChange={(e) => onLanguage(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--lime)]"
        />
        <span>
          {t(M.languageInterface, { language: languageName })}
          <span className="block text-xs text-ink-soft">{M.languageHint}</span>
        </span>
      </label>
    </>
  );
}

function KitDone({ result, credits }: { result: KitResult; credits: number }) {
  const { dict, t } = useI18n();
  const M = dict.materials;
  const items = result.cards.length + result.questions.length;
  const ranges = result.stats.failedRanges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`)).join(", ");
  return (
    <div role="status" className="flex flex-col gap-3 text-sm text-ink">
      <p className="flex items-center gap-2 font-display text-base font-bold">
        <BadgeCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        {M.doneTitle}
      </p>
      <p>
        {items > 0
          ? t(M.doneSummary, { cards: result.cards.length, questions: result.questions.length })
          : M.doneNotesOnly}
        {result.notes.length > 0 && items > 0 ? ` ${t(M.doneNotes, { count: result.notes.length })}` : ""}
      </p>
      {items > 0 && <p>{t(M.doneTrust, { title: result.title })}</p>}
      {result.stats.unverified > 0 && (
        <p className="text-ink-soft">{t(M.doneDropped, { count: result.stats.unverified })}</p>
      )}
      {result.stats.failedSections > 0 && (
        <p className="text-amber-700 dark:text-amber-400">{t(M.doneFailed, { ranges })}</p>
      )}
      <p className="text-xs text-ink-soft">{t(M.doneCost, { credits })}</p>
    </div>
  );
}
