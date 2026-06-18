"use server";

import { generateWorkspace, planQuestions } from "@/lib/ai/generate";
import { modelForPlan } from "@/lib/ai/plans";
import {
  formatPreferences,
  type GenQuestion,
  type QuestionAnswer,
} from "@/lib/ai/onboarding";
import { getUserPlan } from "@/lib/billing";
import { getLocale } from "@/lib/i18n/server";
import { saveNewWorkspace } from "@/lib/workspace/store";

/**
 * Server Action: from the student's description, produce a few tailored
 * multiple-choice onboarding questions. Always resolves (static fallback).
 */
export async function planQuestionsAction(
  prompt: string,
): Promise<GenQuestion[]> {
  const clean = (prompt ?? "").toString().slice(0, 2000).trim();
  if (!clean) {
    throw new Error("Please describe what you want to organize.");
  }
  const [model, locale] = await Promise.all([
    getUserPlan().then(modelForPlan),
    getLocale(),
  ]);
  return planQuestions(clean, model, locale);
}

/**
 * Server Action: generate a workspace from a description plus the student's
 * onboarding answers, persist it, and return its new id. Picks the AI model
 * based on the user's plan. Runs only on the server.
 */
export async function generateWorkspaceAction(
  prompt: string,
  answers: QuestionAnswer[] = [],
): Promise<string> {
  const clean = (prompt ?? "").toString().slice(0, 2000).trim();
  if (!clean) {
    throw new Error("Please describe what you want to organize.");
  }
  const [model, locale] = await Promise.all([
    getUserPlan().then(modelForPlan),
    getLocale(),
  ]);
  const preferences = formatPreferences(answers ?? []);
  const workspace = await generateWorkspace(
    clean,
    model,
    preferences,
    undefined,
    locale,
  );
  return saveNewWorkspace(workspace);
}
