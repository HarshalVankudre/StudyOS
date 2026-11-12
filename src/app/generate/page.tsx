import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { modelForPlan } from "@/lib/ai/plans";
import { getUserPlan } from "@/lib/billing";
import { getCreditBalance } from "@/lib/credits";
import { buildQuote, TRIAL_CREDITS } from "@/lib/price-list";
import { isBillingConfigured } from "@/lib/stripe";
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

  // What a build costs on the model the student's plan runs (its price,
  // setup questions included, or the model's real cost when higher: see
  // lib/price-list.ts), priced here because a client bundle cannot read the
  // configured model, and the balance, so the page says both before
  // anything is spent. The minimum to start is the one /api/generate
  // applies: the build's price. A failed lookup never blocks.
  const { userId } = await auth();
  const model = modelForPlan(userId ? await getUserPlan().catch(() => "free" as const) : "free");
  const build = buildQuote(model);
  const balance = userId ? await getCreditBalance(userId).catch(() => null) : null;
  const outOfCredits = balance !== null && balance < build.price;

  return (
    <GeneratorClient
      initialPrompt={initialPrompt}
      outOfCredits={outOfCredits}
      minCredits={build.price}
      costs={{ build: build.price, buildMax: build.max }}
      balance={balance}
      signupCredits={TRIAL_CREDITS}
      billing={isBillingConfigured()}
    />
  );
}
