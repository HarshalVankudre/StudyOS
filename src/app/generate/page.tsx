import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { modelForPlan } from "@/lib/ai/plans";
import { getUserPlan } from "@/lib/billing";
import { hasCredits } from "@/lib/credits";
import { buildCreditCost, MIN_GENERATION_BALANCE } from "@/lib/credits-info";
import { getI18n } from "@/lib/i18n/server";
import { GeneratorClient } from "./GeneratorClient";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.generateTitle };
}

export default async function GeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string | string[] }>;
}) {
  const value = (await searchParams).prompt;
  const initialPrompt = typeof value === "string" ? value.slice(0, 2000) : "";

  // Tell the student they lack the credits for a build (the server's
  // minimum to start one) BEFORE they describe their studies and answer
  // questions, not after. A failed lookup never blocks.
  // The minimum is the one /api/generate applies: about one typical build on
  // the model the student's plan runs (lib/credits-info buildCreditCost).
  const { userId } = await auth();
  const minCredits = userId
    ? await getUserPlan()
        .then((plan) => buildCreditCost(modelForPlan(plan)).typical)
        .catch(() => MIN_GENERATION_BALANCE)
    : MIN_GENERATION_BALANCE;
  const outOfCredits = userId
    ? !(await hasCredits(userId, minCredits).catch(() => true))
    : false;

  return <GeneratorClient initialPrompt={initialPrompt} outOfCredits={outOfCredits} minCredits={minCredits} />;
}
